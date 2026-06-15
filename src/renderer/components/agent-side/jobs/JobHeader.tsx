import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { Button } from '@/shadcn/button';
import ListSearchBox from '@/components/ui/ListSearchBox';
import { SCHEDULE_TEMPLATES } from '@/components/chat/agent-editor/scheduleTemplates';

interface JobHeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenBlankSchedule: () => void;
  onOpenTemplate: (templateId: string) => void;
}

/**
 * `JobsView` top strip: search input on the left, "+" button on the right.
 * When templates exist, "+" opens a dropdown listing `Blank Schedule`
 * followed by every template; otherwise it directly opens the blank overlay.
 */
const JobHeader: React.FC<JobHeaderProps> = ({
  searchQuery,
  onSearchChange,
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
    <div
      data-dbg="jobs-header"
      className="flex items-center gap-1 p-0 shrink-0"
    >
      <div className="flex-1 min-w-0">
        <ListSearchBox
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search schedules"
          className="my-1 shadow-none"
        />
      </div>
      <div ref={menuRef} className="relative shrink-0">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={handleAddClick}
          title="New schedule"
          aria-label="New schedule"
        >
          <Plus size={14} />
        </Button>
        {menuOpen && (
          <div
            data-dbg="jobs-header-add-menu"
            className="absolute top-full right-0 mt-1 min-w-[220px] flex flex-col bg-surface-primary border border-gray-200 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-50 overflow-hidden"
          >
            <Button
              variant="ghost"
              className="flex items-center gap-2 w-full justify-start px-3 py-2 rounded-none hover:bg-black/[0.05]"
              onClick={handleBlank}
            >
              <Plus size={14} />
              <span>Blank Schedule</span>
            </Button>
            <div className="h-px bg-gray-200" />
            {SCHEDULE_TEMPLATES.map(tpl => (
              <Button
                key={tpl.id}
                variant="ghost"
                className="flex items-center gap-2 w-full justify-start px-3 py-2 rounded-none hover:bg-black/[0.05]"
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
    </div>
  );
};

export default JobHeader;
