import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/shadcn/button';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal } from '@/shadcn/dialog';
import { atom } from '@/atom';
import './OverlayImageViewer.scss';
import { log } from '@/log';
const logger = log.child({ mod: 'OverlayImageViewer' });

interface ImageItem {
  id: string;
  url: string;
  alt?: string;
}

interface State {
  isOpen: boolean;
  images: ImageItem[];
  initialIndex: number;
}

const zeroState: State = {
  isOpen: false,
  images: [],
  initialIndex: 0,
};

export const ImageViewerAtom = atom(zeroState, (_get, set) => {
  function open(images: ImageItem[], initialIndex: number) {
    set({ isOpen: true, images, initialIndex });
  }

  function close() {
    set(zeroState);
  }

  return { open, close };
});

export const OverlayImageViewer: React.FC = () => {
  const [state, actions] = ImageViewerAtom.use();
  const { isOpen, images, initialIndex } = state;

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isImageLoading, setIsImageLoading] = useState(true);

  // Listen for imageViewer:open custom events
  useEffect(() => {
    const handleOpenImageViewer = (event: CustomEvent) => {
      const { images, initialIndex } = event.detail;
      actions.open(images, initialIndex);
    };

    window.addEventListener(
      'imageViewer:open',
      handleOpenImageViewer as EventListener,
    );

    return () => {
      window.removeEventListener(
        'imageViewer:open',
        handleOpenImageViewer as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setIsImageLoading(true);
    }
  }, [isOpen, initialIndex]);

  // Keyboard navigation (arrow keys only; Escape is handled by Dialog)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, images.length]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setIsImageLoading(true);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsImageLoading(true);
    }
  }, [currentIndex, images.length]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // Close only when clicking the background (not the image)
    if (e.target === e.currentTarget) {
      actions.close();
    }
  }, []);

  const handleImageLoad = useCallback(() => {
    setIsImageLoading(false);
  }, []);

  // Save image to local disk
  const handleSaveImage = useCallback(async () => {
    const currentImage = images[currentIndex];
    if (!currentImage) return;

    try {
      // Create a temporary <a> tag to trigger download
      const link = document.createElement('a');
      link.href = currentImage.url;

      // Set download filename
      const fileName = currentImage.alt || `image-${currentIndex + 1}`;
      link.download = fileName;

      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      logger.error({ msg: "Failed to save image:", err: error });
    }
  }, [currentIndex, images]);

  if (!isOpen || images.length === 0) {
    return null;
  }

  const currentImage = images[currentIndex];

  // Guard against invalid image data
  if (!currentImage || !currentImage.url) {
    logger.error({ msg: "Current image is invalid:", currentIndex, currentImage });
    return (
      <Dialog open={true} onOpenChange={(open) => { if (!open) actions.close(); }}>
        <DialogPortal>
          <DialogPrimitive.Content className="image-viewer-overlay" onClick={actions.close}>
            <DialogPrimitive.Title className="sr-only">Image Error</DialogPrimitive.Title>
            <div className="image-viewer-content">
              <div className="image-viewer-error">
                <p>Image failed to load</p>
                <Button variant="secondary" onClick={actions.close}>Close</Button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    );
  }

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < images.length - 1;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) actions.close(); }}>
      <DialogPortal>
        <DialogPrimitive.Content
          className="image-viewer-overlay"
          onClick={handleOverlayClick}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            actions.close();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Image Viewer</DialogPrimitive.Title>

          {/* Toolbar buttons */}
          <div className="image-viewer-toolbar">
            {/* Save button */}
            <Button
              variant="ghost"
              size="icon"
              className="image-viewer-tool-btn"
              onClick={handleSaveImage}
              aria-label="Save image"
              title="Save image"
            >
              <Download size={20} />
            </Button>

            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              className="image-viewer-tool-btn image-viewer-close"
              onClick={actions.close}
              aria-label="Close image viewer"
              title="Close"
            >
              <X size={20} />
            </Button>
          </div>

          {/* Left arrow */}
          {canGoPrev && (
            <Button
              variant="ghost"
              size="icon"
              className="image-viewer-nav image-viewer-nav-prev"
              onClick={handlePrevious}
              aria-label="Previous image"
            >
              <ChevronLeft size={48} />
            </Button>
          )}

          {/* Image container */}
          <div className="image-viewer-content">
            {isImageLoading && (
              <div className="image-viewer-loading">
                <div className="loading-spinner-large">
                  <div className="spinner-circle-large"></div>
                </div>
                <div className="loading-text">Loading...</div>
              </div>
            )}
            <img
              src={currentImage.url}
              alt={currentImage.alt || `Image ${currentIndex + 1}`}
              className="image-viewer-image"
              onLoad={handleImageLoad}
              style={{ display: isImageLoading ? 'none' : 'block' }}
            />
            {currentImage.alt && !isImageLoading && (
              <div className="image-viewer-caption">
                {currentImage.alt}
              </div>
            )}
          </div>

          {/* Right arrow */}
          {canGoNext && (
            <Button
              variant="ghost"
              size="icon"
              className="image-viewer-nav image-viewer-nav-next"
              onClick={handleNext}
              aria-label="Next image"
            >
              <ChevronRight size={48} />
            </Button>
          )}

          {/* Thumbnail indicator */}
          {images.length > 1 && (
            <div className="image-viewer-thumbnails">
              <div className="thumbnails-container">
                {images.map((img, index) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    key={img.id}
                    className={`thumbnail-item ${index === currentIndex ? 'active' : ''}`}
                    onClick={() => {
                      setCurrentIndex(index);
                      setIsImageLoading(true);
                    }}
                    aria-label={`View image ${index + 1}`}
                  >
                    <img
                      src={img.url}
                      alt={img.alt || `Thumbnail ${index + 1}`}
                      className="thumbnail-image"
                    />
                    {index === currentIndex && (
                      <div className="thumbnail-active-indicator" />
                    )}
                  </Button>
                ))}
              </div>
              <div className="image-viewer-counter">
                {currentIndex + 1} / {images.length}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};