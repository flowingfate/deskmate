/**
 * pi 路径 provider 注册表（Step 8 前端硬编码）。
 *
 * 新增 provider 需要发版——pi 内建 provider 集合本身也是发版级别的事，
 * 这里同步是合理的。每个条目仅描述如何登录（`auth` 类型），不携带具体
 * provider 实现；OAuth 流程在 main 进程跑 pi-ai 包。
 */

export type AuthMethod = 'oauth' | 'apiKey';

export interface ProviderDescriptor {
  id: string;
  name: string;
  auth: AuthMethod;
}

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  { id: 'github-copilot', name: 'GitHub Copilot', auth: 'oauth' },
  { id: 'anthropic', name: 'Anthropic Claude', auth: 'oauth' },
  { id: 'openai-codex', name: 'ChatGPT Plus/Pro (Codex)', auth: 'oauth' },
  { id: 'openai', name: 'OpenAI', auth: 'apiKey' },
  { id: 'anthropic-api', name: 'Anthropic (API Key)', auth: 'apiKey' },
];

export function getProviderDescriptor(id: string): ProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}
