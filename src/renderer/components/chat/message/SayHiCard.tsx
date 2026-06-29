/**
 * SayHiCard – generic single-card component for say-hi / onboarding UX.
 *
 * Renders one action card with an emoji icon, a bold title, and a muted
 * description line.  All interaction logic (what happens on click) is left
 * to the caller via the `onClick` prop, keeping this component fully reusable.
 *
 * Usage example:
 *   <SayHiCard
 *     emoji="💬"
 *     title="Search the web"
 *     description="Summarize the latest status and add as context."
 *     onClick={() => sendMessage('Summarize ...')}
 *   />
 */

import React from 'react';

export interface SayHiCardProps {
  /** Emoji displayed inside the icon box. */
  emoji: string;
  /** Bold card title. */
  title: string;
  /** Muted one-line description shown below the title. */
  description: string;
  /** Called when the card is clicked or activated via keyboard. */
  onClick: () => void;
}

const SayHiCard: React.FC<SayHiCardProps> = ({ emoji, title, description, onClick }) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className="group flex items-center gap-3.5 px-4 py-3 border border-[#e8e5e0] rounded-xl bg-white cursor-pointer transition-[border-color,background,box-shadow] duration-180 ease-in-out select-none text-left hover:border-blue-600 hover:bg-[#f8faff] hover:shadow-[0_2px_8px_rgba(37,99,235,0.08)] active:bg-blue-50 focus-visible:outline focus-visible:outline-[#2563eb] focus-visible:outline-offset-2"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-center w-9.5 h-9.5 bg-[#f0f5ff] rounded-[10px] shrink-0 text-lg leading-none transition-colors duration-180 group-hover:bg-[#e0edff]">
        <span>{emoji}</span>
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-[13px] font-semibold text-[#1a1a1a] mb-0.5 leading-[1.4]">{title}</h4>
        <p className="text-xs text-[#888] leading-normal truncate">{description}</p>
      </div>
    </div>
  );
};

export default SayHiCard;
