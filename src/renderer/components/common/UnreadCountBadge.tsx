import React from 'react';

import { formatUnreadBadgeCount } from '../../lib/chat/useAgentUnreadSummary';

interface UnreadCountBadgeProps {
  count: number;
  className?: string;
  ariaLabel?: string;
}

const UnreadCountBadge: React.FC<UnreadCountBadgeProps> = ({
  count,
  className = '',
  ariaLabel,
}) => {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      className={`min-w-4 h-4.5 px-1 inline-flex items-center justify-center rounded-full bg-[#d92d20] text-white text-[10px] font-bold leading-none whitespace-nowrap pointer-events-none ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {formatUnreadBadgeCount(count)}
    </span>
  );
};

export default UnreadCountBadge;