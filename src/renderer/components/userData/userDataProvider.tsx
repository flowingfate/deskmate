// 老 useProfileData / useChats / useAgentConfig / useMCPServers / useProfileDataReady /
// useProfileDataRefresh hook 已退役 —— 改读各域 atom（profile / agents / settings / mcp /
// sessionIndex / starred / schedules / sessionData / mcpRuntime）。本文件仅保留 useSkills
// 作为 atom 的薄包装入口，便于向后兼容。
// Side-effect import: mcp.atom 在模块加载时订阅 persist 通道 + 调
// mcpClientCacheManager.updateServerConfigs，取代老 profileDataManager 中的 mcp 同步胶水。
// 必须在这里 import 一次，否则 atom 不会跑 hydrate。
import '@/states/mcp.atom'
import {
  useSkills as useSkillsAtom,
  getSkillByName as getSkillByNameAtom,
  getSkillsStats as getSkillsStatsAtom,
} from '@/states/skills.atom'

// ========== Skills Management Hook ==========
export function useSkills() {
  const items = useSkillsAtom()

  return {
    skills: items,
    stats: getSkillsStatsAtom(),
    getSkillByName: (name: string) => getSkillByNameAtom(name),
    isLoading: false,
  }
}

