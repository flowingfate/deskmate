import type {
  GuestProfileEntry,
  ProfileIndexEntry,
  ProfilesIndexFile,
  SignedInProfileEntry,
} from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { newEntityId } from '../../shared/persist/id';
import { Profile } from './profile';
import { unlinkProfileDb } from './lib/db/db';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { readJsonOrNull, writeJson } from './lib/atomic';
import { nowIso } from '@shared/persist/time';
import { mcpClientManager } from '@main/lib/mcpRuntime'

const PROFILES_FILE_VERSION = 1 as const;

function isSignedIn(entry: ProfileIndexEntry): entry is SignedInProfileEntry {
  return entry.kind === 'signed_in';
}

async function safe(label: string, fn: () => Promise<unknown>, warnings: string[]): Promise<void> {
  try {
    await fn();
  } catch (err) {
    warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 对应 profiles/profiles.json —— 跨 profile 的索引 + active 切换。
 * 单例：整个进程只有一份 Profiles 注册表。
 */
export class Profiles {
  private static instance: Profiles | null = null;

  static get(): Profiles {
    if (!Profiles.instance) Profiles.instance = new Profiles();
    return Profiles.instance;
  }

  /** 仅供测试用：丢掉单例，让下一次 `Profiles.get()` 重建。 */
  static resetForTesting(): void {
    Profiles.instance = null;
  }

  public items: ProfileIndexEntry[] = [];
  public activeProfileId: string = '';
  private bootstrapped = false;

  private constructor() {}

  /**
   * 进程退出前调用：等所有已加载 Profile 走完 shutdown（flush pending messages + close DB）。
   * 与 `Profile.shutdownAll` 的 `Promise.allSettled` 语义对齐 —— 单个失败不阻塞其它。
   */
  public async shutdown(): Promise<void> {
    await Profile.shutdownAll();
  }

  private indexFilePath(): string {
    return PERSIST_PATH.profilesIndex(getAppRoot());
  }

  /**
   * 启动期调用。完整流程（[ai.prompt/persist.md §5](../../../ai.prompt/persist.md)）：
   *
   *  1. profilesIndex.ensure() —— items 为空 → 初始化 guest
   *  2. resolveActive() —— activeProfileId 不在 items 中 → fallback items[0]
   *  3. profile.settings 装载
   *  4. profile.mcp / sub-agents / skills / models 装载
   *  5. agent registry 装载（默认 agent 注入由调用方负责）
   *  6. Profile.load 内部已开 `ProfileDb` + integrity_check（损坏 → 自愈重建两张表）
   *  7. profile.reconcileAgents() —— 目录 ↔ agents.json items 对账
   *  8. archive.gc(retainDays?) —— 可选，留给调用方按需调
   *
   * Step 9 起 starred 真值是 `regular_sessions.starred_at` 列，无独立 `starred.load` 步。
   *
   * 每步异常都会被收集到 warnings；不让单个错误拖累整个 bootstrap。
   *
   * **幂等**：重复调用立刻 no-op 返回（用 `bootstrapped` flag）。供 startup 多入口（main / lazy /
   * evalMode）安全调用，无需调用方协调。
   */
  public async bootstrap(): Promise<{ warnings: string[] }> {
    if (this.bootstrapped) return { warnings: [] };
    const warnings: string[] = [];

    // 1 + 2: profilesIndex.ensure + resolveActive
    const file = await readJsonOrNull<ProfilesIndexFile>(this.indexFilePath());
    if (!file || !Array.isArray(file.items) || file.items.length === 0) {
      const profile = await Profile.getOrLoad(newEntityId('p'));
      this.items = [this.makeGuestEntry(profile.id)];
      this.activeProfileId = profile.id;
      await this.persist();
    } else {
      this.items = file.items;
      const exists = this.items.some((p) => p.id === file.activeProfileId);
      this.activeProfileId = exists ? file.activeProfileId : this.items[0].id;
      if (!exists) {
        warnings.push(`activeProfileId ${file.activeProfileId} not in items; fell back to ${this.activeProfileId}`);
        await this.persist();
      }
    }

    // 3-8 都针对 active profile
    const profile = await this.active();
    const reconcile = await profile.reconcileAgents();
    if (reconcile.droppedFromIndex.length || reconcile.primaryCleared) {
      warnings.push(
        `reconcileAgents: index-drop=${reconcile.droppedFromIndex.length} primary-cleared=${reconcile.primaryCleared}`,
      );
    }

    this.bootstrapped = true;
    await mcpClientManager.initialize();
    return { warnings };
  }

  public async persist(): Promise<void> {
    await writeJson(this.indexFilePath(), this.toFile());
  }

  public list(): ProfileIndexEntry[] {
    return this.items;
  }

  /** 加载并返回当前 active profile 的 Profile 实例。 */
  public async active(): Promise<Profile> {
    if (!this.activeProfileId) {
      throw new Error('Profiles.active(): no active profile; bootstrap() not called?');
    }
    return Profile.getOrLoad(this.activeProfileId);
  }

  /**
   * 同步取 active profile —— 仅在 bootstrap() 完成后可用。
   * 给登录关键路径上的 sync getter（skill / subAgent 等同步 lookup）用。
   * 实现走 `Profile.get()` 同步缓存（bootstrap 已 load 进 cache）；未 bootstrap 时抛错。
   */
  public activeSync(): Profile {
    if (!this.bootstrapped) {
      throw new Error('Profiles.activeSync(): bootstrap() not finished');
    }
    const profile = Profile.get(this.activeProfileId);
    if (!profile) {
      throw new Error(`Profiles.activeSync(): profile ${this.activeProfileId} not in cache`);
    }
    return profile;
  }

  public getEntry(id: string): ProfileIndexEntry | undefined {
    return this.items.find((p) => p.id === id);
  }

  /** 手动新建一个未登录 profile（与首启动初始化出的 profile 完全同构）。 */
  public async create(input: { displayName?: string } = {}): Promise<Profile> {
    const profile = await Profile.getOrLoad(newEntityId('p'));
    this.items.push(this.makeGuestEntry(profile.id, input.displayName));
    await this.persist();
    return profile;
  }

  /**
   * 切换 active。
   * 旧 profile：先 flush pending messages + 关闭 SQLite 连接 + evict instance cache。
   * 否则旧 Agent / Session 留缓存，再切回来取到 stale；Windows 上 DB 句柄锁更会卡。
   */
  public async switch(id: string) {
    const entry = this.getEntry(id);
    if (!entry) throw new Error(`Profiles.switch: unknown profile id ${id}`);
    const previous = this.activeProfileId;
    if (previous && previous !== id) {
      await mcpClientManager.disposeAllClients();
      const prevInstance = Profile.get(previous);
      if (prevInstance) {
        await prevInstance.shutdown(); // 内部已 ProfileDb.close(previous)
        Profile.evict(previous);
      }
    }
    this.activeProfileId = id;
    entry.lastActiveAt = nowIso();
    const profile = await Profile.getOrLoad(id);
    await this.persist();
    emit('profile:switched', { profileId: id, previous });
    await mcpClientManager.initialize();
    return profile;
  }

  /**
   * 删除 profile（最后一个不可删）。
   * 写顺序：splice items → 若是 active 则切到 items[0] → shutdown + evict 被删 profile →
   * unlink index.db（释放 WAL/shm）→ 写 profiles.json。
   * 磁盘目录的物理清理（archive/recursive rm）仍待后续 PR；本步只确保 DB 句柄不悬空。
   */
  public async remove(id: string): Promise<void> {
    if (this.items.length <= 1) {
      throw new Error('Profiles.remove: cannot delete the last profile');
    }
    const idx = this.items.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Profiles.remove: unknown profile id ${id}`);
    this.items.splice(idx, 1);
    if (this.activeProfileId === id) {
      this.activeProfileId = this.items[0].id;
      await Profile.getOrLoad(this.activeProfileId);
    }
    const instance = Profile.get(id);
    if (instance) await instance.shutdown(); // 内部 ProfileDb.close(id)
    Profile.evict(id);
    unlinkProfileDb(id); // 释放 index.db + WAL + shm（即使没 instance 也兜底）
    await this.persist();
    // 注：磁盘其它目录的物理清理走 Profile.archive 流程，在后续 PR 接入。
  }

  /**
   * 登录：在当前 active profile 上附加认证。auth.json 写入由调用方自己做
   * （`profile.auth.write(...)`）；这里只更新 index entry 的 kind。
   */
  public async attachAuth(id: string, provider: string, alias: string): Promise<void> {
    const entry = this.getEntry(id);
    if (!entry) throw new Error(`Profiles.attachAuth: unknown profile id ${id}`);
    const next: SignedInProfileEntry = {
      id: entry.id,
      displayName: entry.displayName,
      avatar: entry.avatar,
      createdAt: entry.createdAt,
      lastActiveAt: nowIso(),
      kind: 'signed_in',
      authProvider: provider,
      authAlias: alias,
    };
    const idx = this.items.findIndex((p) => p.id === id);
    this.items[idx] = next;
    await this.persist();
  }

  /** 登出：撤销 entry 的认证标记（业务数据保留）；auth.json 物理删除由调用方做。 */
  public async detachAuth(id: string): Promise<void> {
    const entry = this.getEntry(id);
    if (!entry) throw new Error(`Profiles.detachAuth: unknown profile id ${id}`);
    if (!isSignedIn(entry)) return;
    const next: GuestProfileEntry = {
      id: entry.id,
      displayName: entry.displayName,
      avatar: entry.avatar,
      createdAt: entry.createdAt,
      lastActiveAt: nowIso(),
      kind: 'guest',
    };
    const idx = this.items.findIndex((p) => p.id === id);
    this.items[idx] = next;
    await this.persist();
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------
  private toFile(): ProfilesIndexFile {
    return {
      version: PROFILES_FILE_VERSION,
      activeProfileId: this.activeProfileId,
      items: this.items,
    };
  }


  private makeGuestEntry(id: string, displayName?: string): GuestProfileEntry {
    const ts = nowIso();
    return {
      id,
      displayName: displayName ?? 'Guest',
      createdAt: ts,
      lastActiveAt: ts,
      kind: 'guest',
    };
  }
}
