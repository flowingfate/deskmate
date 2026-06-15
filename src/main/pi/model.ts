/**
 * pi 模块对外的 model registry —— **所有 provider 的唯一接入点**。
 *
 * 入口（公开 API）：
 * - `resolveModel({provider, modelId}) -> pi.Model`：拿 catalog 原始 model
 *   （baseUrl 未按 token 改写）。turn loop / utility 都在每轮 LLM 调用前再
 *   过一次 `resolveCredentials` 完成动态改写。
 * - `listModels(provider) -> ResolvedModel[]`：IPC `pi:listModelsForProvider` 用
 * - `getModelInfo({provider, modelId}) -> ResolvedModel | null`：IPC `pi:getModelInfo` 用
 * - `resolveCredentials(model, profileId) -> { apiKey, model }`：每次 LLM 调用
 *   前的最后一站。返回 fresh apiKey + 按当前 OAuth credentials 派生过
 *   `baseUrl` / headers 的 model（套用 pi-ai `provider.modifyModels`
 *   hook）。**GHC 必须走这条路** —— pi-ai catalog 里硬编码的
 *   `baseUrl: api.individual.githubcopilot.com` 对企业账户会触发 421
 *   Misdirected Request；token 里 `proxy-ep=proxy.enterprise...` 字段
 *   决定真实 baseUrl，必须每次 LLM 调用前从 fresh credentials 派生。
 * - `resolveApiKey(model, profileId) -> string`：thin wrapper，只拿 apiKey
 *   字符串、不动 baseUrl。**stream 路径不要用** —— 用它就回到了"GHC 企业
 *   账户撞 421"的老问题。仅在不打 LLM 网络（mock / 测试 / 单纯查 token）
 *   时使用。
 *
 * 数据源：**全部走 pi-ai 内置 model 表**（`models.generated.ts` 编译时常量，
 * ~960 个 model 跨 32 个 provider）。github-copilot 也是 pi-ai 内置的 20 个
 * 模型直出，不再走自家 `/models` 端点拉取。
 *
 * 这意味着 provider 真的发了新模型要等 pi-ai 升级（依赖 npm 包版本），
 * 但换来的是 model registry 真正一条路径，不再为单个 provider 维护拉取/
 * 缓存/白名单代码。`providers/ghc/ghcModelsManager` 仍在启动链路里跑（保留
 * `/models` 拉取 + 本地缓存文件 `models/github-copilot.json`），但 model
 * registry 不再消费它的数据 —— 留作未来恢复"动态拉模型"路径的备用。
 *
 * IPC 请求路径上**零网络、零 IO**：listModels / getModelInfo / resolveModel
 * 都是从 pi-ai 编译时常量 + 同步派生。`resolveCredentials` 不算 IPC 路径
 * —— 它在 LLM 调用前跑，可能触发 OAuth refresh（网络）。
 *
 * pi-ai 用 `await import('@earendil-works/pi-ai')`：项目当前事实约定 ——
 * electron-vite 把 dependencies 默认 external，pi-ai 是 ESM-only 包，
 * 静态 import 在生产 main bundle 里会触发 ESM/CJS interop 问题。
 * `scripts/check-mixed-imports` 会拦"同模块静态+动态混用"。
 */

import type {
  Api,
  Model,
  ModelThinkingLevel,
} from '@earendil-works/pi-ai';

import { getPiAuthManager } from './auth';
// ───────────────────────────────────────────────────────────────────────────
// 公开类型
// ───────────────────────────────────────────────────────────────────────────

export interface ResolvedModel {
  /** turn loop / stream 直接消费 */
  model: Model<Api>;
  /** UI 角标 + agent runtime config 派生量 */
  capabilities: DerivedCapabilities;
}

/** pi-ai 的 ThinkingLevel 去掉 'off' —— UI 把"未选 = 默认"独立处理，'off' 不会出现 */
export type ThinkingLevel = Exclude<ModelThinkingLevel, 'off'>;

