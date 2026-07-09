/**
 * Tests for the new error-marker helpers in `errors.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  createMcpAuthCancelledError,
  createMcpDcrRequiresUserClientIdError,
  createMcpOAuthFlowFailedError,
  isMcpAuthCancelledError,
  isMcpDcrRequiresUserClientIdError,
  MCP_AUTH_CANCELLED_CODE,
  MCP_DCR_REQUIRES_USER_CLIENT_ID_CODE,
  MCP_OAUTH_FLOW_FAILED_CODE,
} from '../errors';

describe('Mcp auth error helpers', () => {
  it('createMcpAuthCancelledError carries the cancel code', () => {
    const e = createMcpAuthCancelledError('github');
    expect(e.message).toContain(`[${MCP_AUTH_CANCELLED_CODE}]`);
    expect(e.message).toContain('github');
    expect(isMcpAuthCancelledError(e)).toBe(true);
    expect(isMcpDcrRequiresUserClientIdError(e)).toBe(false);
  });

  it('createMcpDcrRequiresUserClientIdError carries the DCR-fallback code', () => {
    const e = createMcpDcrRequiresUserClientIdError('slack');
    expect(e.message).toContain(`[${MCP_DCR_REQUIRES_USER_CLIENT_ID_CODE}]`);
    expect(isMcpDcrRequiresUserClientIdError(e)).toBe(true);
    expect(isMcpAuthCancelledError(e)).toBe(false);
  });

  it('createMcpOAuthFlowFailedError carries the flow-failed code and cause', () => {
    const e = createMcpOAuthFlowFailedError('atlassian', 'connection refused');
    expect(e.message).toContain(`[${MCP_OAUTH_FLOW_FAILED_CODE}]`);
    expect(e.message).toContain('atlassian');
    expect(e.message).toContain('connection refused');
    expect(isMcpAuthCancelledError(e)).toBe(false);
  });

  it('isMcp* predicates ignore null/undefined', () => {
    expect(isMcpAuthCancelledError(null)).toBe(false);
    expect(isMcpAuthCancelledError(undefined)).toBe(false);
    expect(isMcpDcrRequiresUserClientIdError(null)).toBe(false);
  });

  it('isMcp* predicates reject errors without the marker prefix', () => {
    const e = new Error('plain old error');
    expect(isMcpAuthCancelledError(e)).toBe(false);
    expect(isMcpDcrRequiresUserClientIdError(e)).toBe(false);
  });
});
