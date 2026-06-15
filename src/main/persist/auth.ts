import type { LegacyAuthFile, PiAuthFile } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { getAppRoot } from './lib/root';
import { readJsonOrNull, removeFileIfExists, writeJson } from './lib/atomic';

/** auth.json：未登录时该文件不存在，data 为 undefined。 */
export class LegacyAuth {
  constructor(public readonly profileId: string) {}

  public data?: LegacyAuthFile;

  private file(): string {
    return PERSIST_PATH.authFile(getAppRoot(), this.profileId);
  }

  public async load(): Promise<void> {
    const value = await readJsonOrNull<LegacyAuthFile>(this.file());
    this.data = value ?? undefined;
  }

  public async write(payload: LegacyAuthFile): Promise<void> {
    await writeJson(this.file(), payload);
    this.data = payload;
  }

  public async clear(): Promise<void> {
    await removeFileIfExists(this.file());
    this.data = undefined;
  }

  public exists(): boolean {
    return this.data !== undefined;
  }
}

/** auth.pi.json，与 LegacyAuth 结构对称。 */
export class PiAuth {
  constructor(public readonly profileId: string) {}

  public data?: PiAuthFile;

  private file(): string {
    return PERSIST_PATH.piAuthFile(getAppRoot(), this.profileId);
  }

  public async load(): Promise<void> {
    const value = await readJsonOrNull<PiAuthFile>(this.file());
    this.data = value ?? undefined;
  }

  public async write(payload: PiAuthFile): Promise<void> {
    await writeJson(this.file(), payload);
    this.data = payload;
  }

  public async clear(): Promise<void> {
    await removeFileIfExists(this.file());
    this.data = undefined;
  }

  public exists(): boolean {
    return this.data !== undefined;
  }
}
