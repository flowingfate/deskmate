import { Profiles } from '@main/persist';
import { RegularSession } from './session';

const agents = new Map<string, Agent>();

export class Agent {
  static get(agentId: string): Agent | undefined {
    return agents.get(agentId);
  }

  static getOrCreate(profileId: string, agentId: string): Agent {
    let agent = agents.get(agentId);
    if (!agent) {
      agent = new Agent(profileId, agentId);
      agents.set(agentId, agent);
    }
    return agent;
  }

  public readonly sessions = new Map<string, RegularSession>();

  constructor(
    public readonly profileId: string,
    public readonly id: string,
  ) {}

  /**
   * 内存命中就直接返回；首次访问到 persist 层把 persist.Session 拿出来，
   * 注入给 pi.RegularSession 构造，之后 pi.RegularSession 就不用再做任何 lookup。
   *
   * persist 找不到 session 时走 **lazy create**：用 renderer 传入的 sessionId
   * 调 `persistAgent.createSession({ id })` 首次落盘。这样"new chat"按钮只在
   * renderer 端生成 id 并 navigate，直到用户真正发首条消息才创建 sessions/{ym}/{s}/data.json，
   * 避免反复点新建却不发消息留下空壳 session。
   */
  async getOrCreateSession(sessionId: string): Promise<RegularSession> {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

    const profiles = Profiles.get();
    if (profiles.activeProfileId !== this.profileId) {
      throw new Error(
        `[pi/agent] profileId mismatch: requested "${this.profileId}" but active is "${profiles.activeProfileId}"`,
      );
    }
    const profile = await profiles.active();
    const persistAgent = await profile.getAgent(this.id);
    if (!persistAgent) {
      throw new Error(`[pi/agent] agent not found in active profile: ${this.id}`);
    }
    const existingSession = await persistAgent.getSession(sessionId);

    // !这里为了防止前端把 job run id 当作普通 session id 继续聊，直接在 pi 层拦截。job run session 必须先 fork 成普通 session 才能继续聊。
    if (!existingSession && persistAgent.jobRunIdx.findById(sessionId)) {
      throw new Error('[pi/agent] schedule runs must be converted before continuing');
    }

    const persistSession = existingSession ?? await persistAgent.createSession({ id: sessionId });

    const session = new RegularSession(sessionId, this.profileId, this.id, persistSession);
    this.sessions.set(sessionId, session);
    return session;
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
