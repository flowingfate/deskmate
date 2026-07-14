// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpMocks = vi.hoisted(() => ({
  connectServer: vi.fn(),
  disconnectServer: vi.fn(),
  reconnectServer: vi.fn(),
  deleteServer: vi.fn(),
  refresh: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('@/ipc/mcp', () => ({
  mcpApi: {
    connectServer: mcpMocks.connectServer,
    disconnectServer: mcpMocks.disconnectServer,
    reconnectServer: mcpMocks.reconnectServer,
    deleteServer: mcpMocks.deleteServer,
  },
}));

vi.mock('@/lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { refresh: mcpMocks.refresh },
}));

vi.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    showError: mcpMocks.showError,
    showSuccess: mcpMocks.showSuccess,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import { useMcpServerActions } from './useMcpServerActions';

function ActionsHarness(): React.ReactElement {
  const actions = useMcpServerActions();
  const operation = actions.operationStates.server?.operation ?? 'idle';

  return (
    <>
      <output data-testid="operation">{operation}</output>
      <output data-testid="delete-open">{String(actions.deleteDialog.open)}</output>
      <button onClick={() => void actions.connect('server')}>Connect</button>
      <button onClick={() => void actions.disconnect('server')}>Disconnect</button>
      <button onClick={() => void actions.reconnect('server')}>Reconnect</button>
      <button onClick={() => actions.requestDelete('server')}>Request delete</button>
      <button onClick={() => void actions.confirmDelete()}>Confirm delete</button>
    </>
  );
}

type McpApiMethod = 'connectServer' | 'disconnectServer' | 'reconnectServer';

const operationCases: Array<[string, McpApiMethod, string]> = [
  ['Connect', 'connectServer', 'connect'],
  ['Disconnect', 'disconnectServer', 'disconnect'],
  ['Reconnect', 'reconnectServer', 'reconnect'],
];

describe('useMcpServerActions', () => {
  beforeEach(() => {
    mcpMocks.refresh.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(operationCases)('tracks and refreshes a successful %s operation', async (label, apiMethod, operation) => {
    let resolveOperation: ((result: { success: boolean; error?: string }) => void) | undefined;
    const result = new Promise<{ success: boolean; error?: string }>((resolve) => {
      resolveOperation = resolve;
    });
    mcpMocks[apiMethod].mockReturnValueOnce(result);
    render(<ActionsHarness />);

    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByTestId('operation')).toHaveTextContent(operation);

    await act(async () => {
      resolveOperation?.({ success: true });
      await result;
    });

    await waitFor(() => expect(screen.getByTestId('operation')).toHaveTextContent('idle'));
    expect(mcpMocks[apiMethod]).toHaveBeenCalledWith('server');
    expect(mcpMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the real error and clears pending state when an operation fails', async () => {
    mcpMocks.connectServer.mockResolvedValueOnce({ success: false, error: 'connection refused' });
    render(<ActionsHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.getByTestId('operation')).toHaveTextContent('idle'));
    expect(mcpMocks.showError).toHaveBeenCalledWith('Failed to connect server: connection refused');
    expect(mcpMocks.refresh).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation and refreshes the runtime cache', async () => {
    mcpMocks.deleteServer.mockResolvedValueOnce({ success: true });
    render(<ActionsHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Request delete' }));
    expect(screen.getByTestId('delete-open')).toHaveTextContent('true');
    expect(mcpMocks.deleteServer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(mcpMocks.deleteServer).toHaveBeenCalledWith('server'));
    expect(mcpMocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('delete-open')).toHaveTextContent('false');
  });
});
