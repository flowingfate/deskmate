/**
 * 用户附件 sandbox 落盘 + reflink 拷贝。
 *
 * 设计要点:
 * - **拷贝走 `COPYFILE_FICLONE`**:macOS APFS / Linux btrfs|xfs reflink 瞬时 0 占用,
 *   ext4 / NTFS / ReFS 自动 fallback 到普通 copy。一行 API 覆盖三平台。
 * - **session.filesDir() 是唯一边界**:所有 sandbox 路径都从 session 实例拿,
 *   handler 不自己拼路径,避免与 PERSIST_PATH 演化失同步。
 * - **`originalName` 严格 sanitize**:剥所有 `/` `\\` 路径分隔符 → 只取 basename;
 *   `.` / `..` / 空名一律 reject。这是 sandbox 边界的二道闸 —— `local://` handler
 *   的 sandbox 检查只覆盖 LLM 写,attachment IPC 必须自己保证 `path.join(uploadsDir,
 *   originalName)` 不能逃出 uploadsDir(`path.join` 自身不挡 `..`)。
 * - **去重 atomic**:用 `O_EXCL`(`COPYFILE_EXCL` / `wx`)创建 +EEXIST 进位重试,
 *   不走 access-then-create 的 TOCTOU 路径。同名文件追加 `_1`, `_2`, ... 直到没冲突。
 * - **不做大小上限 / binary 检查**:与 `local://` read 不同 —— 这里是物理拷贝,
 *   `local://` 的 1MB 上限只针对 LLM read(文本限制),不限制 sandbox 持有的字节数。
 * - **使用绝对路径源**:`attachFromPath` 接受用户机器上任意绝对路径,不做 sandbox
 *   边界检查 —— 调用方(IPC handler)保证 srcPath 来自 webUtils / fs dialog 的
 *   trusted 来源,这是 Electron renderer 拿绝对路径的唯一合法通道。
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { InternalUrlRouter } from '@main/pi';

export interface AttachContext {
  agentId: string;
  sessionId: string;
}

export interface AttachOutcome {
  /** `local://uploads/<unique-name>` —— LLM-visible URI。 */
  uri: string;
  /** sandbox 内的去重后文件名(可能与 originalName 不同)。 */
  fileName: string;
  /** sandbox 内的绝对路径 —— 调用方一般不用,留给测试 / 调试。 */
  destPath: string;
  /** 落盘字节数。 */
  size: number;
}

/** sandbox 内附件子目录,固定 `uploads`(不暴露给 LLM 之外的语义)。 */
const UPLOADS_DIR = 'uploads';

/** 一个 stem 上的最大去重序号 —— 实际撞上 1 万个同名文件几乎不可能,触发就抛错。 */
const MAX_UNIQUE_SUFFIX = 10_000;

/**
 * 从源绝对路径拷贝到当前 session sandbox 的 uploads/ 子目录。
 *
 * `COPYFILE_FICLONE` 在支持 reflink 的文件系统上瞬时完成(0 额外空间);
 * 不支持的(ext4 / NTFS)自动降级到普通 copy。`COPYFILE_EXCL` 让 dst 已存在
 * 时 EEXIST 抛出,我们据此进位重命名 —— 全程 atomic,无 TOCTOU 窗口。
 */
export async function attachFromPath(
  srcAbsPath: string,
  originalName: string | undefined,
  ctx: AttachContext,
  profileId: string,
): Promise<AttachOutcome> {
  const uploadsDir = await resolveUploadsDir(profileId, ctx);
  const safeName = sanitizeAttachmentName(originalName ?? path.basename(srcAbsPath));
  const finalName = await copyWithUniqueName(srcAbsPath, uploadsDir, safeName);
  const destPath = path.join(uploadsDir, finalName);
  const stat = await fsp.stat(destPath);
  return {
    uri: `local://${UPLOADS_DIR}/${finalName}`,
    fileName: finalName,
    destPath,
    size: stat.size,
  };
}

/**
 * 把内存字节(剪贴板图片 / screenshot / 任意 in-memory blob)写入当前 session
 * sandbox。这条路径不存在 reflink 优化 —— 源就是内存,目的端写入即可。
 * 用 `wx` flag 让创建 atomic;EEXIST 进位重试。
 */
