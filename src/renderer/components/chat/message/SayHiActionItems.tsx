/**
 * SayHiActionItems Component
 *
 * Renders clickable action-item chips extracted from a Say-Hi message.
 * Supports optional grouping via `## Group Title` headers inside the
 * action-items section.
 *
 */

import React from 'react';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { sendUserPrompt } from '@/lib/chat/sendUserMessageOptimistically';

/** Delimiter that separates the markdown body from the action items list. */
export const SAY_HI_ACTION_ITEMS_DELIMITER = '<!-- SAY_HI_ACTION_ITEMS -->';

/** A group of action items with an optional title. */
export interface ActionItemGroup {
  /** Group heading (e.g. "📂 Add context from local files"). Empty string for the default/ungrouped block. */
  title: string;
  /** Prompt strings displayed as clickable chips. */
  items: string[];
}

/**
 * Parse a Say-Hi message's raw text content and split it into the
 * displayable markdown body and an array of action-item groups.
 *
 * Lines starting with `## ` inside the action-items section are treated
 * as group headings. If no headings are present all items land in a
 * single group with an empty title.
 */
export function parseSayHiContent(rawText: string): {
  markdownBody: string;
  actionItems: string[];
  actionItemGroups: ActionItemGroup[];
} {
  const delimiterIndex = rawText.indexOf(SAY_HI_ACTION_ITEMS_DELIMITER);

  if (delimiterIndex === -1) {
    return { markdownBody: rawText, actionItems: [], actionItemGroups: [] };
  }

  const markdownBody = rawText.slice(0, delimiterIndex).trimEnd();
  const actionSection = rawText.slice(delimiterIndex + SAY_HI_ACTION_ITEMS_DELIMITER.length);

  const lines = actionSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Build groups
  const groups: ActionItemGroup[] = [];
  let currentGroup: ActionItemGroup = { title: '', items: [] };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Flush previous group if it has items
      if (currentGroup.items.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = { title: line.slice(3).trim(), items: [] };
    } else {
      currentGroup.items.push(line);
    }
  }
  // Flush last group
  if (currentGroup.items.length > 0) {
    groups.push(currentGroup);
  }

  // Flat list for backward compatibility
  const actionItems = groups.flatMap(g => g.items);

  return { markdownBody, actionItems, actionItemGroups: groups };
}

interface SayHiActionItemsProps {
  /** Grouped action-item prompts to display. */
  groups: ActionItemGroup[];
}

const SayHiActionItems: React.FC<SayHiActionItemsProps> = ({ groups }) => {
  if (!groups || groups.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 mt-3 pt-1">
      {groups.map((group, gIdx) => (
        <div key={`group-${gIdx}`} className="flex flex-col gap-2">
          {group.title && (
            <div className="text-xs font-semibold text-[#e8853a] tracking-[0.02em] pl-0.5">{group.title}</div>
          )}
          <div className="flex flex-col items-start gap-2">
            {group.items.map((item, index) => (
              <Button
                key={`action-${gIdx}-${index}`}
                variant="ghost"
                size="icon"
                className="group inline-flex items-center gap-1.5 h-auto w-auto px-3.5 py-[7px] border border-orange-500/30 rounded-[18px] bg-orange-500/[0.08] text-[#e8853a] text-[13px] font-medium leading-[1.4] cursor-pointer transition-all duration-[180ms] ease-in-out text-left whitespace-nowrap max-w-full hover:bg-orange-500/[0.18] hover:border-orange-500/50 hover:text-amber-500 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(249,115,22,0.15)] active:translate-y-0 active:shadow-none active:bg-orange-500/25"
                onClick={() => sendUserPrompt(item)}
                title={item}
              >
                <MessageCircle size={14} className="shrink-0 opacity-65 group-hover:opacity-100" />
                <span className="truncate">{item}</span>
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SayHiActionItems;
