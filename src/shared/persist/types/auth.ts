import type { OAuthCredentials } from '@earendil-works/pi-ai';

/**
 * 旧 V3 `auth.json` schema —— 只供 `persist/auth.ts#LegacyAuth.load` 兼容读取。
 * 磁盘上残留的老文件，无活代码再写。新登录全部走 `auth.pi.json` / `PiAuthFile`。
 */
export interface LegacyAuthFile {
  version: string;
  createdAt: string;
  updatedAt: string;
  authProvider: string;
  ghcAuth: {
    alias: string;
    /** Optional AAD account address for Azure AD–authenticated users. */
    aadAccount?: string;
    user: {
      id: string;
      login: string;
      email: string;
      name: string;
      avatarUrl: string;
      copilotPlan: 'individual' | 'business' | 'enterprise';
    };
    gitHubTokens: {
      timestamp: string;
      api_url: string;
      access_token: string;
      token_type: string;
      scope: string;
    };
    copilotTokens: {
      timestamp: string;
      api_url: string;
      /** Seconds-precision timestamp */
      expires_at: number;
      token: string;
    };
    capabilities: string[];
  };
}

/** pi-v1 `auth.pi.json` schema —— 由 PiAuthManager 维护。 */
export const PI_AUTH_VERSION = 1 as const;

export interface PiAuthFile {
  version: typeof PI_AUTH_VERSION;
  providers: Record<string, ProviderAuth>;
}

export type ProviderAuth =
  | { type: 'oauth'; credentials: OAuthCredentials }
  | { type: 'apiKey'; apiKey: string; baseUrl?: string };

/** 认证运行时投影，供设置页和 Pi IPC 使用。 */
export interface ProviderAccountSummary {
  provider: string;
  type: ProviderAuth['type'];
  baseUrl?: string;
}
