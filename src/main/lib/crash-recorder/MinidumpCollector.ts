import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IncidentCorrelator } from './IncidentCorrelator';
import type { DiagnosticsStore } from './DiagnosticsStore';
import type { MinidumpArtifact } from './types';
import { safeStderr } from './safeStderr';

const MAX_DEPTH = 3;
const MAX_DUMP_BYTES = 256 * 1024 * 1024;
const MAX_DIAGNOSTICS_BYTES = 512 * 1024 * 1024;
const MAX_RAW_BYTES = 256 * 1024 * 1024;
const RAW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STABILITY_DELAY_MS = 250;

export interface MinidumpCandidate {
  filePath: string;
  sizeBytes: number;
  modifiedAt: number;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function treeBytes(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    try {
      const stats = fs.lstatSync(entryPath);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) total += treeBytes(entryPath);
      else if (stats.isFile()) total += stats.size;
    } catch {
      // 文件可能在扫描时被 Crashpad 移动。
    }
  }
  return total;
}

export interface MinidumpCollectorOptions {
  collectionWindowMs?: number;
  scanIntervalMs?: number;
}

interface CachedHash {
  sizeBytes: number;
  modifiedAt: number;
  hash: string;
}

export class MinidumpCollector {
  private collecting: Promise<void> | null = null;
  private scanUntil = 0;
  private scanLifeId: number | null = null;
  private cleanupRequested = false;
  private stopped = false;
  private readonly preferredLifeByPath = new Map<string, number>();
  private readonly hashCache = new Map<string, CachedHash>();
  private readonly collectionWindowMs: number;
  private readonly scanIntervalMs: number;

  public constructor(
    private readonly crashpadRoot: string,
    private readonly artifactDirectory: string,
    private readonly store: DiagnosticsStore,
    private readonly correlator: IncidentCorrelator,
    options: MinidumpCollectorOptions = {},
  ) {
    this.collectionWindowMs = options.collectionWindowMs ?? 10_000;
    this.scanIntervalMs = options.scanIntervalMs ?? STABILITY_DELAY_MS;
    fs.mkdirSync(this.crashpadRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.artifactDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.artifactDirectory, 0o700);
  }

