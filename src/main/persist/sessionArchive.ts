import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type TransformCallback } from 'node:stream';

import JSZip from 'jszip';
import StreamZip, { type ZipEntry } from 'node-stream-zip';

import type { RegularSessionDataFile } from '../../shared/persist/types';
import { newEntityId } from '../../shared/persist/id';
import { PERSIST_PATH } from '../../shared/persist/path';
import type { Session } from './session';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { SessionIdx } from './lib/db/sessionIdx';
import { readJsonOrNull, removeDirIfExists, writeJson } from './lib/atomic';

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1_000;
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;

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
    this.entryBytes += chunk.length;
    this.budget.totalBytes += chunk.length;

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

class ArchiveOutputSizeLimit extends Transform {
  private totalBytes = 0;

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.totalBytes += chunk.length;
    if (this.totalBytes > MAX_ARCHIVE_BYTES) {
      callback(new Error(`Archive exceeds ${MAX_ARCHIVE_BYTES} byte size limit.`));
      return;
    }
    callback(null, chunk);
  }
}

type SessionArchiveInfo = {
  version: 1;
  session: {
    id: string;
    agentId: string;
    kind: 'regular' | 'schedule_run';
    month: string;
  };
};
interface ImportedSessionArchive {
  sessionDir: string;
  month: string;
  data: RegularSessionDataFile;
}

function isMacosMetadata(entry: string): boolean {
  return entry.startsWith('__MACOSX/') || entry === '__MACOSX' || path.posix.basename(entry) === '.DS_Store';
}

function assertSafeArchiveEntryPath(entry: string): void {
  if (
    !entry
    || entry.includes('\\')
    || path.isAbsolute(entry)
    || path.posix.isAbsolute(entry)
    || /^[a-zA-Z]:/.test(entry)
  ) {
    throw new Error(`Unsafe archive entry path "${entry}".`);
  }

  if (entry.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe archive entry path "${entry}".`);
  }
}

function assertArchiveLimits(entries: ZipEntry[]): void {
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Archive exceeds ${MAX_ARCHIVE_ENTRIES} entry limit.`);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_ENTRY_BYTES) {
      throw new Error(`Archive entry "${entry.name}" exceeds ${MAX_ENTRY_BYTES} byte limit.`);
    }
    totalBytes += entry.size;
    if (totalBytes > MAX_EXTRACTED_BYTES) {
      throw new Error(`Archive exceeds ${MAX_EXTRACTED_BYTES} byte extraction limit.`);
    }
  }
}

function archiveRoot(entries: ZipEntry[]): string {
  const roots = new Set<string>();

  for (const entry of entries) {
    if (isMacosMetadata(entry.name)) continue;
    assertSafeArchiveEntryPath(entry.name);

    const parts = entry.name.split('/').filter((part) => part.length > 0);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      if (!entry.isDirectory) throw new Error('Session archive must contain exactly one root directory.');
      roots.add(parts[0]);
      continue;
    }
    roots.add(parts[0]);
  }

  if (roots.size !== 1) {
    throw new Error('Session archive must contain exactly one root directory.');
  }

  const root = roots.values().next().value;
  if (!root) throw new Error('Session archive is empty.');
  return root;
}

function validateArchiveInfo(info: SessionArchiveInfo, data: RegularSessionDataFile, root: string): void {
  const session = info?.session;
  if (
    info?.version !== 1
    || session?.kind !== 'regular'
    || !/^\d{6}$/.test(session?.month)
    || data.kind !== 'regular'
    || root !== session.id
    || data.id !== session.id
    || data.agentId !== session.agentId
  ) {
    throw new Error('Invalid regular session archive.');
  }
}

