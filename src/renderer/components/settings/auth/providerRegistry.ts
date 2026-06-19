/**
 * pi 路径 provider 注册表（Step 8 前端硬编码）。
 *
 * 新增 provider 需要发版——pi 内建 provider 集合本身也是发版级别的事，
 * 这里同步是合理的。每个条目仅描述如何登录（`auth` 类型），不携带具体
 * provider 实现；OAuth 流程在 main 进程跑 pi-ai 包。
 *
 * apiKey 类型的 provider 带 `defaultBaseUrl` 提示，兼容 OpenAI / Anthropic
 * 协议的第三方厂商可通过自定义 base URL 接入。
 */

export type AuthMethod = 'oauth' | 'apiKey';

export interface ProviderDescriptor {
  id: string;
  name: string;
  auth: AuthMethod;
  /** apiKey 类型的默认 API 地址（仅作 placeholder 提示） */
  defaultBaseUrl?: string;
}

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  // ── OAuth ──
  { id: 'github-copilot', name: 'GitHub Copilot', auth: 'oauth' },
  { id: 'anthropic', name: 'Anthropic Claude', auth: 'oauth' },
  { id: 'openai-codex', name: 'ChatGPT Plus/Pro (Codex)', auth: 'oauth' },
  // ── API Key（国际） ──
  { id: 'openai', name: 'OpenAI', auth: 'apiKey', defaultBaseUrl: 'https://api.openai.com' },
  { id: 'anthropic-api', name: 'Anthropic', auth: 'apiKey', defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'deepseek', name: 'DeepSeek', auth: 'apiKey', defaultBaseUrl: 'https://api.deepseek.com' },
  // ── API Key（国产） ──
  { id: 'moonshotai-cn', name: 'Kimi', auth: 'apiKey', defaultBaseUrl: 'https://api.moonshot.cn' },
  { id: 'minimax-cn', name: 'MiniMax', auth: 'apiKey', defaultBaseUrl: 'https://api.minimax.chat' },
  { id: 'zai', name: '智谱 GLM', auth: 'apiKey', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas' },
  { id: 'opencode', name: '阿里通义', auth: 'apiKey', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode' },
];

export function getProviderDescriptor(id: string): ProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}
