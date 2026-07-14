import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { cn } from '@/lib/utilities/utils';
import UnreadCountBadge from '@/components/common/UnreadCountBadge';
import { useProfileId } from '@/states/profile.atom';
import { useAgentUnreadSummary } from '@/lib/chat/useAgentUnreadSummary';

export type SessionPanelMode = 'sessions' | 'jobs';

interface AlarmToggleButtonProps {
  agentId: string | null;
  /** Whether the panel is currently in jobs mode (alarm icon stays in selected state). */
  mode: SessionPanelMode;
  /** The panel mode is URL-derived; job runs never become regular-session routes. */
}

/** Header alarm icon + scheduled-unread badge. Clicking switches between the sessions and jobs roots. */
const AlarmToggleButton: React.FC<AlarmToggleButtonProps> = ({ agentId, mode }) => {
  const navigate = useNavigate();
  const profileId = useProfileId();
  const { scheduledUnreadCount } = useAgentUnreadSummary(agentId, profileId);

  const handleClick = useCallback(() => {
    if (!agentId) return;
    if (mode === 'jobs') {
      navigate(`/agent/${agentId}`);
    } else {
      navigate(`/agent/${agentId}/job`);
    }
  }, [agentId, mode, navigate]);

  // Selected (jobs mode): keep the ghost variant but layer on a tinted brand
  // pill — colored border + soft blue fill + saturated icon — so the toggle
  // reads "on" at a glance. `cn`'s tailwind-merge guarantees these win over
  // the ghost variant's hover defaults.
  const isActive = mode === 'jobs';
  return (
    <Button
      data-dbg="alarm-toggle-button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        // Needed so the absolutely-positioned unread badge anchors against the button.
        'relative',
        isActive &&
          'border border-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700',
      )}
      onClick={handleClick}
      disabled={!agentId}
      title={isActive ? 'Show conversations' : 'Show schedules'}
      aria-label={isActive ? 'Show conversations' : 'Show schedules'}
      aria-pressed={isActive}
    >
      <AlarmClock size={14} />
      <UnreadCountBadge
        count={scheduledUnreadCount}
        className="absolute top-0.5 right-0 border-2 border-surface-primary shadow-[0_2px_6px_rgba(0,0,0,0.16)]"
        ariaLabel={`Schedules has ${scheduledUnreadCount} unread sessions`}
      />
    </Button>
  );
};

export default AlarmToggleButton;
