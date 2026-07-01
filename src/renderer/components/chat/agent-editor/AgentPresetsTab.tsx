import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { ScrollArea } from '@/shadcn/scroll-area';
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
import {
  usePresetPrompts,
  presetPromptActions,
  MAX_PRESET_PROMPTS,
  type PresetPrompt,
  type PresetPromptInput,
} from '../zero/presetPrompts';
import { resolvePresetIcon } from '../zero/presetIcons';
import { PresetEditorDialog } from './PresetEditorDialog';

interface AgentPresetsTabProps {
  agentId?: string;
  readOnly?: boolean;
}

/**
 * AgentPresetsTab —— 编辑聊天空态的「快捷提示词」（Quick Prompts）。
 *
 * 数据当前只在视图层流转：读写都走 `../zero/presetPrompts` 的模块级 store，
 * 与空态 ZeroState 实时共享。未接持久化 —— 切换 profile / 重启即回到默认播种列表。
 *
 * 交互：列表行 + 右上「新建」。每行 hover 露出编辑/删除。编辑/新建走同一个
 * `PresetEditorDialog`；删除走 `AlertDialog` 二次确认（对齐仓库既有模式）。
 */
const AgentPresetsTab: React.FC<AgentPresetsTabProps> = ({ agentId, readOnly = false }) => {
  const prompts = usePresetPrompts(agentId);
  const atLimit = prompts.length >= MAX_PRESET_PROMPTS;

  // null ⇒ 对话框关闭；{ editing: null } ⇒ 新建；{ editing: preset } ⇒ 编辑。
  const [editorState, setEditorState] = useState<{ editing: PresetPrompt | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PresetPrompt | null>(null);

  function handleSubmit(data: PresetPromptInput) {
    if (editorState?.editing) {
      presetPromptActions.update(agentId, editorState.editing.id, data);
    } else {
      presetPromptActions.add(agentId, data);
    }
  }

  function confirmDelete() {
    if (pendingDelete) presetPromptActions.remove(agentId, pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-4 border-b border-black/7 px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-black/85">Quick Prompts</h2>
            <span className="text-xs font-medium text-black/35 tabular-nums">
              {prompts.length}/{MAX_PRESET_PROMPTS}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-black/45">
            These cards show on the empty state of a new chat. Clicking one fills the input box — it won't send.
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={readOnly || atLimit}
          title={atLimit ? `Up to ${MAX_PRESET_PROMPTS} prompts per agent` : undefined}
          onClick={() => setEditorState({ editing: null })}
        >
          <Plus size={14} strokeWidth={2} />
          New
        </Button>
      </div>

      {/* 列表 */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4">
          {prompts.length === 0 ? (
            <EmptyState onAdd={() => setEditorState({ editing: null })} disabled={readOnly} />
          ) : (
            <ul className="flex flex-col gap-2">
              {prompts.map((prompt) => (
                <PresetRow
                  key={prompt.id}
                  prompt={prompt}
                  readOnly={readOnly}
                  onEdit={() => setEditorState({ editing: prompt })}
                  onDelete={() => setPendingDelete(prompt)}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>

      <PresetEditorDialog
        open={editorState !== null}
        editing={editorState?.editing ?? null}
        onOpenChange={(open) => {
          if (!open) setEditorState(null);
        }}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this quick prompt?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `"${pendingDelete.title}" ` : 'This prompt '}will be removed from the empty state. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-sc-destructive text-sc-destructive-foreground hover:bg-sc-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

function PresetRow({
  prompt,
  readOnly,
  onEdit,
  onDelete,
}: {
  prompt: PresetPrompt;
  readOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = resolvePresetIcon(prompt.iconKey);
  return (
    <li className="group flex items-start gap-3 rounded-xl border border-black/8 bg-white px-4 py-3 transition-colors hover:border-black/20">
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-black/8 bg-black/3 text-black/70">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-black/85">{prompt.title}</div>
        {prompt.description && (
          <div className="mt-0.5 truncate text-xs text-black/45">{prompt.description}</div>
        )}
        <div className="mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-black/35">
          {prompt.prompt}
        </div>
      </div>
      {!readOnly && (
        <div className="flex flex-none items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" title="Edit" onClick={onEdit}>
            <Pencil size={14} strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete"
            className="text-black/50 hover:text-sc-destructive"
            onClick={onDelete}
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </Button>
        </div>
      )}
    </li>
  );
}

function EmptyState({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-black/15 text-black/30">
        <Sparkles size={20} strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-black/70">No quick prompts yet</p>
        <p className="mt-0.5 text-xs text-black/40">Add one and it'll show on the empty state of a new chat</p>
      </div>
      <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled} onClick={onAdd}>
        <Plus size={14} strokeWidth={2} />
        New
      </Button>
    </div>
  );
}

export default AgentPresetsTab;
