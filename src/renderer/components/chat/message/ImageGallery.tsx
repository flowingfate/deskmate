import React, { useEffect, useState } from 'react';
import { ImageGalleryMenuAtom } from '../../menu/ImageGalleryContextMenu';
import { log } from '@/log';

const logger = log.child({ mod: 'ImageGallery' });

export interface MessageSegment {
  type: 'text' | 'image' | 'image-placeholder' | 'image-gallery';
  content: string;
  id: string;
  originalMessageId: string;
  segmentIndex: number;
  imageRegistry?: Map<string, any>;
}

export const hasNewImageFormat = (content: string): boolean => {
  const trimmedContent = content.trim();

  const hasCompleteRegistry = /<IMAGE_REGISTRY>\s*([\s\S]*?)\s*<\/IMAGE_REGISTRY>/.test(trimmedContent);
  if (hasCompleteRegistry) {
    return true;
  }

  const hasRegistryStartWithNewline = /<IMAGE_REGISTRY>\s*\n/.test(trimmedContent);
  if (hasRegistryStartWithNewline) {
    return true;
  }

  const REGISTRY_PREFIXES = [
    '<', '<I', '<IM', '<IMA', '<IMAG', '<IMAGE', '<IMAGE_',
    '<IMAGE_R', '<IMAGE_RE', '<IMAGE_REG', '<IMAGE_REGI',
    '<IMAGE_REGIS', '<IMAGE_REGIST', '<IMAGE_REGISTR'
  ];

  return REGISTRY_PREFIXES.includes(trimmedContent);
};

export const parseNewFormatMessage = (content: string, messageId: string, isStreaming: boolean = false): MessageSegment[] => {
  logger.debug({ msg: "🎬 START", messageId, isStreaming });
  logger.debug({ msg: "📝 [parseNewFormatMessage] Content length:", data: content.length });

  const segments: MessageSegment[] = [];
  let segmentIndex = 0;
  let currentPosition = 0;

  const registryRegex = /<IMAGE_REGISTRY>\s*([\s\S]*?)\s*<\/IMAGE_REGISTRY>/g;
  let match;
  let foundAnyRegistry = false;

  while ((match = registryRegex.exec(content)) !== null) {
    foundAnyRegistry = true;
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;
    const registryContent = match[1].trim();

    logger.debug({ msg: `🔍 [parseNewFormatMessage] Found IMAGE_REGISTRY at position ${matchStart}-${matchEnd}` });

    if (matchStart > currentPosition) {
      const beforeText = content.substring(currentPosition, matchStart).trim();
      if (beforeText) {
        segments.push({
          type: 'text',
          content: beforeText,
          id: `${messageId}_segment_${segmentIndex++}`,
          originalMessageId: messageId,
          segmentIndex: segmentIndex - 1
        });
        logger.debug({ msg: `📝 [parseNewFormatMessage] Added text segment before registry: ${beforeText.length} chars` });
      }
    }

    const imageRegistry = new Map<string, any>();

    if (registryContent) {
      const lines = registryContent.split('\n');
      logger.debug({ msg: "📊 Processing registry lines", lineCount: lines.length });
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          try {
            const imageData = JSON.parse(trimmedLine);
            if (imageData.id) {
              imageRegistry.set(imageData.id, imageData);
              logger.debug({ msg: "🖼️ [parseNewFormatMessage] Registered image:", data: imageData.id });
            }
          } catch (error) {
            logger.debug({ msg: "⚠️ [parseNewFormatMessage] Skipping non-JSON line:", data: trimmedLine.substring(0, 50) });
          }
        }
      }
    }

    if (imageRegistry.size > 0) {
      segments.push({
        type: 'image-gallery',
        content: '',
        id: `${messageId}_gallery_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1,
        imageRegistry: imageRegistry
      });
      logger.debug({ msg: `🎨 [parseNewFormatMessage] Added gallery segment with ${imageRegistry.size} images` });
    }

    currentPosition = matchEnd;
  }

  if (!foundAnyRegistry) {
    logger.debug({ msg: "⚠️ [parseNewFormatMessage] No complete IMAGE_REGISTRY found" });

    const hasRegistryStart = content.includes('<IMAGE_REGISTRY>');

    if (hasRegistryStart) {
      logger.debug({ msg: "🔄 [parseNewFormatMessage] IMAGE_REGISTRY is still streaming" });

      const registryStartIndex = content.indexOf('<IMAGE_REGISTRY>');

      const beforeRegistry = content.substring(0, registryStartIndex).trim();
      if (beforeRegistry) {
        segments.push({
          type: 'text',
          content: beforeRegistry,
          id: `${messageId}_segment_before_registry`,
          originalMessageId: messageId,
          segmentIndex: segmentIndex++
        });
      }

      if (isStreaming) {
        const afterRegistryStart = content.substring(registryStartIndex).trim();
        const contentAfterTag = afterRegistryStart.substring('<IMAGE_REGISTRY>'.length).trim();
        if (contentAfterTag) {
          segments.push({
            type: 'text',
            content: contentAfterTag,
            id: `${messageId}_segment_streaming_after_registry`,
            originalMessageId: messageId,
            segmentIndex: segmentIndex++
          });
        }
      }

      logger.debug({ msg: "⏳ [parseNewFormatMessage] Waiting for IMAGE_REGISTRY to complete..." });
      return segments;
    }

    const visibleContent = content.trim();
    if (visibleContent) {
      segments.push({
        type: 'text',
        content: visibleContent,
        id: `${messageId}_segment_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1
      });
    }
    return segments;
  }

  if (currentPosition < content.length) {
    const afterLastRegistry = content.substring(currentPosition).trim();
    if (afterLastRegistry) {
      segments.push({
        type: 'text',
        content: afterLastRegistry,
        id: `${messageId}_segment_${segmentIndex++}`,
        originalMessageId: messageId,
        segmentIndex: segmentIndex - 1
      });
      logger.debug({ msg: `📄 [parseNewFormatMessage] Added final text segment: ${afterLastRegistry.length} chars` });
    }
  }

  logger.debug({ msg: "✅ [parseNewFormatMessage] END - Total segments:", data: segments.length });
  logger.debug({ msg: "📊 [parseNewFormatMessage] Segment types:", data: segments.map(s => s.type).join(', ') });

  return segments;
};

