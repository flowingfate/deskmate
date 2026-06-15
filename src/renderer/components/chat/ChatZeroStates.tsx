/**
 * ChatZeroStates Component
 * Initial chat experience component - displays a greeting and quick-start cards
 */

import React, { useState, useEffect } from 'react';
import { ZeroStates, QuickStartItem } from '../../lib/userData/types';
import './ChatZeroStates.scss';
import { log } from '@/log';
import { quickStartImageCacheApi } from '@/ipc/quickStartImageCache';
import { QUICK_START_IMAGE_URL } from '@shared/constants/endpoints';
const logger = log.child({ mod: 'ChatZeroStates' });

interface ChatZeroStatesProps {
  /** Zero States configuration */
  zeroStates: ZeroStates;
  /** Agent name, used for image caching */
  agentName: string;
  /** Callback when a quick-start card is clicked */
  onQuickStartClick: (prompt: string) => void;
}

/** Default quick-start card image */
const DEFAULT_QUICK_START_IMAGE = QUICK_START_IMAGE_URL;

/**
 * Quick-start card component.
 * Supports local image caching: prefers cached version, falls back to remote URL on failure.
 */
const QuickStartCard: React.FC<{
  item: QuickStartItem;
  agentName: string;
  onClick: () => void;
}> = ({ item, agentName, onClick }) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // If image is empty, use the default image
  const rawImageUrl = item.image && item.image.trim() ? item.image : DEFAULT_QUICK_START_IMAGE;

  useEffect(() => {
    let isMounted = true;

    const loadImage = async () => {
      setIsLoading(true);

      try {
        // Try to get the cached local path (auto-caches if not present)
        const result = await quickStartImageCacheApi.getOrCache(
          agentName,
          rawImageUrl
        );

        if (isMounted) {
          if (result?.success && result.data) {
            // Use the cached local file path
            setImageUrl(result.data);
          } else {
            // Fall back to the remote URL (add timestamp to avoid browser cache issues)
            const timestamp = Date.now();
            const separator = rawImageUrl.includes('?') ? '&' : '?';
            setImageUrl(`${rawImageUrl}${separator}t=${timestamp}`);
          }
        }
      } catch (error) {
        logger.error({ msg: "Failed to load cached image:", err: error });
        if (isMounted) {
          // Fall back to the remote URL on error
          const timestamp = Date.now();
          const separator = rawImageUrl.includes('?') ? '&' : '?';
          setImageUrl(`${rawImageUrl}${separator}t=${timestamp}`);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [agentName, rawImageUrl]);

  return (
    <div
      className="quick-start-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div
        className={`quick-start-card-image ${isLoading ? 'loading' : ''}`}
        style={{ backgroundImage: imageUrl ? `url(${imageUrl})` : undefined }}
      />
      <div className="quick-start-card-title">{item.title}</div>
      <div className="quick-start-card-description">{item.description}</div>
    </div>
  );
};

/**
 * ChatZeroStates main component.
 * Displayed in the chat content area, above ChatInput.
 */
const ChatZeroStates: React.FC<ChatZeroStatesProps> = ({
  zeroStates,
  agentName,
  onQuickStartClick
}) => {
  const { quick_starts } = zeroStates;

  const hasQuickStarts = quick_starts && quick_starts.length > 0;

  if (!hasQuickStarts) {
    return null;
  }

  return (
    <div className="chat-zero-states">
      {/* Quick Start List - horizontally scrollable list of cards */}
      {hasQuickStarts && (
        <div className="quick-start-list">
          {quick_starts!.map((item, index) => (
            <QuickStartCard
              key={`quick-start-${index}`}
              item={item}
              agentName={agentName}
              onClick={() => onQuickStartClick(item.prompt)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatZeroStates;