  public discoverCandidates(): MinidumpCandidate[] {
    let rootReal: string;
    try {
      rootReal = fs.realpathSync(this.crashpadRoot);
    } catch {
      return [];
    }
    const candidates: MinidumpCandidate[] = [];
    const visit = (directory: string, depth: number): void => {
      if (depth > MAX_DEPTH) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const candidatePath = path.join(directory, entry.name);
        let stats: fs.Stats;
        try {
          stats = fs.lstatSync(candidatePath);
        } catch {
          continue;
        }
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) {
          visit(candidatePath, depth + 1);
          continue;
        }
        if (!stats.isFile() || path.extname(entry.name).toLowerCase() !== '.dmp') continue;
        let real: string;
        try {
          real = fs.realpathSync(candidatePath);
        } catch {
          continue;
        }
        if (!isInside(rootReal, real)) continue;
        if (stats.size <= 0 || stats.size > MAX_DUMP_BYTES) continue;
        candidates.push({ filePath: candidatePath, sizeBytes: stats.size, modifiedAt: stats.mtimeMs });
      }
    };
    visit(this.crashpadRoot, 0);
    return candidates;
  }

  public associateCandidatesWithLife(candidates: MinidumpCandidate[], lifeId: number): void {
    for (const candidate of candidates) this.preferredLifeByPath.set(candidate.filePath, lifeId);
  }

  public collectSoon(preferredLifeId: number | null = null): void {
    if (this.stopped) return;
    this.scanUntil = Math.max(this.scanUntil, Date.now() + this.collectionWindowMs);
    if (preferredLifeId !== null) this.scanLifeId = preferredLifeId;
    if (this.collecting) return;
    this.collecting = this.collectUntilSettled()
      .catch((error) => safeStderr('minidump-collect', `Minidump collection failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        this.collecting = null;
        this.scanLifeId = null;
        if (this.cleanupRequested && !this.stopped) {
          this.cleanupRequested = false;
          this.cleanupArtifacts();
        }
      });
  }

  public async waitForIdle(): Promise<void> {
    await this.collecting;
  }

  public stop(): void {
    this.stopped = true;
    this.scanUntil = 0;
  }

  public async collect(preferredLifeId: number | null = null): Promise<void> {
    const candidates = this.discoverCandidates();
    for (const candidate of candidates) {
      await this.ingest(candidate, this.preferredLifeByPath.get(candidate.filePath) ?? preferredLifeId);
    }
  }

  public cleanup(): void {
    if (this.collecting) {
      this.cleanupRequested = true;
      return;
    }
    this.cleanupArtifacts();
  }

  private async collectUntilSettled(): Promise<void> {
    do {
      await this.collect(this.scanLifeId);
      if (this.stopped || Date.now() >= this.scanUntil) break;
      await new Promise<void>((resolve) => setTimeout(resolve, this.scanIntervalMs));
    } while (!this.stopped && Date.now() <= this.scanUntil);
    if (this.stopped) return;
    this.cleanupRawDumps();
  }

  private cleanupArtifacts(): void {
    const referenced = this.store.referencedArtifactHashes();
    if (fs.existsSync(this.artifactDirectory)) {
      for (const entry of fs.readdirSync(this.artifactDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.dmp') continue;
        const hash = path.basename(entry.name, path.extname(entry.name));
        if (!referenced.has(hash)) {
          try {
            fs.unlinkSync(path.join(this.artifactDirectory, entry.name));
          } catch {
            // 下次 retention 重试。
          }
        }
      }
    }
    this.cleanupRawDumps();
  }

  private async ingest(candidate: MinidumpCandidate, preferredLifeId: number | null): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, STABILITY_DELAY_MS));
    if (this.stopped) return;
    let stable: fs.Stats;
    let stableRealPath: string;
    let rootRealPath: string;
    try {
      stable = await fs.promises.lstat(candidate.filePath);
      stableRealPath = await fs.promises.realpath(candidate.filePath);
      rootRealPath = await fs.promises.realpath(this.crashpadRoot);
    } catch {
      return;
    }
    if (
      stable.isSymbolicLink()
      || !stable.isFile()
      || !isInside(rootRealPath, stableRealPath)
      || stable.size !== candidate.sizeBytes
      || stable.mtimeMs !== candidate.modifiedAt
    ) return;

    const cached = this.hashCache.get(candidate.filePath);
    const hash = cached && cached.sizeBytes === candidate.sizeBytes && cached.modifiedAt === candidate.modifiedAt
      ? cached.hash
      : await sha256(candidate.filePath);
    this.hashCache.set(candidate.filePath, {
      sizeBytes: candidate.sizeBytes,
      modifiedAt: candidate.modifiedAt,
      hash,
    });

    const incidentId = preferredLifeId === null
      ? null
      : this.correlator.resolveArtifactTarget(candidate.modifiedAt, preferredLifeId);
    if (!incidentId) return;

    const destination = path.join(this.artifactDirectory, `${hash}.dmp`);
    const destinationExists = fs.existsSync(destination);
    const projected = treeBytes(path.dirname(this.artifactDirectory)) + (destinationExists ? 0 : candidate.sizeBytes);
    if (projected > MAX_DIAGNOSTICS_BYTES) {
      const rejected: MinidumpArtifact = {
        hash,
        sizeBytes: candidate.sizeBytes,
        primary: false,
        state: 'rejected_quota',
        discoveredAt: Date.now(),
      };
      this.correlator.attachArtifact(incidentId, rejected);
      this.cleanupRawDumps();
      return;
    }

    let copied = false;
    if (!destinationExists) {
      await fs.promises.copyFile(candidate.filePath, destination, fs.constants.COPYFILE_FICLONE);
      copied = true;
      await fs.promises.chmod(destination, 0o600);
      const copiedHash = await sha256(destination);
      if (copiedHash !== hash) {
        await fs.promises.unlink(destination).catch(() => undefined);
        throw new Error('Copied minidump failed SHA-256 verification.');
      }
    }

    const artifact: MinidumpArtifact = {
      hash,
      sizeBytes: candidate.sizeBytes,
      primary: false,
      state: 'stored',
      discoveredAt: Date.now(),
    };
    if (this.stopped) {
      if (copied) await fs.promises.unlink(destination).catch(() => undefined);
      return;
    }
    const attachedIncidentId = this.correlator.attachArtifact(incidentId, artifact);
    if (!attachedIncidentId) {
      if (copied) await fs.promises.unlink(destination).catch(() => undefined);
      return;
    }

    await fs.promises.unlink(candidate.filePath).catch(() => undefined);
    this.preferredLifeByPath.delete(candidate.filePath);
    this.hashCache.delete(candidate.filePath);
  }


  private cleanupRawDumps(): void {
    const candidates = this.discoverCandidates().sort((left, right) => left.modifiedAt - right.modifiedAt);
    let total = candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
    let diagnosticsBytes = treeBytes(path.dirname(this.artifactDirectory));
    const cutoff = Date.now() - RAW_MAX_AGE_MS;
    for (const candidate of candidates) {
      if (candidate.modifiedAt >= cutoff && total <= MAX_RAW_BYTES && diagnosticsBytes <= MAX_DIAGNOSTICS_BYTES) continue;
      try {
        fs.unlinkSync(candidate.filePath);
        this.preferredLifeByPath.delete(candidate.filePath);
        this.hashCache.delete(candidate.filePath);
        total -= candidate.sizeBytes;
        diagnosticsBytes -= candidate.sizeBytes;
      } catch {
        // Crashpad 仍持有文件时留待下次。
      }
    }
  }
}
