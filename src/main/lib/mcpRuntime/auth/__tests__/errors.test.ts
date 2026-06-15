import { createMcpAuthCancelledError, isMcpNeedsUserInteractionError } from '../errors';
import { McpAuthService } from '../McpAuthService';
import { mcpAuthPromptRegistry, type McpAuthConsentDecision } from '../mcpAuthPromptRegistry';
import { log } from '@main/log';

const mockPublicClientApplication = vi.fn();
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('@azure/msal-node', async () => ({
  PublicClientApplication: vi.fn().mockImplementation(function (...args: unknown[]) {
    return mockPublicClientApplication(...args);
  }),
  LogLevel: { Warning: 2, Error: 0 },
}));

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
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf-8')),
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

function buildMetadata() {
  return {
    authorizationServerUrl: 'https://login.microsoftonline.com/organizations/v2.0',
    authorizationServerMetadata: {
      issuer: 'https://login.microsoftonline.com/organizations/v2.0',
      authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
      token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    },
    scopes: ['api://resource/.default'],
    providerLabel: 'Microsoft',
    telemetry: {
      resourceMetadataSource: 'header' as const,
      serverMetadataSource: 'resourceMetadata' as const,
    },
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
  let loggerInfoSpy: MockInstance;
  let loggerWarnSpy: MockInstance;

  beforeEach(() => {
    (McpAuthService as any).instance = null;
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    loggerInfoSpy = vi.spyOn(log, 'info').mockImplementation((...args: unknown[]) => {
      mockLogger.info(...args);
    });
    loggerWarnSpy = vi.spyOn(log, 'warn').mockImplementation((...args: unknown[]) => {
      mockLogger.warn(...args);
    });
    mockPublicClientApplication.mockReset();
    mockPublicClientApplication.mockImplementation(() => ({
      getTokenCache: () => ({
        getAllAccounts: vi.fn().mockResolvedValue([]),
      }),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenInteractive: vi.fn().mockResolvedValue({ accessToken: 'interactive-token' }),
    }));
    delete (global as any).__pendingMcpAuthConsent; // legacy stale state cleanup
    mcpAuthPromptRegistry.__resetForTests();
  });

  afterEach(() => {
    loggerInfoSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  it('does not classify cancelled auth as needing user interaction', () => {
    const error = createMcpAuthCancelledError('edge-growth-brain');

    expect(isMcpNeedsUserInteractionError(error)).toBe(false);
    expect(error.message).toContain('edge-growth-brain');
  });

  it('emits an interaction event when MCP consent is requested', async () => {
    const metadata = buildMetadata();

    const listener = vi.fn();
    const unsubscribe = McpAuthService.onInteraction(listener);

    const tokenPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'cancel');

    await expect(tokenPromise).rejects.toThrow('MCP_AUTH_CANCELLED');
    expect(listener).toHaveBeenCalledWith({
      serverName: 'edge-growth-brain',
      providerLabel: 'Microsoft',
      phase: 'consent-requested',
    });

    unsubscribe();
  });

  it('does not request consent when silent token acquisition succeeds', async () => {
    const metadata = buildMetadata();
    const listener = vi.fn();
    const unsubscribe = McpAuthService.onInteraction(listener);

    mockPublicClientApplication.mockImplementation(() => ({
      getTokenCache: () => ({
        getAllAccounts: vi.fn().mockResolvedValue([{ homeAccountId: 'account-1' }]),
      }),
      acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'silent-token' }),
      acquireTokenInteractive: vi.fn().mockResolvedValue({ accessToken: 'interactive-token' }),
    }));

    await expect(McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any)).resolves.toBe('silent-token');
    expect(listener).not.toHaveBeenCalled();
    expect(mcpAuthPromptRegistry.__listConsentIdsForTests()).toHaveLength(0);

    unsubscribe();
  });

  it('reuses an in-memory token after interactive success when persistent cache remains empty', async () => {
    const metadata = buildMetadata();
    const acquireTokenInteractive = vi.fn().mockResolvedValue({
      accessToken: 'interactive-token',
      expiresOn: new Date(Date.now() + 10 * 60 * 1000),
    });

    mockPublicClientApplication.mockImplementation(() => ({
      getTokenCache: () => ({
        getAllAccounts: vi.fn().mockResolvedValue([]),
      }),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenInteractive,
    }));

    const firstTokenPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'allow-this-time');

    await expect(firstTokenPromise).resolves.toBe('interactive-token');
    await expect(McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any)).resolves.toBe('interactive-token');
    expect(acquireTokenInteractive).toHaveBeenCalledTimes(1);
    expect(mcpAuthPromptRegistry.__listConsentIdsForTests()).toHaveLength(0);
  });

  it('deduplicates concurrent token requests for the same authority and scope set', async () => {
    const metadata = buildMetadata();
    const acquireTokenInteractive = vi.fn().mockResolvedValue({
      accessToken: 'interactive-token',
      expiresOn: new Date(Date.now() + 10 * 60 * 1000),
    });

    mockPublicClientApplication.mockImplementation(() => ({
      getTokenCache: () => ({
        getAllAccounts: vi.fn().mockResolvedValue([]),
      }),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenInteractive,
    }));

    const firstPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const secondPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'allow-this-time');

    await expect(firstPromise).resolves.toBe('interactive-token');
    await expect(secondPromise).resolves.toBe('interactive-token');
    expect(acquireTokenInteractive).toHaveBeenCalledTimes(1);
  });

  it('uses the built-in MCP client ID when no challenge hint is provided', async () => {
    const metadata = buildMetadata();

    const tokenPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'allow-this-time');

    await expect(tokenPromise).resolves.toBe('interactive-token');
    expect(mockPublicClientApplication).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        clientId: 'aebc6443-996d-45c2-90f0-388ff96faa56',
      }),
    }));
  });

  it('uses a challenge-provided internal client hint when present', async () => {
    const metadata = {
      ...buildMetadata(),
      scopes: ['api://resource/.default', 'VSCODE_CLIENT_ID:hinted-client-id'],
    };
    const tokenPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'allow-this-time');

    await expect(tokenPromise).resolves.toBe('interactive-token');
    expect(mockPublicClientApplication).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        clientId: 'hinted-client-id',
      }),
    }));
  });

  it('always uses the external browser interactive flow', async () => {
    const metadata = buildMetadata();
    const acquireTokenInteractive = vi.fn().mockResolvedValue({ accessToken: 'interactive-token' });

    mockPublicClientApplication.mockImplementation(() => ({
      getTokenCache: () => ({
        getAllAccounts: vi.fn().mockResolvedValue([]),
      }),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenInteractive,
    }));

    const tokenPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'allow-this-time');

    await expect(tokenPromise).resolves.toBe('interactive-token');
    expect(acquireTokenInteractive).toHaveBeenCalledWith(expect.objectContaining({
      scopes: ['api://resource/.default'],
      openBrowser: expect.any(Function),
      successTemplate: expect.any(String),
      errorTemplate: expect.any(String),
    }));
    expect(acquireTokenInteractive).not.toHaveBeenCalledWith(expect.objectContaining({
      windowHandle: expect.anything(),
    }));
  });

  it('logs that the MSAL client is configured for external-browser-first auth', async () => {
    const metadata = buildMetadata();

    const tokenPromise = McpAuthService.getInstance().getTokenForServer('edge-growth-brain', metadata as any);
    const requestId = await waitForPendingConsentRequestId();
    resolvePendingConsent(requestId, 'allow-this-time');

    await expect(tokenPromise).resolves.toBe('interactive-token');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('Created MSAL client (external-browser-first)') }),
    );
  });
});