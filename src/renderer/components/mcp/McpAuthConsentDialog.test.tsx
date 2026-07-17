// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthConsentPayload } from '@shared/ipc/mcp';

type ConsentListener = (_event: undefined, payload: McpAuthConsentPayload) => void;

const mcpMocks = vi.hoisted(() => {
  let listener: ConsentListener | undefined;

  return {
    respondConsent: vi.fn(async () => undefined),
    showConsent: vi.fn((callback: ConsentListener) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    }),
    emitConsent(payload: McpAuthConsentPayload): void {
      listener?.(undefined, payload);
    },
  };
});

vi.mock('@/ipc/mcp', () => ({
  mcpAuthApi: { respondConsent: mcpMocks.respondConsent },
  mcpAuthEvents: { showConsent: mcpMocks.showConsent },
}));

import McpAuthConsentDialog from './McpAuthConsentDialog';

function makePayload(requestId: string, serverName: string): McpAuthConsentPayload {
  return {
    requestId,
    serverName,
    providerLabel: 'GitHub',
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mcpMocks.respondConsent.mockClear();
  mcpMocks.showConsent.mockClear();
});

describe('McpAuthConsentDialog', () => {
  it('shows concurrent consent prompts in arrival order', async () => {
    render(<McpAuthConsentDialog />);

    act(() => {
      mcpMocks.emitConsent(makePayload('request-a', 'server-a'));
      mcpMocks.emitConsent(makePayload('request-b', 'server-b'));
    });

    expect(screen.getByText('server-a')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => {
      expect(mcpMocks.respondConsent).toHaveBeenCalledWith('request-a', 'cancel');
    });
    expect(screen.getByText('server-b')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => {
      expect(mcpMocks.respondConsent).toHaveBeenCalledWith('request-b', 'allow-this-time');
    });
  });
});