export async function attachFromBytes(
  bytes: Uint8Array,
  originalName: string,
  ctx: AttachContext,
  profileId: string,
): Promise<AttachOutcome> {
  const uploadsDir = await resolveUploadsDir(profileId, ctx);
  const safeName = sanitizeAttachmentName(originalName);
  const finalName = await writeBytesWithUniqueName(bytes, uploadsDir, safeName);
  const destPath = path.join(uploadsDir, finalName);
  const stat = await fsp.stat(destPath);
  return {
    uri: `local://${UPLOADS_DIR}/${finalName}`,
    fileName: finalName,
    destPath,
    size: stat.size,
  };
}

/**
 * 解析 session sandbox 的 uploads/ 子目录绝对路径,ensure 存在。
 *
 * 走 `local://uploads` URI 让 `LocalProtocolHandler` 复用同一套 ctx 校验
 * (Agent / Session not found 的错误消息 + 沙盒边界):attachment 与 LLM
 * `write local://...` 共用一个解析点,不再各做一遍 profile/agent/session 三跳。
 * `mkdir` 是物化职责 —— router 的 `resolveToPath` 只算路径不读 I/O,attachment
 * 落盘前必须自己 ensure 父目录。
 */
async function resolveUploadsDir(profileId: string, ctx: AttachContext): Promise<string> {
  const router = InternalUrlRouter.get();
  const dir = await router.resolveToPath(`local://${UPLOADS_DIR}`, {
    mode: 'agent',
    profileId,
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
  });
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 把 renderer 传来的 `originalName` 收敛为安全的 basename:
 *  - 双平台分隔符(`/` `\\`)统一拆分,只保留最后一段
 *  - 拒绝 `.` / `..` / 空串 / NUL byte
 *
 * `path.join(uploadsDir, name)` 不挡 `..`(`path.join('a/b', '../../etc') === 'etc'`),
 * 必须在拼接前消灭分隔符。这是 sandbox 边界检查的二道闸,与 `local://` handler 的
 * `Sandbox.resolveTarget` 双层互不重叠 —— attachment IPC 直接走 `path.join`,
 * 不经 handler。
 */
function sanitizeAttachmentName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new Error('Attachment name must be a string.');
  }
  if (raw.includes('\0')) {
    throw new Error('Attachment name must not contain NUL byte.');
  }
  // 双平台:把 `\\` 当作分隔符也拆,然后取最后一段。`path.basename` 在 posix 上
  // 只剥 `/`,在 macOS Linux 不会处理 windows 风格的 `..\\foo`。
  const lastSegment = raw.split(/[\\/]+/).filter((s) => s.length > 0).pop() ?? '';
  const trimmed = lastSegment.trim();
  if (trimmed.length === 0 || trimmed === '.' || trimmed === '..') {
    throw new Error(`Invalid attachment name: ${JSON.stringify(raw)}`);
  }
  return trimmed;
}

/**
 * Atomic copy + 唯一名:用 `COPYFILE_EXCL` flag 确保 dst 不存在;EEXIST →
 * 进位下一个 candidate,继续尝试。重名命名规则:`foo.png`、`foo_1.png`、`foo_2.png` ...
 */
async function copyWithUniqueName(src: string, dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  const flags = fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL;
  for (let counter = 0; counter < MAX_UNIQUE_SUFFIX; counter += 1) {
    const candidate = counter === 0 ? name : `${stem}_${counter}${ext}`;
    try {
      await fsp.copyFile(src, path.join(dir, candidate), flags);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Unable to pick unique name in ${dir} for ${name}`);
}

/**
 * Atomic write + 唯一名:`wx` flag 让 open 在 dst 已存在时 EEXIST。
 * 与 `copyWithUniqueName` 同纪律。
 */
async function writeBytesWithUniqueName(
  bytes: Uint8Array,
  dir: string,
  name: string,
): Promise<string> {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let counter = 0; counter < MAX_UNIQUE_SUFFIX; counter += 1) {
    const candidate = counter === 0 ? name : `${stem}_${counter}${ext}`;
    try {
      const fh = await fsp.open(path.join(dir, candidate), 'wx');
      try {
        await fh.writeFile(bytes);
      } finally {
        await fh.close();
      }
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Unable to pick unique name in ${dir} for ${name}`);
}
