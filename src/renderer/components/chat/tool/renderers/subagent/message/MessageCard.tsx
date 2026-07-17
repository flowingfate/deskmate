import type { ReactNode } from 'react';

interface MessageCardProps {
  label: string;
  time: number;
  tone: 'user' | 'assistant';
  children: ReactNode;
}

export function MessageCard({ label, time, tone, children }: MessageCardProps) {
  const timestamp = new Date(time);
  const formattedTime = timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const toneClassName = tone === 'user'
    ? 'border-sky-100 bg-sky-50/40'
    : 'border-black/8 bg-white';

  return (
    <article className={`rounded-md border p-3 ${toneClassName}`}>
      <header className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-gray-700">{label}</span>
        <time className="shrink-0 text-gray-500" dateTime={timestamp.toISOString()}>
          {formattedTime}
        </time>
      </header>
      {children}
    </article>
  );
}

export function EmptyMessageNotice() {
  return <p className="m-0 text-xs italic text-gray-500">No visible content was recorded.</p>;
}