const imageCache = new Map<string, string>();

export const ImageGalleryNew: React.FC<{ imageRegistry: Map<string, any> }> = ({ imageRegistry }) => {
  const [loadingStates, setLoadingStates] = useState<Map<string, boolean>>(new Map());
  const [errorStates, setErrorStates] = useState<Map<string, boolean>>(new Map());
  const [cachedUrls, setCachedUrls] = useState<Map<string, string>>(new Map());
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  const FIXED_HEIGHT = 130;
  const imageGalleryMenuActions = ImageGalleryMenuAtom.useChange();

  useEffect(() => {
    const initialLoadingStates = new Map<string, boolean>();
    const initialCachedUrls = new Map<string, string>();

    imageRegistry.forEach((imageData, id) => {
      const url = imageData.url;

      if (imageCache.has(url)) {
        initialCachedUrls.set(id, imageCache.get(url)!);
        initialLoadingStates.set(id, false);
      } else {
        initialLoadingStates.set(id, true);
        cacheImage(url, id);
      }
    });

    setLoadingStates(initialLoadingStates);
    setCachedUrls(initialCachedUrls);
  }, [imageRegistry]);

  const resolveImageReady = (imageId: string, cachedUrl: string) => {
    setCachedUrls(prev => { const m = new Map(prev); m.set(imageId, cachedUrl); return m; });
    setLoadingStates(prev => { const m = new Map(prev); m.set(imageId, false); return m; });
  };

  const cacheImage = async (url: string, imageId: string) => {
    try {
      if (imageCache.has(url)) {
        resolveImageReady(imageId, imageCache.get(url)!);
        return;
      }

      if (url.startsWith('file://') || url.startsWith('/')) {
        const directUrl = url.startsWith('/') ? `file://${url}` : url;
        imageCache.set(url, directUrl);
        resolveImageReady(imageId, directUrl);
        return;
      }

      const response = await fetch(url);
      const blob = await response.blob();

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        imageCache.set(url, base64data);
        resolveImageReady(imageId, base64data);
      };

      reader.onerror = () => {
        handleImageError(imageId);
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      logger.error({ msg: "Failed to cache image:", err: error, data: url });
      handleImageError(imageId);
    }
  };

  const handleImageLoad = (imageId: string) => {
    setLoadingStates(prev => {
      const newState = new Map(prev);
      newState.set(imageId, false);
      return newState;
    });
  };

  const handleImageError = (imageId: string) => {
    setLoadingStates(prev => {
      const newState = new Map(prev);
      newState.set(imageId, false);
      return newState;
    });
    setErrorStates(prev => {
      const newState = new Map(prev);
      newState.set(imageId, true);
      return newState;
    });
  };

  const handleImageLoadWithDimensions = (imageId: string, imgElement: HTMLImageElement) => {
    const naturalWidth = imgElement.naturalWidth;
    const naturalHeight = imgElement.naturalHeight;

    if (naturalWidth && naturalHeight) {
      setImageDimensions(prev => {
        const newDimensions = new Map(prev);
        newDimensions.set(imageId, { width: naturalWidth, height: naturalHeight });
        return newDimensions;
      });
    }

    handleImageLoad(imageId);
  };

  const images = Array.from(imageRegistry.values());

  if (images.length === 0) {
    return null;
  }

  const handleImageClick = (clickedIndex: number) => {
    const galleryImages = images
      .filter((imageData) => imageData && imageData.url)
      .map((imageData) => ({
        id: imageData.id || `unknown-${Date.now()}`,
        url: cachedUrls.get(imageData.id) || imageData.url,
        alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
      }));

    if (galleryImages.length === 0) {
      logger.warn({ msg: "🚨 [ImageGallery] No valid images found for viewer" });
      return;
    }

    window.dispatchEvent(new CustomEvent('imageViewer:open', {
      detail: {
        images: galleryImages,
        initialIndex: Math.min(clickedIndex, galleryImages.length - 1)
      }
    }));
  };

  const galleryImages = images
    .filter((imageData) => imageData && imageData.url)
    .map((imageData) => ({
      id: imageData.id || `unknown-${Date.now()}`,
      url: cachedUrls.get(imageData.id) || imageData.url,
      alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
    }));

  return (
    <div className="image-gallery-new">
      <div className="gallery-grid-container">
        {images.map((imageData, index) => {
          if (!imageData || !imageData.url) {
            logger.warn({ msg: "🚨 Skipping invalid image data", index, imageData });
            return null;
          }

          const isLoading = loadingStates.get(imageData.id) ?? true;
          const hasError = errorStates.get(imageData.id) ?? false;
          const cachedUrl = cachedUrls.get(imageData.id) || imageData.url;

          const dimensions = imageDimensions.get(imageData.id);
          let calculatedWidth = 130;
          if (dimensions && dimensions.height > 0) {
            const aspectRatio = dimensions.width / dimensions.height;
            calculatedWidth = Math.round(FIXED_HEIGHT * aspectRatio);
          }

          const isLocalFile = cachedUrl.startsWith('file://') || cachedUrl.startsWith('/');

          return (
            <div
              key={imageData.id || `fallback-${index}`}
              className="gallery-grid-item"
              style={{
                width: `${calculatedWidth}px`,
                maxWidth: '100%',
                backgroundImage: !isLocalFile && !isLoading && !hasError ? `url(${cachedUrl})` : 'none',
                backgroundColor: '#D9D9D9'
              }}
              onClick={!isLoading && !hasError ? () => handleImageClick(index) : undefined}
              onContextMenu={!isLoading && !hasError ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                const image = { url: cachedUrl, alt: imageData.alt, index };
                imageGalleryMenuActions.open(e, image, galleryImages, index);
              } : undefined}
              title={!isLoading && !hasError ? "Click to view full size | Right-click for more options" : undefined}
            >
              {isLoading && (
                <div className="image-loading-overlay">
                  <div className="loading-spinner">
                    <div className="spinner-circle"></div>
                  </div>
                </div>
              )}

              {hasError && (
                <div className="image-error-placeholder">
                  <span className="error-icon">⚠️</span>
                  <span className="error-text">Image failed to load</span>
                </div>
              )}

              {!hasError && (
                <img
                  src={cachedUrl}
                  alt={imageData.alt || `Image ${imageData.id}`}
                  onLoad={(e) => handleImageLoadWithDimensions(imageData.id, e.currentTarget)}
                  onError={() => handleImageError(imageData.id)}
                  style={isLocalFile
                    ? { width: '100%', height: '100%', objectFit: 'cover' }
                    : { display: 'none' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
