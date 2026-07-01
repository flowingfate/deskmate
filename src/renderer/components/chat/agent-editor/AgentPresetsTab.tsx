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
 * 数据读写走 `../zero/presetPrompts`，落 AGENT.md front-matter `zero.preset_prompts`
 * （cold 字段），经 `agent:updated` 事件与空态 ZeroState 实时同步。CRUD 即时生效。
 *
 * 交互：2 列网格，首格为「新建」入口卡片（达上限禁用）；每张预设卡片 hover 露出
 * 编辑/删除。编辑/新建走同一个 `PresetEditorDialog`；删除走 `AlertDialog` 二次确认。
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
      <div className="border-b border-black/7 px-6 py-2">
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

      {/* 网格：首格为「新建」入口，其后为各预设卡片 */}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 gap-3 px-6 py-4">
          {prompts.map((prompt) => (
            <PresetCard
              key={prompt.id}
              prompt={prompt}
              readOnly={readOnly}
              onEdit={() => setEditorState({ editing: prompt })}
              onDelete={() => setPendingDelete(prompt)}
            />
          ))}
          {!readOnly && (
            <AddPresetCard
              disabled={atLimit}
              atLimit={atLimit}
              onAdd={() => setEditorState({ editing: null })}
            />
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

function PresetCard({
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
    <div className="group relative flex h-28 flex-col rounded-xl border border-black/8 bg-white px-4 py-3.5 transition-colors hover:border-black/20">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-black/8 bg-black/3 text-black/70">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-black/85">{prompt.title}</div>
          <div className="truncate text-xs text-black/45">{prompt.description || '～～～'}</div>
        </div>
      </div>
      <div className="mt-2.5 flex-1 overflow-hidden text-xs whitespace-pre-wrap text-black/35">
        {prompt.prompt}
      </div>
      {!readOnly && (
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
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
    </div>
  );
}

/** 网格首格：新建入口。达上限时禁用并提示。 */
function AddPresetCard({
  disabled,
  atLimit,
  onAdd,
}: {
  disabled: boolean;
  atLimit: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={atLimit ? `Up to ${MAX_PRESET_PROMPTS} prompts per agent` : undefined}
      onClick={onAdd}
      className="group flex h-28 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-dashed border-black/15 px-4 text-center transition-colors hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-black/15"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-black/15 text-black/30 transition-colors group-hover:border-black/30 group-hover:text-black/50 group-disabled:border-black/15 group-disabled:text-black/30">
        {atLimit ? <Sparkles size={18} strokeWidth={1.5} /> : <Plus size={18} strokeWidth={1.75} />}
      </span>
      <div>
        <p className="text-[13px] font-medium text-black/70">
          {atLimit ? 'Prompt limit reached' : 'New quick prompt'}
        </p>
        <p className="mt-0.5 text-xs text-black/40">
          {atLimit
            ? `Up to ${MAX_PRESET_PROMPTS} per agent — delete one to add more`
            : "It'll show on the empty state of a new chat"}
        </p>
      </div>
    </button>
  );
}

export default AgentPresetsTab;
