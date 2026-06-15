// Level 圆点 + 文字徽章。dot / pill / text 三种 variant，颜色走 tailwind utility。

import { cn } from '@/lib/utilities/utils';
import { levelDotClass, levelName, levelTextClass, levelTintBgClass } from '../levels';

interface Props {
  level: number;
  variant?: 'dot' | 'pill' | 'text';
  className?: string;
}

export function LevelBadge({ level, variant = 'pill', className }: Props) {
  const name = levelName(level);

  if (variant === 'dot') {
    return (
      <span
        aria-label={name}
        className={cn('inline-block h-2 w-2 shrink-0 rounded-full', levelDotClass(level), className)}
      />
    );
  }

  if (variant === 'text') {
    return (
      <span
        className={cn(
          'font-mono text-[10px] font-medium uppercase tracking-wider',
          levelTextClass(level),
          className,
        )}
      >
        {name}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-[1px] font-mono text-[10px] font-medium uppercase tracking-wider',
        levelTextClass(level),
        levelTintBgClass(level),
        className,
      )}
    >
      <span className={cn('inline-block h-1 w-1 rounded-full', levelDotClass(level))} />
      {name}
    </span>
  );
}
