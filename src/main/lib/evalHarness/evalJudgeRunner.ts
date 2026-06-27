// src/main/lib/evalHarness/evalJudgeRunner.ts
import type { JudgeRequest, JudgeResultResponse, JudgeChatMessage } from './evalProtocol';
import { runUtilityChat } from '@main/pi/utility';
import { Profiles } from '../../persist';

/**
 * Handles 'judge' requests: raw LLM call with caller-provided messages.
 * No agent loop, no tools, no agent system prompt.
 *
 * 走 pi/utility 的 runUtilityChat —— 不再绑死 GitHub Copilot；agent.model 是
 * `${provider}::${modelId}` 复合 key，pi 自动按 provider 路由。
 */
export class EvalJudgeRunner {
  private profileId: string;

  constructor(profileId: string) {
    this.profileId = profileId;
  }

  async run(request: JudgeRequest): Promise<JudgeResultResponse> {
    const modelKey = await this.getAgentModelKey();

    const responseText = await runUtilityChat({
      modelKey,
      profileId: this.profileId,
      messages: request.messages.map((msg: JudgeChatMessage) => ({
        role: msg.role,
        content: msg.content,
      })),
      maxTokens: 4000,
      temperature: 0.7,
    });

    return {
      type: 'judge_result',
      content: responseText,
    };
  }

  /**
   * Gets the model key from the primary agent's configuration.
   * 返回 `${provider}::${modelId}` 复合 key（Step 9+ schema）。
   */
  private async getAgentModelKey(): Promise<string> {
    const profile = await Profiles.get().active();
    if (!profile) {
      throw new Error(`No profile found for user alias: ${this.profileId}`);
    }

    const records = profile.listAgents();
    const primaryId = profile.getPrimaryAgentId();
    const match = (primaryId ? records.find((r) => r.id === primaryId) : undefined) ?? records[0];
    if (!match) {
      throw new Error(`No agents found in profile`);
    }
    const agent = await profile.getAgent(match.id);
    const model = agent?.config.model;
    if (!model) {
      throw new Error(`No model configured for primary agent "${match.name}"`);
    }
    return model;
  }
}
