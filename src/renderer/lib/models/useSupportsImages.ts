/**
 * 当前 agent 选定模型是否支持图片输入。
 *
 * 单一可信来源:经 `useModelInfo`(IPC 查 pi)拿模型 capabilities,对所有
 * provider(含 github-copilot)一致。compose / inline-edit 两个输入框共用,
 * 避免各自判定漂移。
 */
import { useAgentById } from '@/states/agents.atom';
import { useModelInfo } from './useModelInfo';

export function useSupportsImages(agentId: string | null): boolean {
  const agent = useAgentById(agentId);
  const { info } = useModelInfo(agent?.model ?? null);
  return info?.supportsImages ?? false;
}
