/**
 * skills 跨组件命令 atom（替代旧的 `skill:delete` / `skills:addFromDeviceArtifact` /
 * `skills:addFromDeviceFolder` / `skills:refreshFolderExplorer` 自定义 window 事件）。
 *
 * - DeleteSkillDialogAtom：删除确认框状态。SkillDropdownMenu 调 requestDelete(name)
 *   （异步扫「被哪些 agent 使用」后开框），DeleteSkillConfirmDialog 订阅渲染确认框并执行
 *   真正的 skillsApi.deleteSkill。删除后数据由 skills.atom 订阅
 *   persist:agent:registry:updated[kind=skills] 自动刷新。
 * - SkillAddSelectionMode：「从设备添加」的选择模式类型，供共享 hook
 *   `useAddSkillFromDevice` 使用（该动作是纯 IPC，不经 atom 中转）。
 * - SkillFolderRefreshAtom：skill 目录文件树刷新信号（磁盘文件变化，非 registry 更新，
 *   故不能靠 persist 订阅兜住）。安装/更新/新增文件后 producer 调 refresh(skillName)，
 *   SkillFolderExplorer / SkillViewPanel 订阅，命中当前展示 skill 时重拉目录/文件内容。
 */

import { atom } from '@/atom';
import { getAgents } from '@/states/agents.atom';
import { persistApi } from '@/ipc/persist';

// ─────────────── Delete confirmation ───────────────

interface DeleteSkillDialogState {
  open: boolean;
  skillName: string;
  usedByAgents: string[];
}

const zeroDeleteState: DeleteSkillDialogState = {
  open: false,
  skillName: '',
  usedByAgents: [],
};

export const DeleteSkillDialogAtom = atom(
  zeroDeleteState,
  (get, set) => ({
    // skills 是 cold 字段，需按 agentId 拉 detail 才能扫「使用方」。
    requestDelete: async (skillName: string) => {
      const records = getAgents();
      const details = await Promise.all(
        records.map(async (a) => {
          const res = await persistApi.getAgentDetail(a.id);
          return res.success ? (res.data ?? null) : null;
        }),
      );
      const usedByAgents = records
        .filter((_, i) => details[i]?.skills?.includes(skillName))
        .map((agent) => agent.name || 'Unknown Agent');
      set({ open: true, skillName, usedByAgents });
    },
    close: () => set(zeroDeleteState),
  }),
);

// ─────────────── Add from device (selection mode) ───────────────

export type SkillAddSelectionMode = 'artifact' | 'folder';

// ─────────────── Folder explorer refresh signal ───────────────

interface SkillFolderRefreshState {
  skillName: string | null;
  nonce: number;
}

const zeroRefreshState: SkillFolderRefreshState = { skillName: null, nonce: 0 };
export const SkillFolderRefreshAtom = atom(
  zeroRefreshState,
  (get, set) => ({
    refresh: (skillName: string) => set({ skillName, nonce: get().nonce + 1 }),
  }),
);
