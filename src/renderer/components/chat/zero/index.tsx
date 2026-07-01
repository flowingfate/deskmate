import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { composeTextAtom } from '../chat-input/Textarea';
import { Button } from '@/shadcn/button';
import { useCurrentAgent } from '@/states/agents.atom';
import { ZERO_CHAT } from './illustrarion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shadcn/alert-dialog';
import { usePresetPrompts, type PresetPrompt } from './presetPrompts';
import { PresetPromptCard } from './PresetPromptCard';

/** 填入后把光标移到末尾并聚焦，让用户可直接续写。 */
function focusComposeInput() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLTextAreaElement>(
      '.chat-input-container textarea',
    );
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  });
}

/**
 * 聊天区空态。展示预设提示词卡片；点击卡片把提示词填入底部 ComposeInput（不发送）。
 * 若输入框已有内容，弹确认框询问是否覆盖。
 *
 * 数据当前来自 `usePresetPrompts` 的视图层 mock（未接持久化）；插图为 `./illustrarion` 的 `ZERO_CHAT`。
 */
export function ZeroState() {
  const agent = useCurrentAgent();
  const navigate = useNavigate();
  const { get, set } = composeTextAtom.useChange();
  const prompts = usePresetPrompts(agent?.id);
  // 待覆盖确认的提示词；非 null 时弹出 AlertDialog。
  const [pendingOverwrite, setPendingOverwrite] = useState<PresetPrompt | null>(null);

  function fill(prompt: PresetPrompt) {
    set(prompt.prompt);
    focusComposeInput();
  }

  function onSelect(prompt: PresetPrompt) {
    // 输入框已有非空内容 → 先确认覆盖；否则直接填入。
    if (get().trim().length > 0) {
      setPendingOverwrite(prompt);
      return;
    }
    fill(prompt);
  }

  function confirmOverwrite() {
    if (pendingOverwrite) fill(pendingOverwrite);
    setPendingOverwrite(null);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-6 py-10">
        {/* 空态插图 —— SVG 自带 821×910，用 wrapper 限高等比缩放。 */}
        <div className="mb-6 h-36 select-none [&_svg]:h-full [&_svg]:w-auto">
          {ZERO_CHAT}
        </div>

        <h2 className="text-center text-lg font-semibold text-black/85">
          {agent?.name ? `Chat with ${agent.name}` : 'Start a conversation'}
        </h2>
        <p className="mt-1.5 mb-8 text-center text-sm text-black/45">
          Pick one to start, or just type your question below
        </p>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <PresetPromptCard key={prompt.id} prompt={prompt} onSelect={onSelect} />
          ))}
        </div>

        {agent?.id && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-5 gap-1.5 text-black/45 hover:text-black/70"
            onClick={() => navigate(`/agent/${agent.id}/settings/presets`)}
          >
            <SlidersHorizontal size={13} strokeWidth={1.75} />
            Manage prompts
          </Button>
        )}
      </div>

      <AlertDialog
        open={pendingOverwrite !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOverwrite(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current input?</AlertDialogTitle>
            <AlertDialogDescription>
              Your input box already has content. Inserting
              {pendingOverwrite ? ` "${pendingOverwrite.title}" ` : ' this preset '}
              will replace it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmOverwrite}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