export interface DerivedCapabilities {
  /** 是否是 reasoning model（reasoningLevels 非空集即真） */
  reasoning: boolean;
  /**
   * 支持的 reasoning level —— pi-ai 标准枚举（minimal/low/medium/high/xhigh）。
   * 已去掉 'off'，因为 UI 把"未选 = 默认"独立处理。
   * 非 reasoning model 返回空数组。
   */
  reasoningLevels: ThinkingLevel[];
  /**
   * 是否支持 tool_calls。pi-ai 的 `Model` 类型没有该字段（pi-ai 把工具能力
   * 完全留给 stream 调用方与 provider 协商），这里固定 true —— 与历史 IPC
   * handler 行为一致；turn loop 仍然会拉 MCP 工具并尝试传入 stream。
   */
  tools: boolean;
  /** 是否支持图片输入（model.input 含 'image'） */
  images: boolean;
  /** 是否接收 temperature（o3/o4 family 不接收） */
  temperature: boolean;
  /** model.maxTokens 兜底 4000 */
  maxTokens: number;
  /** model.contextWindow 兜底 128k */
  contextWindow: number;
}

// ───────────────────────────────────────────────────────────────────────────
// 公开 API
// ───────────────────────────────────────────────────────────────────────────

export async function resolveModel(
  parsed: { provider: string; modelId: string },
): Promise<Model<Api>> {
  const pi = await import('@earendil-works/pi-ai');
  type ProviderArg = Parameters<typeof pi.getModel>[0];
  type ModelIdArg = Parameters<typeof pi.getModel>[1];
  const model = pi.getModel(parsed.provider as ProviderArg, parsed.modelId as ModelIdArg);
  if (!model) {
    throw new Error(
      `[pi/model] Unknown model "${parsed.modelId}" under provider "${parsed.provider}"`,
    );
  }
  return model;
}

export async function listModels(provider: string): Promise<ResolvedModel[]> {
  const pi = await import('@earendil-works/pi-ai');
  type ProviderArg = Parameters<typeof pi.getModels>[0];
  return pi.getModels(provider as ProviderArg).map(toResolved);
}

export async function getModelInfo(
  parsed: { provider: string; modelId: string },
): Promise<ResolvedModel | null> {
  const pi = await import('@earendil-works/pi-ai');
  type ProviderArg = Parameters<typeof pi.getModel>[0];
  type ModelIdArg = Parameters<typeof pi.getModel>[1];
  const model = pi.getModel(parsed.provider as ProviderArg, parsed.modelId as ModelIdArg);
  return model ? toResolved(model) : null;
}

/**
 * stream 路径的最后一站：拿 fresh apiKey + 按当前 OAuth credentials 派生过
 * baseUrl / headers 的 model。**所有 `pi.stream` / `pi.complete` 调用前都应
 * 走这条**。
 *
 * - OAuth provider 有 `modifyModels` hook 时：用当前 credentials 跑一次，
 *   返回的新 model 是不可变副本（pi-ai 内部 `models.map(m => ({...m, baseUrl}))`），
 *   原 model 不被 mutate。
 * - apiKey provider / OAuth provider 无 `modifyModels` hook：model 原样回。
 *
 * 为什么不在 `resolveModel` 里一次性改写：pi-ai 的 OAuth credentials（GHC
 * 最典型）会过期，每次 refresh 拿到的 access token 里 `proxy-ep` 字段可能
 * 因后端路由调整而变；只在 turn 开始时改写一次，长 turn 跨过期点后
 * baseUrl 就会和新 token 不匹配。把改写放在 `resolveCredentials` 内、与
 * `getApiKey` 同时跑，保证 baseUrl 永远跟 access token 一致。
 */
export async function resolveCredentials(
  baseModel: Model<Api>,
  profileId: string,
): Promise<{ apiKey: string; model: Model<Api> }> {
  const auth = getPiAuthManager(profileId);
  const credentials = await auth.getOAuthCredentials(baseModel.provider);

  if (credentials) {
    // OAuth 路径：用 fresh credentials 派生 model（baseUrl 可能从 token 改写），
    // 同时把 access 当 apiKey 用（pi-ai 各 OAuth provider 都把 access 当 API key）。
    const oauth = await import('@earendil-works/pi-ai/oauth');
    const impl = oauth.getOAuthProvider(baseModel.provider);
    const model = impl?.modifyModels
      ? (impl.modifyModels([baseModel], credentials)[0] ?? baseModel)
      : baseModel;
    return { apiKey: credentials.access, model };
  }

  // apiKey-only provider / 未登录：走原路径拿 apiKey 字符串。
  const apiKey = await auth.getApiKey(baseModel.provider);
  if (!apiKey) {
    throw new Error(
      `[pi/model] No credentials for provider "${baseModel.provider}" (profile "${profileId}"). ` +
        `Please sign in via Settings → Providers.`,
    );
  }
  return { apiKey, model: baseModel };
}

