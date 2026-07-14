import { Lightbulb } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

const TIPS = [
  'Use @ to reference workspace files, skills, and knowledge.',
  'Attach files with the + button to give the agent more context.',
  'Open the workspace to inspect agent knowledge and generated files.',
  'Scroll up to reveal the Jump to latest control.',
  'Fork a chat before exploring a different approach.',
] as const;

const TIP_INTERVAL_MS = 8_000;
const TIP_TRANSITION_MS = 300;


export function RibbonTip(): ReactElement {
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [nextTipIndex, setNextTipIndex] = useState<number | null>(null);

  useEffect(() => {
    let transitionTimeoutId: number | undefined;
    const intervalId = window.setInterval(() => {
      const nextIndex = (currentTipIndex + 1) % TIPS.length;
      setNextTipIndex(nextIndex);
      transitionTimeoutId = window.setTimeout(() => {
        setCurrentTipIndex(nextIndex);
        setNextTipIndex(null);
      }, TIP_TRANSITION_MS + 16);
    }, TIP_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      if (transitionTimeoutId !== undefined) window.clearTimeout(transitionTimeoutId);
    };
  }, [currentTipIndex]);

  const currentTip = TIPS[currentTipIndex];
  const nextTip = nextTipIndex === null ? null : TIPS[nextTipIndex];

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1 text-[11px] text-content-tertiary">
      <Lightbulb size={12} className="shrink-0 text-black" aria-hidden="true" />
      <div className="relative h-full min-w-0 flex-1 overflow-hidden">
        <p
          key={currentTipIndex}
          className={`absolute inset-0 flex min-w-0 items-center truncate ${nextTip ? 'animate-[ribbon-tip-exit_300ms_ease-out_forwards]' : ''}`}
          title={currentTip}
          aria-live="off"
        >
          {currentTip}
        </p>
        {nextTip && (
          <p
            key={nextTipIndex}
            className="absolute inset-0 flex min-w-0 items-center truncate animate-[ribbon-tip-enter_300ms_ease-out_forwards]"
            title={nextTip}
            aria-hidden="true"
          >
            {nextTip}
          </p>
        )}
      </div>
    </div>
  );
}
