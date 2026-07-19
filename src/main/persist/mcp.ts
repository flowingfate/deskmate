import type { McpServerRecord, McpServersFile } from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { PersistBase } from './lib/persistBase';
import { readJsonOrNull, writeJson } from './lib/atomic';

/** 对应 mcp/mcp-servers.json —— profile 级共享的 MCP server 配置。 */
export class Mcp extends PersistBase {
  constructor(public readonly profileId: string) {
    super();
  }

  public items: McpServerRecord[] = [];

  private file(): string {
    return PERSIST_PATH.mcpServersFile(getAppRoot(), this.profileId);
  }

  public async load(): Promise<void> {
    const file = await readJsonOrNull<McpServersFile>(this.file());
    this.items = file?.items ?? [];
  }

  protected async doPersist(): Promise<void> {
    await writeJson(this.file(), this.toFile());
    emit(this.profileId, 'agent:registry:updated', {
      kind: 'mcp',
      items: this.items,
    });
  }

  public get(name: string): McpServerRecord | undefined {
    return this.items.find((s) => s.name === name);
  }

  public async upsert(server: McpServerRecord): Promise<void> {
    const idx = this.items.findIndex((s) => s.name === server.name);
    if (idx >= 0) this.items[idx] = server;
    else this.items.push(server);
    await this.persist();
  }

  public async remove(name: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.name !== name);
    if (this.items.length === before) return;
    await this.persist();
  }

  public toFile(): McpServersFile {
    return { version: 1, items: this.items };
  }
}
