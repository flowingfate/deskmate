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

  /** name -> SkillRecord 的索引，便于快速查找。始终与 items 保持同步。 */
  public byName: { [name: string]: SkillRecord } = {};

  private indexFile(): string {
    return PERSIST_PATH.skillsIndex(getAppRoot(), this.profileId);
  }

  /** 依据当前 items 重建 byName 索引。 */
  private reindex(): void {
    this.byName = {};
    for (const s of this.items) this.byName[s.name] = s;
  }

  public async load(): Promise<void> {
    const file = await readJsonOrNull<SkillsIndexFile>(this.indexFile());
    this.items = file?.items ?? [];
    this.reindex();
  }

  protected async doPersist(): Promise<void> {
    await writeJson(this.indexFile(), this.toFile());
    emit(this.profileId, 'agent:registry:updated', {
      kind: 'skills',
      items: this.items,
    });
  }

  public get(name: string): SkillRecord | undefined {
    return this.byName[name];
  }

  public async upsert(skill: SkillRecord): Promise<void> {
    const previousItems = this.items;
    const previousByName = this.byName;
    const idx = previousItems.findIndex((item) => item.name === skill.name);
    this.items = idx >= 0
      ? previousItems.map((item, index) => (index === idx ? skill : item))
      : [...previousItems, skill];
    this.reindex();

    try {
      await this.persist();
    } catch (error) {
      this.items = previousItems;
      this.byName = previousByName;
      throw error;
    }
  }

  public async remove(name: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.name !== name);
    delete this.byName[name];
    await removeDirIfExists(skillDir(getAppRoot(), this.profileId, name));
    if (this.items.length === before) return;
    await this.persist();
  }

  /** 读取某个 skill 的 SKILL.md 原文。兼容外部 linked skill 的小写 skill.md。 */
  public async readMarkdown(name: string): Promise<string | undefined> {
    const root = getAppRoot();
    const canonical = await readTextOrNull(markdownPath(root, this.profileId, name));
    if (canonical !== null) return canonical;
    const lowercase = await readTextOrNull(`${skillDir(root, this.profileId, name)}/skill.md`);
    return lowercase ?? undefined;
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
    const onDisk = await listDirs(PERSIST_PATH.skillsDir(root, this.profileId), true);
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
    this.reindex();
    if (added.length || removed.length) await this.persist();
    return { added, removed };
  }

  private toFile(): SkillsIndexFile {
    return { version: 1, items: this.items };
  }
}
