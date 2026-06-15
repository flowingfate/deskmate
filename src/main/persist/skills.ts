import type { SkillRecord, SkillsIndexFile } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { PersistBase } from './lib/persistBase';
import {
  listDirs,
  readJsonOrNull,
  readTextOrNull,
  removeDirIfExists,
  writeJson,
  writeText,
} from './lib/atomic';

function markdownPath(root: string, profileId: string, name: string): string {
  return `${PERSIST_PATH.skillsDir(root, profileId)}/${name}/SKILL.md`;
}

function skillDir(root: string, profileId: string, name: string): string {
  return `${PERSIST_PATH.skillsDir(root, profileId)}/${name}`;
}

/** 对应 skills/skills.json + skills/{name}/SKILL.md。name 即稳定 id。 */
export class Skills extends PersistBase {
  constructor(public readonly profileId: string) {
    super();
  }

  public items: SkillRecord[] = [];

  private indexFile(): string {
    return PERSIST_PATH.skillsIndex(getAppRoot(), this.profileId);
  }

  public async load(): Promise<void> {
    const file = await readJsonOrNull<SkillsIndexFile>(this.indexFile());
    this.items = file?.items ?? [];
  }

  protected async doPersist(): Promise<void> {
    await writeJson(this.indexFile(), this.toFile());
    emit('agent:registry:updated', {
      profileId: this.profileId, kind: 'skills', items: this.items,
    });
  }

  public get(name: string): SkillRecord | undefined {
    return this.items.find((s) => s.name === name);
  }

  public async upsert(skill: SkillRecord): Promise<void> {
    const idx = this.items.findIndex((s) => s.name === skill.name);
    if (idx >= 0) this.items[idx] = skill;
    else this.items.push(skill);
    await this.persist();
  }

  public async remove(name: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.name !== name);
    await removeDirIfExists(skillDir(getAppRoot(), this.profileId, name));
    if (this.items.length === before) return;
    await this.persist();
  }

  /** 读取某个 skill 的 SKILL.md 原文。文件不存在返回 undefined。 */
  public async readMarkdown(name: string): Promise<string | undefined> {
    const raw = await readTextOrNull(markdownPath(getAppRoot(), this.profileId, name));
    return raw ?? undefined;
  }

  public async writeMarkdown(name: string, content: string): Promise<void> {
    await writeText(markdownPath(getAppRoot(), this.profileId, name), content);
  }

  /**
   * 扫描 skills/ 目录，把磁盘上存在但 skills.json 没记录的 skill 追加进来；
   * 把 skills.json 中记录但目录已不存在的 skill 剔除。返回变更摘要。
   */
  public async reconcile(): Promise<{ added: string[]; removed: string[] }> {
    const root = getAppRoot();
    const onDisk = await listDirs(PERSIST_PATH.skillsDir(root, this.profileId));
    const onDiskSet = new Set(onDisk);
    const recorded = new Set(this.items.map((s) => s.name));

    const removed = [...recorded].filter((n) => !onDiskSet.has(n));
    this.items = this.items.filter((s) => onDiskSet.has(s.name));

    const added: string[] = [];
    for (const name of onDisk) {
      if (recorded.has(name)) continue;
      this.items.push({ name, description: '', version: '0.0.0' });
      added.push(name);
    }
    if (added.length || removed.length) await this.persist();
    return { added, removed };
  }

  private toFile(): SkillsIndexFile {
    return { version: 1, items: this.items };
  }
}
