import React, { useEffect, useRef, useMemo } from 'react';

interface MentionHighlightProps {
  text: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};
const HTML_ESCAPE_RE = /[&<>"']/g;

const URI_MENTION = /\[@(?:knowledge:\/\/|local:\/\/)[^\]]+\]/;
const SKILL_MENTION = /\[#skill:([^\]]+)\]/;
const NEWLINE = /\n/;
const MENTION_RE = new RegExp(
  `${URI_MENTION.source}|${SKILL_MENTION.source}|${NEWLINE.source}`,
  'g',
);

function highlightMentions(text: string): string {
  if (!text) return '';

  const escaped = text.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch]);

  return escaped.replace(MENTION_RE, (match) => {
    if (match === '\n') return '<br>';
    if (match.startsWith('[#')) {
      return `<mark class="mention-highlight skill-mention">${match}</mark>`;
    }
    return `<mark class="mention-highlight uri-mention">${match}</mark>`;
  });
}

export const MentionHighlight: React.FC<MentionHighlightProps> = ({ text, textareaRef }) => {
  const highlightRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    const content = contentRef.current;

    if (!textarea || !content) return;

    const syncScroll = () => {
      content.style.transform = `translateY(-${textarea.scrollTop}px)`;
    };

    textarea.addEventListener('scroll', syncScroll);
    return () => {
      textarea.removeEventListener('scroll', syncScroll);
    };
  }, [textareaRef]);

  const html = useMemo(() => highlightMentions(text), [text]);

  return (
    <div
      ref={highlightRef}
      className="absolute inset-0 px-5 m-0 font-[inherit] text-[13px] leading-[1.6] whitespace-pre-wrap wrap-break-word overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pointer-events-none text-transparent z-1"
    >
      <div
        ref={contentRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};