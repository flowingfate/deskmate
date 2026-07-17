/**
 * settings 域 atom（D7）。
 *
 * 数据：当前 active profile 的 `settings.json`（confirmation
 * 等 UI 偏好）。
 *
 * 订阅通道：
 *   - persist:settings:updated → 整体替换
 *
 * 写操作走 `persistApi.updateConfirmationSettings(...)` 等 IPC（main 端最终调
 * `Profile.patchSettings`），main 写盘后会反向广播 `settings:updated`。
 */

import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';

import { getInitialSnapshot } from '@/states/_snapshot';
import type { SettingsFile, ConfirmationSettings, WebSearchSettings } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'settings.atom' });

interface SettingsState {
  settings: SettingsFile;
  hydrated: boolean;
}

const EMPTY: SettingsFile = { version: 1 };

const { get, change, listen, use } = unit<SettingsState>({
  settings: EMPTY,
  hydrated: false,
});

async function hydrate(): Promise<void> {
  const res = await getInitialSnapshot();
  if (!res.success) {
    logger.warn({ msg: 'getSnapshot failed', error: res.error });
    return;
  }
  change({ settings: res.data.settings, hydrated: true });
}



persistEvents['settings:updated']((_e, payload) => {
  change({ settings: payload.settings, hydrated: true });
});

void hydrate();

// ─────────────── 公共 API ───────────────

export function getSettings(): SettingsFile {
  return get().settings;
}

export function useSettings(): SettingsFile {
  return use().settings;
}

export function getConfirmationSettings(): ConfirmationSettings | undefined {
  return get().settings.confirmation;
}

export function useConfirmationSettings(): ConfirmationSettings | undefined {
  return use().settings.confirmation;
}

export function getWebSearchSettings(): WebSearchSettings | undefined {
  return get().settings.webSearch;
}

export function useWebSearchSettings(): WebSearchSettings | undefined {
  return use().settings.webSearch;
}

export function listenSettings(cb: (state: SettingsState) => void): VoidFunction {
  return listen(cb);
}
