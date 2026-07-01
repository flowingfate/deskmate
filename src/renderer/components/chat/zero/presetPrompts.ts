import { useAgentDetail, getAgentDetailSync } from '@/states/agentDetail.atom';
import { persistApi } from '@/ipc/persist';
import { log } from '@/log';
import type { PresetPrompt } from '@shared/persist/types';

/**
 * 预设提示词（Preset Prompt）—— 聊天空态里可点击的引导卡片。
 *
 * 点击卡片不会立即发送，而是把 `prompt` 填入底部 ComposeInput，交给用户确认/编辑后再发。
 *
 * **数据链路（已接持久化）**：源真值是 AGENT.md front-matter `zero.preset_prompts`（cold 字段）。
 *   - 读：`usePresetPrompts` 订阅 `agentDetail.atom`（`getAgentDetail` 懒读 + `agent:updated` 推送）。
 *     `zero` 缺席（未定制过）时回退到空数组（空态不渲染卡片）。
 *   - 写：`presetPromptActions` 走 `persistApi.patchAgentFront(agentId, { zero })` 整段覆盖写；
 *     main 端 patchFront 写 AGENT.md 后 emit `agent:updated`，atom 收到即刷新，空态/编辑 tab 同步。
 *
 * 上层组件只依赖 `usePresetPrompts` / `presetPromptActions`，不感知底层 store 换了持久化后端。
 */
export type { PresetPrompt } from '@shared/persist/types';

/** 新建/编辑表单的输入形态（不含 id —— 新建时生成）。 */
export type PresetPromptInput = Omit<PresetPrompt, 'id'>;

/** 每个 agent 的预设提示词上限。达到后禁止新增（写入层与 UI 双重把关）。 */
export const MAX_PRESET_PROMPTS = 6;

const logger = log.child({ mod: 'presetPrompts' });


/** Hook：订阅某 agent 的预设列表。未定制过（`zero` 缺席）时返回空数组。 */
export function usePresetPrompts(agentId?: string | null): PresetPrompt[] {
  const detail = useAgentDetail(agentId ?? null);
  return detail?.zero?.preset_prompts ?? [];
}

/** 命令式读当前列表（非 hook），供写入前取基线用。cache 未命中回退空数组。 */
function currentList(agentId: string): PresetPrompt[] {
  return getAgentDetailSync(agentId)?.zero?.preset_prompts ?? [];
}

/** 短随机行 id（base36 6 位）。仅需在 ≤6 条的数组内唯一，无需时间有序 / 可解析。 */
function newId(): string {
  return `pp_${Math.random().toString(36).slice(2, 8)}`;
}

/** 整段覆盖写 `zero.preset_prompts` 到 AGENT.md front-matter。失败仅告警（乐观更新由 `agent:updated` 兜底）。 */
async function persist(agentId: string, next: PresetPrompt[]): Promise<void> {
  const res = await persistApi.patchAgentFront(agentId, { zero: { preset_prompts: next } });
  if (!res.success) {
    logger.warn({ msg: 'patch zero.preset_prompts failed', agentId, error: res.error });
  }
}

/**
 * 预设增删改操作。均按 agent 隔离，写入前从 agentDetail cache 取当前列表（未定制为空数组）。
 * 无 agentId 时 no-op —— 编辑 tab 仅在
 * `/agent/:agentId/settings/presets` 路由下挂载，agentId 必在。
 */
export const presetPromptActions = {
  add(agentId: string | null | undefined, input: PresetPromptInput): void {
    if (!agentId) return;
    const list = currentList(agentId);
    // 达到上限则 no-op —— UI 已禁用入口，这里是防御性把关。
    if (list.length >= MAX_PRESET_PROMPTS) return;
    void persist(agentId, [...list, { ...input, id: newId() }]);
  },

  update(agentId: string | null | undefined, id: string, input: PresetPromptInput): void {
    if (!agentId) return;
    const list = currentList(agentId);
    void persist(agentId, list.map((p) => (p.id === id ? { ...input, id } : p)));
  },

  remove(agentId: string | null | undefined, id: string): void {
    if (!agentId) return;
    const list = currentList(agentId);
    void persist(agentId, list.filter((p) => p.id !== id));
  },
};
