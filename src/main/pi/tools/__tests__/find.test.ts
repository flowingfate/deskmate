import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IFileSearchQuery, ISearchComplete } from '@main/lib/workspace/SearchService';

const { searchFilesMock } = vi.hoisted(() => ({
  searchFilesMock: vi.fn(),
}));

vi.mock('@main/lib/workspace/WorkspaceWatcher', () => ({
  getWorkspaceWatcher: () => ({ searchFiles: searchFilesMock }),
}));

import { findInternal } from '../find';

const validArgs = {
  description: 'Find project files',
  pattern: 'package',
  workspaceRoot: process.cwd(),
};

afterEach(() => {
  searchFilesMock.mockReset();
  vi.useRealTimers();
});

describe('findInternal', () => {
  it('rejects filesystem roots before spawning a search', async () => {
    await expect(findInternal({ ...validArgs, workspaceRoot: '/' }))
      .rejects.toThrow('workspaceRoot must not be a filesystem root');

    expect(searchFilesMock).not.toHaveBeenCalled();
  });

  it('aborts the search engine when its timeout elapses', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    searchFilesMock.mockImplementation((query: IFileSearchQuery): Promise<ISearchComplete> => {
      receivedSignal = query.signal;
      return new Promise<ISearchComplete>(() => {});
    });

    const result = expect(findInternal(validArgs))
      .rejects.toThrow('find execution failed: Search timeout');
    await vi.advanceTimersByTimeAsync(10_000);

    await result;
    expect(receivedSignal?.aborted).toBe(true);
  });
});
