/**
 * skills 域 atom（D10）。
 *
 * 数据：当前 active profile 下 `skills.json` 索引项（`SkillRecord[]`）。
 * 字段：name / description / version。
 *
 * 订阅通道：
 *   - persist:profile:switched                    → 清空 + hydrate
 *   - persist:agent:registry:updated [kind=skills] → payload.items 直接替换
 */

import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';
import { getInitialSnapshot } from '@/states/_snapshot';
import type { SkillRecord } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'skills.atom' });

interface SkillsState {
  items: SkillRecord[];
  hydrated: boolean;
}

const { get, change, listen, use } = unit<SkillsState>({
  items: [],
  hydrated: false,
});

async function hydrate(): Promise<void> {
  const res = await getInitialSnapshot();
  if (!res.success) {
    logger.warn({ msg: 'getSnapshot failed', error: res.error });
    return;
  }
  change({ items: res.data.skills, hydrated: true });
}

persistEvents['profile:switched']((_e, _payload) => {
  change({ items: [], hydrated: false });
  void hydrate();
});

persistEvents['agent:registry:updated']((_e, payload) => {
  if (payload.kind !== 'skills') return;
  change({ items: payload.items as SkillRecord[], hydrated: true });
});

void hydrate();

// ─────────────── 公共 API ───────────────

export function getSkills(): SkillRecord[] {
  return get().items;
}

export function useSkills(): SkillRecord[] {
  return use().items;
}

export function getSkillByName(name: string): SkillRecord | null {
  return get().items.find((s) => s.name === name) ?? null;
}

export function getSkillsStats(): { totalSkills: number } {
  return { totalSkills: get().items.length };
}

export function listenSkills(cb: (state: SkillsState) => void): VoidFunction {
  return listen(cb);
}
