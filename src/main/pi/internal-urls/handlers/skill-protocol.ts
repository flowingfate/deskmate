/**
 * `skill://` —— 读 profile 下的 skill。
 *
 * URL 形态:
 * - `skill://{name}` —— 读 `${userData}/profiles/{pid}/skills/{name}/SKILL.md`
 * - `skill://{name}/SKILL.md` —— 显式 path,同上(冗余形态,容错)
 *
 * 设计取舍:
 * - **host = skill name**,直接走 `Skills.readMarkdown(name)` —— 这是 skill 的稳定
 *   id,大小写敏感(persist 层就这么落的),所以 router 解析保留 host 原文。
 * - **immutable: true** —— skill 文件是 agent 资产,`write skill://foo` 当前应被
 *   拒绝。后续真要让 LLM 写 skill,在 SkillProtocolHandler 上加 `write?` 钩子。
 * - **空 host 抛错** —— 没有"列出全部 skill"的语义(那是 `app skill list` 的事)。
 *   要列举请用 AppCommand,不要 `read skill://` 当 search。
 *
 * Profile 不存在 / skill 不存在的错误消息**对 LLM 友好**:
 * - 不暴露绝对路径(只说 "skill 'foo' not found")
 * - 不带 stack trace(router 会原样 surface 给 LLM 的 tool_result)
 */
import { Profile } from '@main/persist/profile';
import type {
  InternalResource,
  ParsedInternalUrl,
  ProtocolHandler,
  ResolveContext,
} from '../types';

export class SkillProtocolHandler implements ProtocolHandler {
  public readonly scheme = 'skill';
  public readonly immutable = true;

  public async resolve(
    url: ParsedInternalUrl,
    ctx: ResolveContext,
  ): Promise<InternalResource> {
    const name = url.host.trim();
    if (!name) {
      throw new Error(
        'skill:// requires a skill name (e.g. `skill://my-skill`). ' +
          'To browse available skills, use `app skill list`.',
      );
    }

    // 容错:`skill://foo/SKILL.md` / `skill://foo/` 都视为 `skill://foo`。
    // 其它任意 sub-path 拒绝 —— 当前 handler 只暴露 SKILL.md 主文档,要读 skill
    // 目录下的其它文件请走文件系统路径。
    const path = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (path !== '' && path.toUpperCase() !== 'SKILL.MD') {
      throw new Error(
        `skill:// only exposes SKILL.md (got path "${path}"). ` +
          'For other files in a skill directory, use the filesystem path.',
      );
    }

    const profile = await Profile.getOrLoad(ctx.profileId);
    const content = await profile.skills.readMarkdown(name);
    if (content === undefined) {
      throw new Error(`Skill "${name}" not found in current profile.`);
    }

    return {
      url: `skill://${name}`,
      content,
      contentType: 'text/markdown',
      size: Buffer.byteLength(content, 'utf-8'),
      // sourcePath 仅供日志 —— 不进 LLM 可见 content。
      sourcePath: undefined,
      notes: [`Loaded skill "${name}" (${content.length} chars).`],
    };
  }
}
