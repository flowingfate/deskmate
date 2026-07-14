import { mcpAuthService } from '..';
import { mcpAuthPromptRegistry, type McpAuthConsentDecision } from '../mcpAuthPromptRegistry';
import type { McpServerConfig } from '@shared/persist/types'

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userData'),
    getName: vi.fn(() => 'Deskmate'),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }]),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../authWindowSelector', async () => ({
  pickAuthUiWindow: vi.fn((windows: Array<{ webContents: { send: Mock } }>) => windows[0]),
}));

// DeskmateTokenCache 走 Electron safeStorage + fs IO；stub 掉避免触发 app.getPath。
vi.mock('../DeskmateTokenCache', async () => ({
  DeskmateTokenCache: {
    getInstance: () => ({
      getMcpOAuth: vi.fn(async () => null),
      setMcpOAuth: vi.fn(async () => undefined),
      deleteMcpOAuth: vi.fn(async () => undefined),
    }),
  },
}));

// generic OAuth 走 DeskmateOAuthProvider：无缓存 token/client、方法皆 noop，
// 迫使 _performGenericOAuth 走到 requestConsent（触发 consent-requested 事件）。
vi.mock('../DeskmateOAuthProvider', async () => ({
  PROACTIVE_REFRESH_WINDOW_SEC: 300,
  DeskmateOAuthProvider: vi.fn().mockImplementation(function () {
    return {
      tokens: vi.fn(async () => undefined),
      clientInformation: vi.fn(async () => undefined),
      saveClientInformation: vi.fn(async () => undefined),
      invalidateCredentials: vi.fn(async () => undefined),
      markAccessTokenExpired: vi.fn(async () => undefined),
      pinnedCallbackPort: 33420,
    };
  }),
}));

// 真正的 OAuth 授权码流程不参与本文件测试——resolved noop 即可。
vi.mock('../performOAuthFlow', async () => ({
  performOAuthFlow: vi.fn(async () => undefined),
  runRefreshOnly: vi.fn(async () => undefined),
}));

// 让 DCR 探测走「支持 DCR」分支，避免提前弹出 client-id 对话框。
vi.mock('../wellKnownOAuthProviders', async () => ({
  isKnownToNotSupportDcr: vi.fn(() => false),
}));

function buildMetadata() {
  return {
    authorizationServerUrl: 'https://auth.example.com/organizations/v2.0',
    authorizationServerMetadata: {
      issuer: 'https://auth.example.com/organizations/v2.0',
      authorization_endpoint: 'https://auth.example.com/organizations/oauth2/v2.0/authorize',
      token_endpoint: 'https://auth.example.com/organizations/oauth2/v2.0/token',
    },
    scopes: ['api://resource/.default'],
    providerLabel: 'Identity Provider',
    telemetry: {
      resourceMetadataSource: 'header' as const,
      serverMetadataSource: 'resourceMetadata' as const,
    },
  };
}

function makeCfg(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'example-mcp',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'https://mcp.example.com/mcp',
    in_use: true,
    ...overrides,
  };
}

async function waitForPendingConsentRequestId(): Promise<string> {
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ids = mcpAuthPromptRegistry.__listConsentIdsForTests();
    if (ids.length > 0) {
      return ids[0];
    }
  }
  throw new Error('Expected pending MCP auth consent handler');
}

function resolvePendingConsent(requestId: string, decision: McpAuthConsentDecision): void {
  const handler = mcpAuthPromptRegistry.takeConsent(requestId);
  if (!handler) {
    throw new Error(`No pending consent handler for ${requestId}`);
  }
  handler(decision);
}

describe('MCP auth errors', () => {
  beforeEach(() => {
    mcpAuthPromptRegistry.__resetForTests();
  });

  it('emits an interaction event when MCP consent is requested', async () => {
    const metadata = buildMetadata();
    const cfg = makeCfg();

    const listener = vi.fn();
    const unsubscribe = mcpAuthService.onInteraction(listener);

    const tokenPromise = mcpAuthService.getTokenForServer('example-mcp', metadata as any, { cfg });
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'cancel');

    await expect(tokenPromise).rejects.toThrow('MCP_AUTH_CANCELLED');
    expect(listener).toHaveBeenCalledWith({
      serverName: 'example-mcp',
      providerLabel: 'Identity Provider',
      phase: 'consent-requested',
    });

    unsubscribe();
  });
});
