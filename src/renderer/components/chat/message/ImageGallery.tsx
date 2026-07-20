import React, { useState, useMemo } from 'react';
import { ImageGalleryMenuAtom } from '../../menu/ImageGalleryContextMenu';
import { log } from '@/log';
import { toImageDisplaySrc } from '@/lib/mediaUrl';
import { ImageViewerAtom } from '../../ui/OverlayImageViewer';

const logger = log.child({ mod: 'ImageGallery' });

export interface MessageSegment {
  type: 'text' | 'image-gallery';
  content: string;
  id: string;
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
  const segments: MessageSegment[] = [];
  const pushText = (text: string, id: string) => {
    const trimmed = text.trim();
    if (trimmed) segments.push({ type: 'text', content: trimmed, id });
  };

  const registryRegex = /<IMAGE_REGISTRY>\s*([\s\S]*?)\s*<\/IMAGE_REGISTRY>/g;
  let segmentIndex = 0;
  let currentPosition = 0;
  let match: RegExpExecArray | null;
  let foundAnyRegistry = false;

  while ((match = registryRegex.exec(content)) !== null) {
    foundAnyRegistry = true;
    pushText(content.substring(currentPosition, match.index), `${messageId}_segment_${segmentIndex++}`);

    const imageRegistry = new Map<string, any>();
    for (const line of match[1].trim().split('\n')) {
      if (!line.trim()) continue;
      try {
        const image = JSON.parse(line.trim());
        if (image.id) imageRegistry.set(image.id, image);
      } catch {
        // 非 JSON 行(流式半截)直接跳过
      }
    }
    if (imageRegistry.size > 0) {
      segments.push({ type: 'image-gallery', content: '', id: `${messageId}_gallery_${segmentIndex++}`, imageRegistry });
    }
    currentPosition = match.index + match[0].length;
  }

  // 没有完整 registry: 要么流式半截,要么纯文本。
  if (!foundAnyRegistry) {
    const registryStart = content.indexOf('<IMAGE_REGISTRY>');
    if (registryStart === -1) {
      pushText(content, `${messageId}_segment_0`);
      return segments;
    }
    pushText(content.substring(0, registryStart), `${messageId}_segment_before_registry`);
    if (isStreaming) {
      pushText(content.substring(registryStart + '<IMAGE_REGISTRY>'.length), `${messageId}_segment_streaming_after_registry`);
    }
    return segments;
  }

  pushText(content.substring(currentPosition), `${messageId}_segment_${segmentIndex++}`);
  return segments;
};

interface ImageGalleryNewProps {
  agentId: string;
  sessionId: string;
  imageRegistry: Map<string, any>;
}

export const ImageGalleryNew: React.FC<ImageGalleryNewProps> = ({ agentId, sessionId, imageRegistry }) => {
  const [loadingStates, setLoadingStates] = useState<Map<string, boolean>>(new Map());
  const [errorStates, setErrorStates] = useState<Map<string, boolean>>(new Map());
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  const FIXED_HEIGHT = 130;
  const imageGalleryMenuActions = ImageGalleryMenuAtom.useChange();
  const imageViewer = ImageViewerAtom.useChange();

  // 同步解析展示 src —— **必须在渲染期算出,绝不延迟到 effect**。否则首帧 `cachedUrls`
  // 为空,`<img src>` 回退成裸 `local://`:既违反 CSP img-src(控制台报错),又触发
  // `<img onError>` 把 errorStates 永久置位(effect 后续改成 media:// 也救不回,呈现
  // 为竞态:restart 偶尔正常、reload 卡错误占位)。
  // `local://`/`knowledge://` → `media://`;`file://`/`http(s)`/`screenshot://` 原样;
  // 裸绝对路径 → `file://`。loading 由下方 `<img onLoad/onError>` 推进。
  const cachedUrls = useMemo(() => {
    const urls = new Map<string, string>();
    imageRegistry.forEach((imageData, id) => {
      urls.set(id, toImageDisplaySrc(imageData.url, { agentId, sessionId }));
    });
    return urls;
  }, [imageRegistry, agentId, sessionId]);

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

  const galleryImages = images
    .filter((imageData) => imageData && imageData.url)
    .map((imageData) => ({
      id: imageData.id || `unknown-${Date.now()}`,
      url: cachedUrls.get(imageData.id) || imageData.url,
      alt: imageData.alt || `Image ${imageData.id || 'unknown'}`
    }));

  const handleImageClick = (clickedIndex: number) => {
    if (galleryImages.length === 0) {
      logger.warn({ msg: "🚨 [ImageGallery] No valid images found for viewer" });
      return;
    }

    imageViewer.open(galleryImages, Math.min(clickedIndex, galleryImages.length - 1));
  };

  return (
    <div data-dbg="image-gallery" className="flex flex-col items-start gap-1 w-full">
      <div className="flex flex-wrap gap-1 items-start w-full">
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

          // 直供 src(本地文件 / sandbox media://)走可见 `<img>`;远程 http(s) 走 div 背景图。
          const isLocalFile =
            cachedUrl.startsWith('file://') ||
            cachedUrl.startsWith('media://') ||
            cachedUrl.startsWith('/');

          return (
            <div
              key={imageData.id || `fallback-${index}`}
              className="relative h-32.5 bg-[#D9D9D9] rounded overflow-hidden transition-[transform,box-shadow] shrink-0 cursor-pointer bg-center bg-cover bg-no-repeat hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:z-1"
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
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[rgba(250,250,250,0.95)] z-1">
                  <div className="w-10 h-10 mb-3 opacity-60">
                    <div className="w-full h-full border-[3px] border-[rgba(214,214,214,0.3)] border-t-[#404040] rounded-full animate-spin"></div>
                  </div>
                </div>
              )}

              {hasError && (
                <div className="w-full py-10 px-5 flex flex-col items-center justify-center gap-2 bg-[rgba(254,242,242,0.5)] border border-dashed border-[rgba(239,68,68,0.3)] rounded-lg text-center">
                  <span className="text-[32px]">⚠️</span>
                  <span className="text-sm text-[#dc2626] font-medium">Image failed to load</span>
                </div>
              )}

              {!hasError && (
                <img
                  className="m-0!"
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
