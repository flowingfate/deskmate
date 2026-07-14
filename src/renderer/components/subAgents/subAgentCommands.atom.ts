/**
 * Sub-agent 删除确认状态。
 *
 * SubAgentListItem 调 requestDelete(name) 异步计算使用该 sub-agent 的 agents；
 * SubAgentsView 挂载确认框并消费此状态。
 */

import { atom } from '@/atom';
import { getAgents } from '@/states/agents.atom';
import { persistApi } from '@/ipc/persist';


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
