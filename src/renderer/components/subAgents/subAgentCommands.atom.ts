/**
 * subAgents 跨组件命令 atom（替代旧的 `subAgents:importFromClaudeCode` /
 * `subAgent:delete` 自定义 window 事件）。
 *
 * - SubAgentImportAtom：SubAgentsView 里的「Import from Claude Code」隐藏 file input
 *   注册进 atom，菜单项（SubAgentsAddMenuDropdown）调 open() 触发它。属于「菜单→宿主
 *   视图命令」，因 DOM ref 只在 SubAgentsView 内，用 register/open 而非直接调用。
 * - DeleteSubAgentDialogAtom：删除确认框状态。SubAgentListItem 调 requestDelete(name)
 *   （异步扫「被哪些 agent 使用」后开框），SettingsDialogs 订阅渲染确认框并执行真正删除。
 */

import { atom } from '@/atom';
import { getAgents } from '@/states/agents.atom';
import { persistApi } from '@/ipc/persist';

// ─────────────── Import from Claude Code ───────────────

interface SubAgentImportState {
  trigger: (() => void) | null;
}

const zeroImportState: SubAgentImportState = { trigger: null };
export const SubAgentImportAtom = atom(
  zeroImportState,
  (get, set) => ({
    register: (fn: () => void) => set({ trigger: fn }),
    unregister: () => set({ trigger: null }),
    open: () => get().trigger?.(),
  }),
);

// ─────────────── Delete confirmation ───────────────

interface DeleteSubAgentDialogState {
  open: boolean;
  subAgentName: string;
  usedByAgents: string[];
}

const zeroDeleteState: DeleteSubAgentDialogState = {
  open: false,
  subAgentName: '',
  usedByAgents: [],
};

export const DeleteSubAgentDialogAtom = atom(
  zeroDeleteState,
  (get, set) => ({
    // subAgents 是 cold 字段，需按 agentId 拉 detail 才能扫「使用方」。
    requestDelete: async (subAgentName: string) => {
      const records = getAgents();
      const details = await Promise.all(
        records.map(async (a) => {
          const res = await persistApi.getAgentDetail(a.id);
          return res.success ? (res.data ?? null) : null;
        }),
      );
      const usedByAgents = records
        .filter((_, i) => details[i]?.subAgents?.includes(subAgentName))
        .map((agent) => agent.name || 'Unknown Agent');
      set({ open: true, subAgentName, usedByAgents });
    },
    close: () => set(zeroDeleteState),
  }),
);
