/**
 * Atomic write + 简单 fs 帮助函数。
 * 所有 persist store 的磁盘 io 必须经过此处，统一保障 tmp→rename 原子性。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 读 JSON；文件不存在返回 null（不抛）。解析失败照样抛。 */
export async function readJsonOrNull<T>(file: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function tmpPath(file: string): string {
  return `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function writeText(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = tmpPath(file);
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, file);
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, JSON.stringify(value, null, 2) + '\n');
}

/** 追加到文件末尾；目录会自动创建。非原子，append-only 场景专用（如 jsonl 流）。 */
export async function appendText(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  await fsp.appendFile(file, content, 'utf8');
}

export async function removeFileIfExists(file: string): Promise<void> {
  try {
    await fsp.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

export async function removeDirIfExists(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true });
}

/** 列出目录下的文件名（不含目录）。目录不存在返回 []。 */
export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * 列出目录下的子目录名。目录不存在返回 []。
 * `followSymlinks` 打开时，指向目录的软链接也计入（用于 skills 的 linked skill —— 外部 agent
 * 目录以 symlink 落在 skills/ 下，默认 `isDirectory()` 对 symlink 返回 false 会漏掉它们）。
 */
export async function listDirs(
  dir: string,
  followSymlinks: boolean = false,
): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const names: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        names.push(e.name);
      } else if (followSymlinks && e.isSymbolicLink()) {
        // 跟随软链接 stat 目标；断链或指向文件则跳过。
        const target = await fsp.stat(path.join(dir, e.name)).catch(() => null);
        if (target?.isDirectory()) names.push(e.name);
      }
    }
    return names;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * 递归统计目录占用的字节总数（含所有子目录/文件）。目录不存在返回 0。
 * 用于"本地数据透明"页展示各资源占盘大小。走 `withFileTypes` 深度优先遍历，
 * 单个子项 stat / readdir 失败静默跳过（例如遍历途中文件被删），不让局部错误拖垮整体统计。
 */
export async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await dirBytes(full);
      } else if (entry.isFile()) {
        total += (await fsp.stat(full)).size;
      }
    } catch {
      /* 遍历途中被删 / 权限问题：跳过该项 */
    }
  }
  return total;
}

/** 移动目录或文件；目标父目录会自动创建。 */
export async function move(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  await fsp.rename(from, to);
}

/** 同步版本只在 bootstrap 早期使用——避免在 active 之前 await 进位。 */
export function readJsonSyncOrNull<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
