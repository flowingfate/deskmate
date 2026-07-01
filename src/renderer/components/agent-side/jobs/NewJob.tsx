import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { SCHEDULE_TEMPLATES } from '@renderer/components/agent-side/jobs/templates';

interface NewScheduleButtonProps {
  onOpenBlankSchedule: () => void;
  onOpenTemplate: (templateId: string) => void;
}

/**
 * Bottom-pinned, full-width "New schedule" button — the jobs-mode counterpart
 * to `SessionsView`'s "New Conversation" button, so the left pane keeps a stable
 * footer across both modes (and covers the backdrop illustration).
 *
 * When templates exist the button opens an **upward** dropdown (`Blank Schedule`
 * followed by every template); otherwise it directly opens the blank overlay.
 */
const NewScheduleButton: React.FC<NewScheduleButtonProps> = ({
  onOpenBlankSchedule,
  onOpenTemplate,
}) => {
  const hasTemplates = SCHEDULE_TEMPLATES.length > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleAddClick = useCallback(() => {
    if (hasTemplates) {
      setMenuOpen(prev => !prev);
    } else {
      onOpenBlankSchedule();
    }
  }, [hasTemplates, onOpenBlankSchedule]);

  const handleBlank = useCallback(() => {
    setMenuOpen(false);
    onOpenBlankSchedule();
  }, [onOpenBlankSchedule]);

  const handleTemplate = useCallback((templateId: string) => {
    setMenuOpen(false);
    onOpenTemplate(templateId);
  }, [onOpenTemplate]);

  return (
    <div ref={menuRef} className="relative shrink-0 pt-2 pb-3.75 flex items-center gap-1.5">
      <Button variant="outline" size="sm" className="w-full" onClick={handleBlank} title="New schedule">
        <span>New Blank Schedule</span>
      </Button>
      <Button variant="outline" size="icon-sm" className="shrink-0" onClick={handleAddClick} title="New schedule (with template)">
        <Plus size={14} />
      </Button>
      {menuOpen && (
        <div
          data-dbg="new-schedule-add-menu"
          className="absolute bottom-full right-0 flex flex-col bg-surface-primary border border-gray-200 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-50 overflow-hidden"
        >
          {SCHEDULE_TEMPLATES.map(tpl => (
            <Button
              key={tpl.id}
              variant="ghost"
              className="flex items-center gap-2 w-full justify-start px-3 py-1 rounded-none hover:bg-black/5"
              onClick={() => handleTemplate(tpl.id)}
              title={tpl.tooltip}
            >
              <Sparkles size={14} />
              <span>{tpl.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default NewScheduleButton;