async function addDirectoryToZip(sourceDir: string, archiveDir: JSZip): Promise<void> {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      const nestedArchiveDir = archiveDir.folder(entry.name);
      if (!nestedArchiveDir) throw new Error(`Failed to add directory "${entry.name}" to session archive.`);
      await addDirectoryToZip(sourcePath, nestedArchiveDir);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Session archive does not support non-file entry "${entry.name}".`);
    }
    archiveDir.file(entry.name, fs.createReadStream(sourcePath));
  }
}

async function writeArchive(archive: JSZip, outputPath: string): Promise<void> {
  try {
    await pipeline(
      archive.generateNodeStream({
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        streamFiles: true,
      }),
      new ArchiveOutputSizeLimit(),
      fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await fsp.rm(outputPath, { force: true });
    throw error;
  }
}

export async function exportSessionArchive(session: Session, outputPath: string): Promise<void> {
  await session.persist();
  await session.shutdown();

  const data = session.toDataFile();
  const sessionInfo: SessionArchiveInfo['session'] = {
    id: data.id,
    agentId: data.agentId,
    kind: data.kind,
    month: session.month,
  };

  const archive = new JSZip();
  const archiveDir = archive.folder(data.id);
  if (!archiveDir) throw new Error('Failed to create session archive root.');

  await addDirectoryToZip(path.dirname(session.filesDir()), archiveDir);
  const info: SessionArchiveInfo = {
    version: 1,
    session: sessionInfo,
  };
  archiveDir.file('info.json', JSON.stringify(info, null, 2) + '\n');
  await writeArchive(archive, outputPath);
}

function destinationPath(destinationDir: string, root: string, entry: string): string {
  const prefix = `${root}/`;
  if (!entry.startsWith(prefix)) {
    throw new Error('Session archive contains entries outside its root directory.');
  }

  const relativePath = entry.slice(prefix.length);
  if (!relativePath) return destinationDir;

  const destination = path.resolve(destinationDir, relativePath);
  if (destination !== destinationDir && !destination.startsWith(destinationDir + path.sep)) {
    throw new Error(`Archive entry "${entry}" escapes the session directory.`);
  }
  return destination;
}

async function extractSessionArchive(
  archivePath: string,
  destinationDir: string,
): Promise<ImportedSessionArchive> {
  const archiveStats = await fsp.stat(archivePath);
  if (!archiveStats.isFile()) throw new Error('Session archive must be a file.');
  if (archiveStats.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Archive exceeds ${MAX_ARCHIVE_BYTES} byte size limit.`);
  }

  const archive = new StreamZip.async({ file: archivePath });
  try {
    const entries = Object.values(await archive.entries());
    assertArchiveLimits(entries);
    const root = archiveRoot(entries);
    const infoEntry = entries.find((entry) => entry.name === `${root}/info.json`);
    if (!infoEntry) throw new Error('Session archive is missing info.json.');
    if (infoEntry.size > MAX_METADATA_BYTES) {
      throw new Error(`Session archive info.json exceeds ${MAX_METADATA_BYTES} byte limit.`);
    }
    const dataEntry = entries.find((entry) => entry.name === `${root}/data.json`);
    if (!dataEntry) throw new Error('Session archive is missing data.json.');
    if (dataEntry.size > MAX_METADATA_BYTES) {
      throw new Error(`Session archive data.json exceeds ${MAX_METADATA_BYTES} byte limit.`);
    }

    const info: SessionArchiveInfo = JSON.parse((await archive.entryData(infoEntry)).toString('utf8'));
    const budget: ExtractionBudget = { totalBytes: 0 };
    await fsp.mkdir(destinationDir, { recursive: true });

    for (const entry of entries) {
      if (isMacosMetadata(entry.name) || entry.name === `${root}/info.json`) continue;
      const destination = destinationPath(destinationDir, root, entry.name);
      if (entry.isDirectory) {
        await fsp.mkdir(destination, { recursive: true });
        continue;
      }
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await pipeline(
        await archive.stream(entry),
        new ArchiveEntrySizeLimit(budget),
        fs.createWriteStream(destination, { flags: 'wx' }),
      );
    }

    const data = await readJsonOrNull<RegularSessionDataFile>(path.join(destinationDir, 'data.json'));
    if (!data) throw new Error('Session archive is missing data.json.');
    validateArchiveInfo(info, data, root);

    return { sessionDir: destinationDir, month: info.session.month, data };
  } finally {
    await archive.close();
  }
}

/**
 * 接管已解压的 regular session 目录。除了避免 ID 冲突及改写新 owner 所需的
 * data.json 字段外，messages、files、subruns 都通过一次 rename 原样迁移。
 */
async function moveImportedSessionDirectory(
  archive: ImportedSessionArchive,
  target: { profileId: string; agentId: string },
): Promise<{ sessionId: string }> {
  const sessionId = newEntityId('s');
  const data: RegularSessionDataFile = { ...archive.data, id: sessionId, agentId: target.agentId };
  const destination = PERSIST_PATH.sessionDir(
    getAppRoot(),
    target.profileId,
    target.agentId,
    archive.month,
    sessionId,
  );

  await writeJson(path.join(archive.sessionDir, 'data.json'), data);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.rename(archive.sessionDir, destination);

  const sessionIdx = new SessionIdx(target.profileId);
  try {
    sessionIdx.upsert({
      id: sessionId,
      agentId: target.agentId,
      month: archive.month,
      title: data.title,
      readStatus: data.readStatus,
      starredAt: data.star?.starredAt ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
    emit(target.profileId, 'session:updated', {
      agentId: target.agentId,
      sessionId,
      data,
    });
    return { sessionId };
  } catch (error) {
    sessionIdx.remove(sessionId);
    await removeDirIfExists(destination);
    throw error;
  }
}

/** 解压 ZIP、迁移完整 session 目录并同步索引的唯一导入入口。 */
export async function importSessionArchive(
  archivePath: string,
  target: { profileId: string; agentId: string },
): Promise<{ sourceSessionId: string; sessionId: string }> {
  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deskmate-session-import-'));
  try {
    const archive = await extractSessionArchive(archivePath, path.join(stagingDir, 'session'));
    const imported = await moveImportedSessionDirectory(archive, target);
    return { sourceSessionId: archive.data.id, sessionId: imported.sessionId };
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true });
  }
}
