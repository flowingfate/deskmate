import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setRootForTesting } from '../../../../persist/lib/root';
import { DeskmateTokenCache, type PersistedMcpOAuthEntry } from '../DeskmateTokenCache';

let root: string;

function makeEntry(serverName: string): PersistedMcpOAuthEntry {
  return {
    serverName,
    serverUrl: `https://${serverName}.example.com/mcp`,
    accessToken: `${serverName}-access-token`,
    expiresAt: Date.now() + 60_000,
    refreshToken: `${serverName}-refresh-token`,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'deskmate-oauth-cache-'));
  setRootForTesting(root);
});

afterEach(async () => {
  setRootForTesting('/tmp/deskmate-test-root');
  await rm(root, { recursive: true, force: true });
});

describe('DeskmateTokenCache', () => {
  it('removes every historical OAuth slot for one server without touching another server', async () => {
    const cache = new DeskmateTokenCache('profile-a');
    const slackEntry = makeEntry('slack');
    await cache.setMcpOAuth('github|old-config', makeEntry('github'));
    await cache.setMcpOAuth('github|new-config', makeEntry('github'));
    await cache.setMcpOAuth('slack|config', slackEntry);

    await cache.deleteMcpOAuthForServer('github');

    await expect(cache.getMcpOAuth('github|old-config')).resolves.toBeNull();
    await expect(cache.getMcpOAuth('github|new-config')).resolves.toBeNull();
    await expect(cache.getMcpOAuth('slack|config')).resolves.toEqual(slackEntry);
  });
});
