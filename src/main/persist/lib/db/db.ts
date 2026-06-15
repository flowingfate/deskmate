/**
 * `profiles/{p_id}/index.db` 的连接管理。
 *
 * 设计要点（[ai.prompt/persist.md §9](../../../../../ai.prompt/persist.md)）：
 *  - **每 profile 一个 DB**：与"profile 完全隔离"不变量对齐。否决"全局单 DB + profile_id 列"。
 *  - WAL + synchronous=NORMAL + busy_timeout：与 `sqlite-transport.cjs` 同方针；写期间允许并发读。
 *  - `open(profileId)` 幂等：连接已存在 → 复用；不存在 → 建立 + 跑 DDL + 写 schema_version。
 *  - 不暴露写路径：`SessionIdx` / `JobRunIdx` 通过 `db` 属性持有 Database 实例自管 SQL。
 *
 * 关闭语义：
 *  - `close(profileId)`：单 profile 切换时复用（旧 profile 关 → 新 profile open）。
 *  - `closeAll()`：进程退出。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import Database from 'better-sqlite3';
import type { Database as BetterDb } from 'better-sqlite3';

import { PERSIST_PATH } from '../../../../shared/persist/path';
import { getAppRoot } from '../root';
import { PERSIST_DB_DDL, PERSIST_DB_SCHEMA_VERSION } from './schema';

/** `profiles/{p_id}/index.db` 路径计算 —— 与 PERSIST_PATH 风格保持一致但仅 DB 文件用。 */
export function profileDbPath(profileId: string): string {
  return path.join(PERSIST_PATH.profileDir(getAppRoot(), profileId), 'index.db');
}

/** 一次打开返回的句柄；调用方按 `db` 属性发 SQL。 */
export class ProfileDb {
  private static cache: Map<string, ProfileDb> = new Map();

  /**
   * 取或建一个 profile 的 DB 连接。
   *  - 文件不存在 → 建目录 + 新建 DB + 跑 DDL + 写 schema_version
   *  - 文件存在     → 直接打开（DDL 是 `IF NOT EXISTS`，无副作用；schema_version 不动）
   *  - 已缓存       → 复用同一连接
   */
  static open(profileId: string): ProfileDb {
    const cached = this.cache.get(profileId);
    if (cached) return cached;
    const handle = new ProfileDb(profileId);
    this.cache.set(profileId, handle);
    return handle;
  }

  /** 关闭并释放某 profile 的连接（profile 切换 / 删除 / 测试 reset 用）。 */
  static close(profileId: string): void {
    const handle = this.cache.get(profileId);
    if (!handle) return;
    handle.closeRaw();
    this.cache.delete(profileId);
  }

  /** 关闭所有连接（进程退出）。 */
  static closeAll(): void {
    for (const handle of this.cache.values()) handle.closeRaw();
    this.cache.clear();
  }

  /** 仅测试用：drop 全部缓存而不关闭（让下一次 open() 重建连接，避免跨测试句柄复用）。 */
  static resetForTesting(): void {
    for (const handle of this.cache.values()) {
      try { handle.closeRaw(); } catch { /* ignore */ }
    }
    this.cache.clear();
  }

  public readonly db: BetterDb;

  /**
   * 是否在本次构造时**新建**了 `index.db` 文件（含 schema_version 首次写入）。
   * `Profile.load` 收到 true 时主动跑一次 `rebuildFromDisk` —— 兜底以下场景：
   *  - 从老布局（无 index.db）升级；
   *  - migrate 脚本写好 data.json 但不建 DB；
   *  - 用户手动 unlink index.db / 拷贝其它机器的 profile 目录。
   * 第二次 `open` 复用缓存连接，这个字段不会重置成 true —— 调用方应在首次 open 当下消费。
   */
  public readonly wasCreated: boolean;

  private constructor(public readonly profileId: string) {
    const file = profileDbPath(profileId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.wasCreated = !fs.existsSync(file);
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(PERSIST_DB_DDL);
    // schema_version 仅在首次建表时写入；存在则跳过（未来 migration 走读 → 比 → 升）。
    const row = this.db
      .prepare('SELECT value FROM _meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    if (!row) {
      this.db
        .prepare('INSERT INTO _meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(PERSIST_DB_SCHEMA_VERSION));
    }
  }

  /**
   * SQLite `PRAGMA integrity_check`。返回 true 表示完整；false 表示损坏。
   * 调用方收到 false 后的恢复流程见 step9.md §7：删 DB + 扫盘 rebuild。
   */
  public checkIntegrity(): boolean {
    const rows = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    return rows.length === 1 && rows[0].integrity_check === 'ok';
  }

  /** 读当前 schema 版本（首次建库后即为 PERSIST_DB_SCHEMA_VERSION）。 */
  public schemaVersion(): number {
    const row = this.db
      .prepare('SELECT value FROM _meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  private closeRaw(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}

/**
 * 物理删除某 profile 的 index.db + WAL 副产物。
 * 调用方先 `ProfileDb.close(profileId)` 释放连接，再调本函数。
 * 用于 `checkIntegrity() === false` 后的自愈兜底（step9.md §7）。
 */
export function unlinkProfileDb(profileId: string): void {
  const file = profileDbPath(profileId);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(file + suffix); } catch { /* not exist → ignore */ }
  }
}
