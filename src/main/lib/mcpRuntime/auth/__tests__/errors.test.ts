import { McpAuthService } from '..';
import type { McpServerConfig } from '@shared/persist/types';
import type { McpResolvedAuthMetadata } from '../types';

const renderer = vi.hoisted(() => ({ send: vi.fn() }));
const providerMethods = vi.hoisted(() => ({
  invalidateCredentials: vi.fn(async () => undefined),
}));
const callbackServer = vi.hoisted(() => ({
  ensureRunning: vi.fn(async () => undefined),
  getRedirectUri: vi.fn(() => 'http://127.0.0.1:33420/callback'),
}));
const knownDcr = vi.hoisted(() => ({ isUnsupported: vi.fn(() => false) }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userData'),
    getName: vi.fn(() => 'Deskmate'),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));
vi.mock('@main/profileRegistry', () => ({
  ProfileRegistry: {
    require: () => ({ getMainWindow: () => ({ webContents: renderer }) }),
  },
}));

vi.mock('../DeskmateOAuthProvider', () => ({
  PROACTIVE_REFRESH_WINDOW_SEC: 300,
  DeskmateOAuthProvider: vi.fn().mockImplementation(function () {
    return {
      tokens: vi.fn(async () => undefined),
      clientInformation: vi.fn(async () => undefined),
      saveClientInformation: vi.fn(async () => undefined),
      invalidateCredentials: providerMethods.invalidateCredentials,
      markAccessTokenExpired: vi.fn(async () => undefined),
      pinnedCallbackPort: 33420,
    };
  }),
}));
vi.mock('../CallbackServer', () => ({
  getCallbackServer: () => callbackServer,
}));

// 真正的 OAuth 授权码流程不参与本文件测试——resolved noop 即可。
vi.mock('../performOAuthFlow', () => ({
  performOAuthFlow: vi.fn(async () => undefined),
  runRefreshOnly: vi.fn(async () => undefined),
}));

// 默认走支持 DCR 的分支；DCR fallback 用例会显式覆写。
vi.mock('../wellKnownOAuthProviders', () => ({
  isKnownToNotSupportDcr: knownDcr.isUnsupported,
}));

function buildMetadata(): McpResolvedAuthMetadata {
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

async function waitForPromptRequestId(channel: 'mcpAuth:showConsent' | 'mcpAuth:requestClientId'): Promise<string> {
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const message = renderer.send.mock.calls.find(([sentChannel]) => sentChannel === channel);
    const payload = message?.[1];
    if (payload && typeof payload === 'object' && 'requestId' in payload && typeof payload.requestId === 'string') {
      return payload.requestId;
    }
  }
  throw new Error(`Expected ${channel} prompt`);
}

function waitForPendingConsentRequestId(): Promise<string> {
  return waitForPromptRequestId('mcpAuth:showConsent');
}

let authService: McpAuthService;

describe('MCP auth errors', () => {
  beforeEach(() => {
    renderer.send.mockReset();
    providerMethods.invalidateCredentials.mockReset();
    providerMethods.invalidateCredentials.mockResolvedValue(undefined);
    authService = new McpAuthService('p_test');
    callbackServer.ensureRunning.mockReset();
    callbackServer.ensureRunning.mockResolvedValue(undefined);
    callbackServer.getRedirectUri.mockReset();
    callbackServer.getRedirectUri.mockReturnValue('http://127.0.0.1:33420/callback');
    knownDcr.isUnsupported.mockReset();
    knownDcr.isUnsupported.mockReturnValue(false);
  });

  it('emits an interaction event when MCP consent is requested', async () => {
    const metadata = buildMetadata();
    const cfg = makeCfg();
    const listener = vi.fn();
    const unsubscribe = authService.onInteraction(listener);

    const tokenPromise = authService.getTokenForServer('example-mcp', metadata, { cfg });
    const requestId = await waitForPendingConsentRequestId();
    expect(authService.respondConsent(requestId, 'cancel')).toBe(true);

    await expect(tokenPromise).rejects.toThrow('MCP_AUTH_CANCELLED');
    expect(listener).toHaveBeenCalledWith({
      serverName: 'example-mcp',
      providerLabel: 'Identity Provider',
      phase: 'consent-requested',
    });

    unsubscribe();
  });

  it('rejects a response from another Profile auth service', async () => {
    const tokenPromise = authService.getTokenForServer('example-mcp', buildMetadata(), { cfg: makeCfg() });
    const requestId = await waitForPendingConsentRequestId();

    expect(new McpAuthService('p_other').respondConsent(requestId, 'cancel')).toBe(false);
    expect(authService.respondConsent(requestId, 'cancel')).toBe(true);
    await expect(tokenPromise).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('cancels an outstanding prompt when its owner window closes', async () => {
    const tokenPromise = authService.getTokenForServer('example-mcp', buildMetadata(), { cfg: makeCfg() });
    await waitForPendingConsentRequestId();

    authService.cancelPendingPrompts();
    await expect(tokenPromise).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('starts the callback server before showing the DCR client-id prompt', async () => {
    knownDcr.isUnsupported.mockReturnValue(true);
    const tokenPromise = authService.getTokenForServer('example-mcp', buildMetadata(), { cfg: makeCfg() });
    const clientIdRequestId = await waitForPromptRequestId('mcpAuth:requestClientId');

    expect(callbackServer.ensureRunning).toHaveBeenCalledWith(33420);
    expect(authService.respondClientId(clientIdRequestId, { clientId: 'client-id' })).toBe(true);
    const consentRequestId = await waitForPendingConsentRequestId();
    expect(authService.respondConsent(consentRequestId, 'cancel')).toBe(true);

    await expect(tokenPromise).rejects.toThrow('MCP_AUTH_CANCELLED');
  });

  it('invalidates the requested OAuth credential scope', async () => {
    await authService.clearOAuthForServer('example-mcp', makeCfg(), 'all');
    expect(providerMethods.invalidateCredentials).toHaveBeenCalledWith('all');
  });
});
