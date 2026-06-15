import { PERSIST_PATH } from '../../shared/persist/path';
import { getAppRoot } from './lib/root';
import { ensureDir, pathExists, removeDirIfExists } from './lib/atomic';

/**
 * 一个 agent 的 knowledge 目录（agents/{a_id}/knowledge/）。
 * 本类只负责生命周期 + 路径解析 —— 不读写文件内容，那是调用方/LLM 的事。
 */
export class AgentKnowledge {
  constructor(
    public readonly profileId: string,
    public readonly agentId: string,
  ) {}

  public path(): string {
    return PERSIST_PATH.agentKnowledge(getAppRoot(), this.profileId, this.agentId);
  }

  public async ensure(): Promise<void> {
    await ensureDir(this.path());
  }

  public async remove(): Promise<void> {
    await removeDirIfExists(this.path());
  }

  public async exists(): Promise<boolean> {
    return pathExists(this.path());
  }
}
