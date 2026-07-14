import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Textarea } from '@/shadcn/textarea';
import { Label } from '@/shadcn/label';
import { cn } from '@/lib/utilities/utils';
import type { PresetPrompt, PresetPromptInput } from '../zero/presetPrompts';
import {
  PRESET_ICON_KEYS,
  DEFAULT_PRESET_ICON_KEY,
  resolvePresetIcon,
  type PresetIconKey,
} from '../zero/presetIcons';

interface PresetEditorDialogProps {
  open: boolean;
  /** 传入现有 preset ⇒ 编辑模式；null ⇒ 新建模式。 */
  editing: PresetPrompt | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: PresetPromptInput) => void;
}

const EMPTY: PresetPromptInput = {
  title: '',
  description: '',
  prompt: '',
  iconKey: DEFAULT_PRESET_ICON_KEY,
};

/**
 * 预设提示词的新建/编辑对话框。纯视图层表单：提交前做最小校验（标题 + 提示词非空），
 * 由父组件把结果写入 preset store。
 */
export function PresetEditorDialog({ open, editing, onOpenChange, onSubmit }: PresetEditorDialogProps) {
  const [form, setForm] = useState<PresetPromptInput>(EMPTY);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // 每次打开时用 editing（或空）重置表单；关闭态不重置，避免关闭动画期间闪值。
  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            title: editing.title,
            description: editing.description ?? '',
            prompt: editing.prompt,
            iconKey: editing.iconKey,
          }
        : EMPTY,
    );
  }, [open, editing]);

  const canSave = form.title.trim().length > 0 && form.prompt.trim().length > 0;

  function submit() {
    if (!canSave) return;
    onSubmit({
      title: form.title.trim(),
      description: form.description?.trim() ? form.description.trim() : undefined,
      prompt: form.prompt,
      iconKey: form.iconKey,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" initialFocusRef={titleInputRef}>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit quick prompt' : 'New quick prompt'}</DialogTitle>
          <DialogDescription>
            Clicking a card fills the prompt into the input box for review before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {/* 图标选择 */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-black/60">Icon</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ICON_KEYS.map((key) => (
                <IconOption
                  key={key}
                  iconKey={key}
                  active={form.iconKey === key}
                  onSelect={() => setForm((f) => ({ ...f, iconKey: key }))}
                />
              ))}
            </div>
          </div>

          {/* 标题 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-title" className="text-xs font-medium text-black/60">
              Title
            </Label>
            <Input
              ref={titleInputRef}
              id="preset-title"
              value={form.title}
              maxLength={40}
              placeholder="e.g. Help me write"
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          {/* 描述 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-desc" className="text-xs font-medium text-black/60">
              Description<span className="ml-1 text-black/30">(optional)</span>
            </Label>
            <Input
              id="preset-desc"
              value={form.description ?? ''}
              maxLength={60}
              placeholder="One line on what this prompt does"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* 提示词正文 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-prompt" className="text-xs font-medium text-black/60">
              Prompt
            </Label>
            <Textarea
              id="preset-prompt"
              value={form.prompt}
              rows={5}
              placeholder="The full prompt to insert into the input box…"
              className="resize-none"
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={submit}>
            {editing ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IconOption({
  iconKey,
  active,
  onSelect,
}: {
  iconKey: PresetIconKey;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = resolvePresetIcon(iconKey);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
        active
          ? 'border-black bg-black text-white'
          : 'border-black/8 bg-black/2 text-black/60 hover:border-black/25',
      )}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}
