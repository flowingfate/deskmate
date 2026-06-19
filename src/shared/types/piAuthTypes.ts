/**
 * pi 路径下的 auth.json schema（pi-v1）。
 *
 * 文件落点：`{userData}/profiles/{userAlias}/auth.json`，与旧 V3 schema 共存
 * （同一路径）。版本字段不为 `pi-v1` 一律视为未登录，由 Step 7 的 PiAuthManager
 * 负责读写。旧 schema 由 lib/auth/authManager 继续维护，直到 Step 11 整体删除。
 *
 * 一个用户一个 provider 一份 credentials；不做多账号同 provider 共存。
 */

import type { OAuthCredentials } from '@earendil-works/pi-ai';

export const PI_AUTH_VERSION = 1 as const;

export interface PiAuthFile {
  version: typeof PI_AUTH_VERSION;
  providers: Record<string, ProviderAuth>;
}

export type ProviderAuth =
  | { type: 'oauth'; credentials: OAuthCredentials }
  | { type: 'apiKey'; apiKey: string; baseUrl?: string };

export interface ProviderAccountSummary {
  provider: string;
  type: ProviderAuth['type'];
  baseUrl?: string;
}