/**
 * 仅返回 apiKey 字符串、不改写 baseUrl。**不要用于实际 stream 调用** ——
 * 用它会让 GHC 企业账户撞 421 Misdirected Request（详见 `resolveCredentials`
 * 注释）。保留作为：
 * - 测试 / mock 场景下只想验证 token 是否拿得到
 * - 不会真的打 LLM 网络的工具脚本
 *
 * 走 PiAuthManager：从 `~/.deskmate/profiles/{profileId}/auth.pi.json` 读 OAuth
 * credentials（过期自动 refresh + 回写）或 apiKey 字段。
 */
export async function resolveApiKey(
  model: Model<Api>,
  profileId: string,
): Promise<string> {
  const { apiKey } = await resolveCredentials(model, profileId);
  return apiKey;
}

// ───────────────────────────────────────────────────────────────────────────
// 内部：pi.Model → ResolvedModel 派生
// ───────────────────────────────────────────────────────────────────────────

/**
 * 从 `pi.Model` 派生 `ResolvedModel.capabilities`。
 *
 * 字段语义全都是 **UI 侧**：要不要在 agent 编辑器 / 模型面板上展示对应控件。
 * 真实 wire 行为由 pi-ai provider 层决定,这里不试图模拟。
 *
 * - reasoning / reasoningLevels:读 `thinkingLevelMap`,与 pi-ai 的
 *   `getSupportedThinkingLevels` 行为等价 —— 同步实现避免动态 import。
 * - tools:固定 true。`pi.Model` 不暴露 tool 能力,pi-ai stream 时由 provider
 *   自己协商;turn loop 也总会先尝试拉 MCP 工具传进去。
 * - images:`model.input` 含 'image'。
 * - temperature:仅屏蔽 OpenAI o3/o4 family(它们的 API 严格拒收 temperature)。
 *   **不能用 `!model.reasoning`** —— Anthropic 带 thinking 的 Claude 仍然接收
 *   temperature(pi-ai `anthropic.js` 只在 `thinkingEnabled` 单次调用里跳过,
 *   不是 model 维度的能力),把它们一刀切掉会丢失 UI 控件。
 */
function toResolved(model: Model<Api>): ResolvedModel {
  const reasoningLevels = computeThinkingLevels(model);
  return {
    model,
    capabilities: {
      reasoning: reasoningLevels.length > 0,
      reasoningLevels,
      tools: true,
      images: model.input.includes('image'),
      temperature: !OPENAI_REASONING_ONLY.test(model.id),
      maxTokens: model.maxTokens || 4000,
      contextWindow: model.contextWindow || 128_000,
    },
  };
}

/**
 * OpenAI o3 / o4 family 不接收 `temperature`(API 直接报错)。其它带 reasoning
 * 的 model(Claude thinking / Gemini thinking / DeepSeek R1)都接收。
 *
 * 用 `\b` 字边界避免误中 `gpt-4o` 之类(虽然现在 pi-ai 表里 `includes('o4')`
 * 也不会撞,但用正则把意图写明白)。仅看 `model.id`:`name` 是人类可读字符
 * 串,容易因为版本标签变化(比如 "GPT-4o (legacy)")意外触发。
 */
const OPENAI_REASONING_ONLY = /\bo[34]\b/i;

/** 同步版 `getSupportedThinkingLevels` —— 与 pi-ai dist/models.js 等价 */
const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/**
 * pi-ai 的 `thinkingLevelMap` 语义:
 * - `undefined`:用 provider 默认 → 该 level 仍然支持
 * - `null`:显式标记不支持
 * - `xhigh` 例外:必须 map 里显式有(`!== undefined`)才支持
 * - 我们额外把 `'off'` 过滤掉:UI 把"未选 = 默认"独立处理,'off' 不出现在
 *   选项里
 */
function computeThinkingLevels(model: Model<Api>): ThinkingLevel[] {
  if (!model.reasoning) return [];
  const map = model.thinkingLevelMap;
  return EXTENDED_THINKING_LEVELS.filter((level): level is ThinkingLevel => {
    if (level === 'off') return false;
    const mapped = map?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh') return mapped !== undefined;
    return true;
  });
}
