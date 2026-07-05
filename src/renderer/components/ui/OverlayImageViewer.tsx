import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/shadcn/button';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogPortal } from '@/shadcn/dialog';
import { atom } from '@/atom';
import { log } from '@/log';
const logger = log.child({ mod: 'OverlayImageViewer' });

// 深色浮层上的圆形玻璃按钮（工具栏 + 左右翻页共用视觉：白色半透明 + backdrop-blur + hover 放大）。
// shadcn Button 的 ghost hover 由 twMerge 用后置类覆盖，故显式补 hover:bg/border/text。
const TOOL_BTN =
  'w-12 h-12 flex items-center justify-center bg-white/10 border border-white/20 rounded-full text-white transition-all duration-200 backdrop-blur-[10px] hover:bg-white/20 hover:border-white/30 hover:text-white hover:scale-110 active:scale-95 max-md:w-10 max-md:h-10';
const NAV_BTN =
  'fixed top-1/2 -translate-y-1/2 z-[10001] w-16 h-16 flex items-center justify-center bg-white/10 border border-white/20 rounded-full text-white transition-all duration-200 backdrop-blur-[10px] hover:bg-white/20 hover:border-white/30 hover:text-white hover:scale-110 active:scale-95 max-md:w-12 max-md:h-12';

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
    const newLocal = "fixed inset-0 flex items-center justify-center z-[9999] bg-black/95 animate-[imageViewerFadeIn_0.2s_ease-out] select-none";
    return (
      <Dialog open={true} onOpenChange={(open) => { if (!open) actions.close(); }}>
        <DialogPortal>
          <DialogPrimitive.Content className={newLocal} onClick={actions.close}>
            <DialogPrimitive.Title className="sr-only">Image Error</DialogPrimitive.Title>
            <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center">
              <div className="flex flex-col items-center gap-4 text-white">
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
          className="fixed inset-0 flex items-center justify-center z-9999 bg-black/95 animate-[imageViewerFadeIn_0.2s_ease-out] select-none"
          data-dbg="OverlayImageViewer"
          onClick={handleOverlayClick}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            actions.close();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Image Viewer</DialogPrimitive.Title>

          {/* Toolbar buttons */}
          <div className="fixed top-6 right-6 z-10001 flex gap-3 animate-[toolbarSlideIn_0.3s_ease-out] max-md:top-4 max-md:right-4 max-md:gap-2">
            {/* Save button */}
            <Button
              variant="ghost"
              size="icon"
              className={TOOL_BTN}
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
              className={TOOL_BTN}
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
              className={`${NAV_BTN} left-8 max-md:left-4`}
              onClick={handlePrevious}
              aria-label="Previous image"
            >
              <ChevronLeft size={48} />
            </Button>
          )}

          {/* Image container */}
          <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center">
            {isImageLoading && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-4">
                <div className="w-15 h-15">
                  <div className="w-full h-full border-4 border-white/20 border-t-white rounded-full animate-[spin_0.8s_linear_infinite]"></div>
                </div>
                <div className="text-base text-white/80 font-medium">Loading...</div>
              </div>
            )}
            <img
              src={currentImage.url}
              alt={currentImage.alt || `Image ${currentIndex + 1}`}
              className="max-w-full max-h-[90vh] w-auto h-auto object-contain object-center rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] animate-[imageZoomIn_0.3s_ease-out]"
              onLoad={handleImageLoad}
              style={{ display: isImageLoading ? 'none' : 'block' }}
            />
            {currentImage.alt && !isImageLoading && (
              <div className="fixed bottom-20 left-1/2 transform-[translateX(-50%)] max-w-[80vw] px-6 py-3 bg-black/80 border border-white/10 rounded-lg text-white text-sm leading-normal text-center backdrop-blur-[10px] animate-[captionSlideUp_0.3s_ease-out] max-md:bottom-35 max-md:max-w-[90vw] max-md:px-4 max-md:py-2.5 max-md:text-[13px]">
                {currentImage.alt}
              </div>
            )}
          </div>

          {/* Right arrow */}
          {canGoNext && (
            <Button
              variant="ghost"
              size="icon"
              className={`${NAV_BTN} right-8 max-md:right-4`}
              onClick={handleNext}
              aria-label="Next image"
            >
              <ChevronRight size={48} />
            </Button>
          )}

          {/* Thumbnail indicator */}
          {images.length > 1 && (
            <div className="fixed bottom-6 left-1/2 transform-[translateX(-50%)] flex flex-col items-center gap-3 max-w-[90vw] animate-[captionSlideUp_0.3s_ease-out] max-md:bottom-4 max-md:max-w-[95vw]">
              <div className="flex gap-2 p-3 bg-black/80 border border-white/10 rounded-xl backdrop-blur-[10px] overflow-x-auto max-w-full [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.3)_transparent] max-md:p-2 max-md:gap-1.5">
                {images.map((img, index) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    key={img.id}
                    className={`relative w-20 h-20 shrink-0 border-2 rounded-lg overflow-hidden cursor-pointer transition-all duration-200 bg-white/5 hover:scale-105 max-md:w-15 max-md:h-15 ${index === currentIndex ? 'border-white shadow-[0_0_12px_rgba(255,255,255,0.5)]' : 'border-transparent hover:border-white/30'}`}
                    onClick={() => {
                      setCurrentIndex(index);
                      setIsImageLoading(true);
                    }}
                    aria-label={`View image ${index + 1}`}
                  >
                    <img
                      src={img.url}
                      alt={img.alt || `Thumbnail ${index + 1}`}
                      className="w-full h-full object-cover object-center"
                    />
                    {index === currentIndex && (
                      <div className="absolute bottom-1 left-1/2 transform-[translateX(-50%)] w-6 h-0.75 bg-white rounded-[2px] shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
                    )}
                  </Button>
                ))}
              </div>
              <div className="px-4 py-1.5 bg-black/80 border border-white/10 rounded-2xl backdrop-blur-[10px] text-white text-[13px] font-medium whitespace-nowrap max-md:text-xs max-md:px-3 max-md:py-1">
                {currentIndex + 1} / {images.length}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};