import React, { createElement } from 'react';
import { Copy, Download, Eye } from 'lucide-react';
import { atom } from '@/atom';
import { log } from '@/log';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';
const logger = log.child({ mod: 'ImageGalleryContextMenu' });

const zeroState: {
  isOpen: boolean;
  position: { top: number; left: number } | null;
  imageData: { url: string; alt?: string; index: number } | null;
  galleryImages: Array<{ id: string; url: string; alt?: string }> | null;
  initialIndex: number;
} = { isOpen: false, position: null, imageData: null, galleryImages: null, initialIndex: 0 };

export const ImageGalleryMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function open(
    event: React.MouseEvent,
    imageData: { url: string; alt?: string; index: number },
    galleryImages?: Array<{ id: string; url: string; alt?: string }>,
    initialIndex?: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    set({
      isOpen: true,
      position: { top: event.clientY, left: event.clientX },
      imageData,
      galleryImages: galleryImages || null,
      initialIndex: initialIndex ?? 0,
    });
  }

  return { open, close };
});

interface InnerProps {
  position: { top: number; left: number };
  imageData: { url: string; alt?: string; index: number };
  galleryImages: Array<{ id: string; url: string; alt?: string }> | null;
  initialIndex: number;
}

const ImageGalleryContextMenu: React.FC<InnerProps> = ({
  position,
  imageData,
  galleryImages,
  initialIndex,
}) => {
  const { close: onClose } = ImageGalleryMenuAtom.useChange();

  const handleViewImage = React.useCallback(() => {
    const imagesToOpen = galleryImages && galleryImages.length > 0
      ? galleryImages
      : [{
          id: `image-${imageData.index}`,
          url: imageData.url,
          alt: imageData.alt
        }];

    const indexToUse = galleryImages && galleryImages.length > 0
      ? initialIndex
      : 0;

    window.dispatchEvent(new CustomEvent('imageViewer:open', {
      detail: {
        images: imagesToOpen,
        initialIndex: indexToUse
      }
    }));
  }, [imageData, galleryImages, initialIndex]);

  const convertToPNG = React.useCallback(async (imageUrl: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert image to PNG'));
            }
          },
          'image/png',
          1.0
        );
      };

      img.onerror = () => {
        reject(new Error('Failed to load image for conversion'));
      };

      img.src = imageUrl;
    });
  }, []);

  const handleCopyImage = React.useCallback(async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.write) {
        throw new Error('Clipboard API not supported');
      }

      if (typeof ClipboardItem === 'undefined') {
        throw new Error('ClipboardItem not supported');
      }

      logger.debug({ msg: "🔄 Processing image for clipboard..." });

      let finalBlob: Blob;

      finalBlob = await convertToPNG(imageData.url);

      if (finalBlob.size === 0) {
        throw new Error('Image data is empty');
      }

      const clipboardItem = new ClipboardItem({
        'image/png': finalBlob
      });

      await navigator.clipboard.write([clipboardItem]);

      logger.debug({ msg: `✅ Image copied to clipboard successfully: image/png, size: ${finalBlob.size} bytes` });

    } catch (error) {
      logger.error({ msg: "❌ Failed to copy image:", err: error });
      logger.debug({ msg: "ℹ️  Image copy failed. This may be due to browser security restrictions or unsupported format." });
    }
  }, [imageData, convertToPNG]);

  const handleSaveAs = React.useCallback(() => {
    try {
      const link = document.createElement('a');
      link.href = imageData.url;

      const fileName = imageData.alt || `image-${imageData.index + 1}`;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      logger.error({ msg: "Failed to save image:", err: error });
    }
  }, [imageData]);

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: 0,
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0}>
        <DropdownMenuItem onClick={handleViewImage}>
          <Eye size={16} strokeWidth={2} />
          View image
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyImage}>
          <Copy size={16} strokeWidth={2} />
          Copy
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSaveAs}>
          <Download size={16} strokeWidth={2} />
          Save as
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default () => {
  const [{ isOpen, position, imageData, galleryImages, initialIndex }] = ImageGalleryMenuAtom.use();
  if (!isOpen || !position || !imageData) return null;
  return createElement(ImageGalleryContextMenu, { position, imageData, galleryImages, initialIndex });
};
