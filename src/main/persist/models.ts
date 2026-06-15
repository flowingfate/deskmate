import type { ModelsCacheFile } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { getAppRoot } from './lib/root';
import { listFiles, readJsonOrNull, removeFileIfExists, writeJson } from './lib/atomic';

function providerFile(root: string, profileId: string, provider: string): string {
  return `${PERSIST_PATH.modelsDir(root, profileId)}/${provider}.json`;
}

/** 对应 models/{provider}.json —— 各 provider 的模型清单缓存。 */
export class Models {
  constructor(public readonly profileId: string) {}

  /** key 是 provider id，如 'github-copilot'。 */
  public providers: Map<string, ModelsCacheFile> = new Map();

  public async load(): Promise<void> {
    const root = getAppRoot();
    this.providers.clear();
    const files = await listFiles(PERSIST_PATH.modelsDir(root, this.profileId));
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const provider = f.slice(0, -'.json'.length);
      const data = await readJsonOrNull<ModelsCacheFile>(providerFile(root, this.profileId, provider));
      if (data) this.providers.set(provider, data);
    }
  }

  public get(provider: string): ModelsCacheFile | undefined {
    return this.providers.get(provider);
  }

  public async set(provider: string, data: Omit<ModelsCacheFile, 'version'>): Promise<void> {
    // version 由 store 统一注入；调用方只关心数据本身。
    const versioned: ModelsCacheFile = { version: 1, ...data };
    this.providers.set(provider, versioned);
    await writeJson(providerFile(getAppRoot(), this.profileId, provider), versioned);
  }

  public async remove(provider: string): Promise<void> {
    this.providers.delete(provider);
    await removeFileIfExists(providerFile(getAppRoot(), this.profileId, provider));
  }
}
