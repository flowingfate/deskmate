/**
 * Skill zip/skill 归档的解压逻辑，含扁平结构探测与 macOS 元数据剔除
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type TransformCallback } from 'node:stream';

import { log } from '@main/log';
import JSZip from 'jszip';

const logger = log;

const SEMVER_SUFFIX = /^(.+)-(\d+\.\d+\.\d+)$/;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1_000;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;

interface ExtractionBudget {
  totalBytes: number;
}

class ArchiveEntrySizeLimit extends Transform {
  private entryBytes = 0;

  public constructor(private readonly budget: ExtractionBudget) {
    super();
  }

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const chunkBytes = chunk.length;
    this.entryBytes += chunkBytes;
    this.budget.totalBytes += chunkBytes;

    if (this.entryBytes > MAX_ENTRY_BYTES) {
      callback(new Error(`Archive entry exceeds ${MAX_ENTRY_BYTES} byte limit.`));
      return;
    }
    if (this.budget.totalBytes > MAX_EXTRACTED_BYTES) {
      callback(new Error(`Archive exceeds ${MAX_EXTRACTED_BYTES} byte extraction limit.`));
      return;
    }
    callback(null, chunk);
  }
}

function isMacosMetadata(entry: string): boolean {
  return entry.startsWith('__MACOSX/') || entry === '__MACOSX' || path.basename(entry) === '.DS_Store';
}

function assertSafeArchiveEntryPath(entry: string): void {
  if (
    !entry ||
    entry.includes('\\') ||
    path.isAbsolute(entry) ||
    path.posix.isAbsolute(entry) ||
    /^[a-zA-Z]:/.test(entry)
  ) {
    throw new Error(`Unsafe archive entry path "${entry}".`);
  }

  const segments = entry.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe archive entry path "${entry}".`);
  }
}

function resolveArchivePath(destDir: string, extractPrefix: string, relativePath: string): string {
  const root = path.resolve(destDir);
  const target = path.resolve(root, extractPrefix, relativePath);
  if (!target.startsWith(root + path.sep)) {
    throw new Error(`Archive entry "${relativePath}" escapes the extraction directory.`);
  }
  return target;
}

/**
 * 探测 zip 是否由单一根目录包裹所有文件。命中返回根目录名，否则返回 null。
 */
function detectZipRootDirectory(fileEntries: string[]): string | null {
  if (fileEntries.length === 0) return null;

  const topLevelNames = new Set<string>();
  let hasTopLevelFile = false;

  for (const entry of fileEntries) {
    if (isMacosMetadata(entry)) continue;

    const parts = entry.split('/').filter((part) => part.length > 0);
    if (parts.length === 0) continue;
    if (parts.length === 1 && parts[0] === '.DS_Store') continue;

    topLevelNames.add(parts[0]);
    if (parts.length === 1 && !entry.endsWith('/')) {
      hasTopLevelFile = true;
    }
  }

  if (hasTopLevelFile || topLevelNames.size !== 1) return null;
  return topLevelNames.values().next().value || null;
}

async function extractEntry(
  file: JSZip.JSZipObject,
  filePath: string,
  budget: ExtractionBudget,
): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await pipeline(
    file.nodeStream('nodebuffer'),
    new ArchiveEntrySizeLimit(budget),
    fs.createWriteStream(filePath, { flags: 'wx' }),
  );
}

/** 统一解压逻辑。返回解压后 skill 内容的根目录名。 */
export async function extractZip(zipPath: string, destDir: string): Promise<string> {
  try {
    const archiveSize = fs.statSync(zipPath).size;
    if (archiveSize > MAX_ARCHIVE_BYTES) {
      throw new Error(`Archive exceeds ${MAX_ARCHIVE_BYTES} byte size limit.`);
    }

    logger.info({ msg: `[SkillManager] Reading zip file: ${zipPath}` });
    const zipData = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(zipData);
    const entries = Object.entries(zip.files);
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`Archive exceeds ${MAX_ARCHIVE_ENTRIES} entry limit.`);
    }
    for (const [relativePath, file] of entries) {
      assertSafeArchiveEntryPath(file.unsafeOriginalName ?? relativePath);
    }

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const hasRootDir = detectZipRootDirectory(entries.map(([relativePath]) => relativePath));
    let rootDirName: string;
    let extractPrefix: string;

    if (hasRootDir) {
      rootDirName = hasRootDir;
      extractPrefix = '';
      logger.info({ msg: `[SkillManager] Zip has root directory: "${rootDirName}"` });
    } else {
      rootDirName = path.basename(zipPath).replace(/\.(zip|skill)$/i, '');
      const versionMatch = rootDirName.match(SEMVER_SUFFIX);
      if (versionMatch) rootDirName = versionMatch[1];
      extractPrefix = `${rootDirName}/`;
      logger.info({ msg: `[SkillManager] Zip has flat structure, creating virtual root directory: "${rootDirName}"` });
    }

    const budget: ExtractionBudget = { totalBytes: 0 };
    for (const [relativePath, file] of entries) {
      if (isMacosMetadata(relativePath)) continue;

      const filePath = resolveArchivePath(destDir, extractPrefix, relativePath);
      if (file.dir) {
        fs.mkdirSync(filePath, { recursive: true });
        continue;
      }
      await extractEntry(file, filePath, budget);
    }

    logger.info({ msg: `[SkillManager] Extracted zip to: ${destDir}` });
    return rootDirName;
  } catch (error) {
    throw new Error(`Failed to extract zip: ${error instanceof Error ? error.message : String(error)}`);
  }
}
