import { log } from '@main/log';
import {
  McpAuthChallengeInfo,
  McpResolvedAuthMetadata,
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from './types';

/** Host substring → friendly label. First hit wins; unknown → `'Identity Provider'`. */
const PROVIDER_LABELS: ReadonlyArray<[string, string]> = [
  ['github.com', 'GitHub'],
  ['gitlab.com', 'GitLab'],
  ['slack.com', 'Slack'],
  ['accounts.google.com', 'Google'],
  ['googleapis.com', 'Google'],
  ['atlassian.com', 'Atlassian'],
  ['notion.so', 'Notion'],
  ['notion.com', 'Notion'],
  ['discord.com', 'Discord'],
];

const MCP_PROTOCOL_VERSION_HEADERS = { 'MCP-Protocol-Version': '2024-11-05' } as const;

function parseChallengeParams(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  return result;
}

function parseBearerChallenge(headerValue: string | null): McpAuthChallengeInfo {
  if (!headerValue) return {};
  const bearerMatch = headerValue.match(/Bearer\s+(.+)/i);
  if (!bearerMatch) return {};

  const params = parseChallengeParams(bearerMatch[1]);
  return {
    scopes: params.scope ? params.scope.split(/\s+/).filter(Boolean) : undefined,
    resourceMetadataUrl: params.resource_metadata,
    authorizationServerUrl: params.authorization_uri,
  };
}

function getProtectedResourceMetadataUrl(serverUrl: URL): string {
  const pathName = serverUrl.pathname && serverUrl.pathname !== '/' ? serverUrl.pathname : '';
  return new URL(`/.well-known/oauth-protected-resource${pathName}`, serverUrl).toString();
}

function normalizeAuthorizationServerUrl(serverUrl: string | undefined): string | undefined {
  if (!serverUrl) return undefined;
  try {
    const url = new URL(serverUrl);
    url.pathname = url.pathname
      .replace(/\/oauth2\/v2\.0\/authorize\/?$/i, '/v2.0')
      .replace(/\/oauth2\/authorize\/?$/i, '')
      .replace(/\/authorize\/?$/i, '') || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return serverUrl;
  }
}

function buildAuthorizationServerDiscoveryUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  const pathName = url.pathname.replace(/\/$/, '');
  const candidates = [
    new URL(`/.well-known/oauth-authorization-server${pathName}`, url.origin).toString(),
    new URL(`${pathName || ''}/.well-known/oauth-authorization-server`, url.origin).toString(),
    new URL(`/.well-known/openid-configuration${pathName}`, url.origin).toString(),
    new URL(`${pathName || ''}/.well-known/openid-configuration`, url.origin).toString(),
  ];
  return Array.from(new Set(candidates));
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...headers } });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function inferProviderLabel(metadataUrl: string, metadata?: OAuthAuthorizationServerMetadata): string {
  const haystack = `${metadata?.issuer ?? ''} ${metadataUrl}`.toLowerCase();
  for (const [host, label] of PROVIDER_LABELS) {
    if (haystack.includes(host)) return label;
  }
  return 'Identity Provider';
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function resolve(serverUrl: string, responseHeaders: Headers): Promise<McpResolvedAuthMetadata | null> {
  const challenge = parseBearerChallenge(responseHeaders.get('WWW-Authenticate'));

  const resourceMetadataUrl = challenge.resourceMetadataUrl || getProtectedResourceMetadataUrl(new URL(serverUrl));
  const resourceMetadata = await fetchJson<OAuthProtectedResourceMetadata>(resourceMetadataUrl, MCP_PROTOCOL_VERSION_HEADERS);

  const resourceMetadataSource: McpResolvedAuthMetadata['telemetry']['resourceMetadataSource'] =
    resourceMetadata ? (challenge.resourceMetadataUrl ? 'header' : 'wellKnown') : 'none';

  const scopes = challenge.scopes ?? resourceMetadata?.scopes_supported ?? [];
  const authorizationServerUrl = resourceMetadata?.authorization_servers?.[0]
    || normalizeAuthorizationServerUrl(challenge.authorizationServerUrl)
    || new URL(serverUrl).origin;

  let authorizationServerMetadata: OAuthAuthorizationServerMetadata | null = null;
  let serverMetadataSource: McpResolvedAuthMetadata['telemetry']['serverMetadataSource'] = 'default';
  for (const discoveryUrl of buildAuthorizationServerDiscoveryUrls(authorizationServerUrl)) {
    authorizationServerMetadata = await fetchJson<OAuthAuthorizationServerMetadata>(discoveryUrl, MCP_PROTOCOL_VERSION_HEADERS);
    if (authorizationServerMetadata) {
      serverMetadataSource = challenge.authorizationServerUrl || resourceMetadata?.authorization_servers?.[0]
        ? 'resourceMetadata'
        : 'wellKnown';
      break;
    }
  }

  if (!authorizationServerMetadata) {
    const stripped = authorizationServerUrl.replace(/\/$/, '');
    authorizationServerMetadata = {
      issuer: authorizationServerUrl,
      authorization_endpoint: `${stripped}/authorize`,
      token_endpoint: `${stripped}/token`,
    };
  }

  if (!authorizationServerMetadata.authorization_endpoint || !authorizationServerMetadata.token_endpoint) {
    log.warn({ msg: `[McpAuthMetadataService] Incomplete authorization server metadata for ${authorizationServerUrl}`, mod: 'McpAuthMetadataService' });
    return null;
  }

  return {
    resourceMetadata: resourceMetadata ?? undefined,
    authorizationServerUrl,
    authorizationServerMetadata,
    scopes,
    providerLabel: inferProviderLabel(authorizationServerUrl, authorizationServerMetadata),
    telemetry: { resourceMetadataSource, serverMetadataSource },
  };
}

function updateFromHeaders(existing: McpResolvedAuthMetadata, responseHeaders: Headers): McpResolvedAuthMetadata {
  const { scopes } = parseBearerChallenge(responseHeaders.get('WWW-Authenticate'));
  if (!scopes || arraysEqual(scopes, existing.scopes)) return existing;

  log.info({ msg: `[McpAuthMetadataService] Scopes changed from ${JSON.stringify(existing.scopes)} to ${JSON.stringify(scopes)}`, mod: 'McpAuthMetadataService' });
  return { ...existing, scopes };
}

/** Namespace object — keeps the existing `McpAuthMetadataService.resolve(...)` /
 *  `.updateFromHeaders(...)` call sites working while dropping the empty-class shell. */
export const McpAuthMetadataService = { resolve, updateFromHeaders } as const;
