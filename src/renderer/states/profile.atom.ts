/**
 * profile 域 atom。
 *
 * 当前只承载 active profileId。primaryAgentId 已并入 agents 域（见 agents.atom）。
 *
 * 订阅通道：
 *   - persist:profile:switched   → 重新 hydrate
 */

import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';
import { getInitialSnapshot } from '@/states/_snapshot';
import { log } from '@/log';

const logger = log.child({ mod: 'profile.atom' });

interface ProfileState {
  profileId: string | null;
  hydrated: boolean;
}

const { get, change, listen, use } = unit<ProfileState>({
  profileId: null,
  hydrated: false,
});

async function hydrate(): Promise<void> {
  const res = await getInitialSnapshot();
  if (!res.success) {
    logger.warn({ msg: 'getSnapshot failed', error: res.error });
    return;
  }
  const data = res.data;
  change({ profileId: data.profileId, hydrated: true });
}

persistEvents['profile:switched']((_e, payload) => {
  change({ profileId: payload.profileId, hydrated: true });
});

void hydrate();

// ─────────────── 公共 API ───────────────

/** 同步取当前 active profileId。 */
export function getProfileId(): string | null {
  return get().profileId;
}

/** React Hook：订阅当前 active profileId。 */
export function useProfileId(): string | null {
  return use().profileId;
}

/** 非 React 代码订阅 profile 变化。 */
export function listenProfile(cb: (state: ProfileState) => void): VoidFunction {
  return listen(cb);
}
