/**
 * agent.model 字段格式（Step 9+）：`${provider}::${modelId}`，例如：
 *   - `github-copilot::claude-sonnet-4.6`
 *   - `anthropic::claude-opus-4-5-20251101`
 *
 * 解析失败（不含 `::`、或两边为空）→ 返回 null。**不做老格式自动兼容**，
 * 由调用方在 UI 提示用户重选模型（见 step9.md 决策）。
 *
 * 这套 helper 同时被 main 进程 (`pi/utils/config.ts` / `pi/model.ts`) 和
 * renderer (ModelSelector / AgentBasicTab / ChatViewHeader) 引用，必须放
 * shared 才能避免 main 与 renderer 解析分歧。
 */

export interface ParsedAgentModel {
  provider: string;
  modelId: string;
}

const SEP = '::';

export function parseAgentModel(raw: string | null | undefined): ParsedAgentModel | null {
  if (!raw) return null;
  const idx = raw.indexOf(SEP);
  if (idx <= 0) return null; // 0 表示 `::xxx`，空 provider 不合法
  const provider = raw.slice(0, idx);
  const modelId = raw.slice(idx + SEP.length);
  if (!modelId) return null;
  return { provider, modelId };
}

export function formatAgentModel(provider: string, modelId: string): string {
  if (!provider || !modelId) {
    throw new Error('[agentModelId] provider/modelId required');
  }
  return `${provider}${SEP}${modelId}`;
}

/**
 * 仅显示用：拿到裸 modelId（找不到 `::` 时返回原值，避免 UI 空白）。
 * 业务判断请用 parseAgentModel + null 检查。
 */
export function stripProviderPrefix(raw: string | null | undefined): string {
  if (!raw) return '';
  const parsed = parseAgentModel(raw);
  return parsed ? parsed.modelId : raw;
}
