/** @vitest-environment jsdom */

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('../index', () => ({
  log: {
    error: mocks.error,
  },
}));

import { installGlobalErrorHandlers } from '../installGlobalHandlers';

describe('installGlobalErrorHandlers', () => {
  it('writes uncaught errors and rejected promises to the renderer log', () => {
    installGlobalErrorHandlers();

    const error = new Error('renderer exploded');
    window.dispatchEvent(new ErrorEvent('error', {
      message: error.message,
      error,
      filename: 'renderer.tsx',
      lineno: 12,
      colno: 8,
    }));

    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', {
      value: { code: 'E_RENDERER', attempt: 2 },
    });
    window.dispatchEvent(rejection);

    expect(mocks.error).toHaveBeenNthCalledWith(1, {
      mod: 'window.onerror',
      msg: 'renderer exploded',
      err: error,
      error: undefined,
      filename: 'renderer.tsx',
      lineno: 12,
      colno: 8,
      href: window.location.href,
    });
    expect(mocks.error).toHaveBeenNthCalledWith(2, {
      mod: 'unhandledrejection',
      msg: 'Unhandled promise rejection',
      err: undefined,
      reason: { code: 'E_RENDERER', attempt: 2 },
      href: window.location.href,
    });
  });
});
