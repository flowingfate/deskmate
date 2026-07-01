import React from 'react';
import type { PresetPrompt } from './presetPrompts';
import { resolvePresetIcon } from './presetIcons';

interface PresetPromptCardProps {
  prompt: PresetPrompt;
  onSelect: (prompt: PresetPrompt) => void;
}

/**
 * 单张预设提示词卡片。点击整卡触发 `onSelect`（把提示词填入输入框，不发送）。
 * 纯黑白风格：默认浅边框，hover 时边框加深、微微抬起。
 */
export function PresetPromptCard({ prompt, onSelect }: PresetPromptCardProps) {
  const Icon = resolvePresetIcon(prompt.iconKey);
  return (
    <button
      type="button"
      onClick={() => onSelect(prompt)}
      className="group flex items-start gap-3 rounded-xl border border-black/8 bg-white px-4 py-3.5 text-left transition-all duration-200 hover:border-black/25 hover:bg-black/2 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
    >
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-black/8 bg-black/3 text-black/70 transition-colors group-hover:border-black/20 group-hover:bg-black group-hover:text-white">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-black/85">
          {prompt.title}
        </span>
        {prompt.description && (
          <span className="mt-0.5 block truncate text-xs text-black/45">
            {prompt.description}
          </span>
        )}
      </span>
    </button>
  );
}
