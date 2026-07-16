/**
 * `skill://` —— 读 profile 下 skill 目录内的文件。
 *
 * URL 形态:
 * - `skill://{name}` —— 读 SKILL.md 主文档(裸 name 的默认落点)
 * - `skill://{name}/SKILL.md` —— 显式 path,同上
 * - `skill://{name}/scripts/foo.py` —— 读 skill 目录内**任意子文件**
 *   (脚本源码 / REFERENCE.md / FORMS.md 等)
 *
 * 设计取舍:
 * - **host = skill name**,是 skill 的稳定 id,大小写敏感(persist 层就这么落的),
 *   所以 router 解析保留 host 原文。
 * - **裸 name → SKILL.md**:progressive disclosure 的入口文档;子路径 → 目录内文件,
 *   让 SKILL.md 里用相对路径引用的脚本/资源(`scripts/foo.py`)能 1:1 映射成
 *   `skill://{name}/scripts/foo.py` 被读取。相对路径的 base 天然就是 skill name。
 * - **immutable: true** —— skill 文件是 agent 资产,`write skill://foo` 应被拒。
 *   本 handler 不实现 `write?`,router 在写侧抛 read-only。
 * - **绑定授权**：`resolve` 与 `resolveToPath` 均要求 execution Agent 的 bindings
 *   map 含该 skill，未绑定的 skill 不能被 LLM 读取或执行。
 * - **`resolveToPath` 实现**:skill 文件需要被 shell 执行(`python <abs>`)，故有意
 *   翻译为绝对路径；裸 name 指向 SKILL.md **文件**(非目录)，避免 dispatch 的
 *   filesystem 分支撞上 EISDIR。
 * - **路径 containment**：`..` 词法检查与 deepest-existing realpath 检查共同拒绝
 *   `skill://foo/../../etc/passwd` 及 linked skill 的内层 symlink 逃逸。
 *
 * Skill / 文件不存在的错误消息**对 LLM 友好**:不暴露绝对路径、不带 stack trace。
 */
import * as fsp from 'node:fs/promises';
import * as nodePath from 'node:path';

import { PERSIST_PATH } from '@shared/persist/path';
import { boundSkillNames } from '@shared/types/profileTypes';
import { getAppRoot } from '@main/persist/lib/root';
import { Profile } from '@main/persist/profile';
import { executorId } from '../../tools/types';
import {
  ResourceNotFoundError,
  type InternalResource,
  type ParsedInternalUrl,
  type ProtocolHandler,
  type ResolveContext,
} from '../types';

/** 1MB —— text resource 上限,与 sandbox handler 对齐。 */
const MAX_RESOURCE_BYTES = 1 * 1024 * 1024;

export class SkillProtocolHandler implements ProtocolHandler {
  public readonly scheme = 'skill';
  public readonly immutable = true;

  public async resolve(
    url: ParsedInternalUrl,
    ctx: ResolveContext,
  ): Promise<InternalResource> {
    const { name, relPath } = this.parse(url);
    await this.assertSkillEnabled(name, ctx);

    const isMainDoc = relPath === '' || relPath.toUpperCase() === 'SKILL.MD';
    if (isMainDoc) {
      const absPath = await this.toMainDocPath(name, ctx);
      return this.readTextFile(name, 'SKILL.md', absPath, true);
    }

    const absPath = await this.toAbsPath(name, relPath, ctx);
    return this.readTextFile(name, relPath, absPath, false);
  }

  /**
   * Renderer / shell 用的路径解析:URI → 绝对路径(不读 I/O)。
   * 裸 name → SKILL.md 文件(非目录),子路径 → 目录内文件。
   * skill 是 curated 资产,**有意**外泄绝对路径(需被 shell 执行 / fs IPC 消费)。
   */
  public async resolveToPath(
    url: ParsedInternalUrl,
    ctx: ResolveContext,
  ): Promise<string> {
    const { name, relPath } = this.parse(url);
    await this.assertSkillEnabled(name, ctx);
    if (relPath === '') {
      return this.toMainDocPath(name, ctx);
    }
    return this.toAbsPath(name, relPath, ctx);
  }

  private async assertSkillEnabled(name: string, ctx: ResolveContext): Promise<void> {
    const profile = await Profile.getOrLoad(ctx.profileId);
    const agent = await profile.getAgent(executorId(ctx));
    if (!agent || !boundSkillNames(agent.config.skills).includes(name)) {
      throw new ResourceNotFoundError(
        `Skill "${name}" is not enabled for the current agent.`,
      );
    }
  }

  private async readTextFile(
    name: string,
    relPath: string,
    absPath: string,
    isMainDoc: boolean,
  ): Promise<InternalResource> {
    const url = isMainDoc ? `skill://${name}` : `skill://${name}/${relPath}`;
    const stat = await fsp.stat(absPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        if (isMainDoc) {
          throw new ResourceNotFoundError(`Skill "${name}" not found in current profile.`);
        }
        throw new ResourceNotFoundError(`${url} not found.`);
      }
      throw err;
    });
    if (stat.isDirectory()) {
      throw new Error(`${url} is a directory, not a file. Reading skill directories is not supported.`);
    }
    if (stat.size > MAX_RESOURCE_BYTES) {
      throw new Error(
        `${url} exceeds ${MAX_RESOURCE_BYTES} byte limit (file is ${stat.size} bytes).`,
      );
    }
    const buf = await fsp.readFile(absPath);
    if (containsNul(buf)) {
      throw new Error(`${url} appears to be binary; only text files are exposed via skill://.`);
    }
    const content = buf.toString('utf-8');
    return {
      url,
      content,
      contentType: isMainDoc ? 'text/markdown' : classifyContentType(relPath),
      size: stat.size,
      sourcePath: undefined,
      notes: isMainDoc
        ? [`Loaded skill "${name}" (${content.length} chars).`]
        : [`Loaded skill file "${name}/${relPath}" (${content.length} chars).`],
    };
  }

  /**
   * 解析 url → { name, relPath }。空 name 抛友好错误;name 是 LLM 可控输入,
   * 在此**唯一入口**做词法校验 —— `.` / `..` / 含路径分隔符一律拒,挡住
   * `skill://../auth.json` 之类穿越(readMarkdown 分支不走 toAbsPath,必须在这里堵)。
   */
  private parse(url: ParsedInternalUrl): { name: string; relPath: string } {
    const name = url.host.trim();
    if (!name) {
      throw new Error(
        'skill:// requires a skill name (e.g. `skill://my-skill`). ' +
          'To browse available skills, use `app skill list`.',
      );
    }
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      throw new Error(`Invalid skill name "${name}" (must be a single path segment).`);
    }
    // rawPathname 保留 `..` / 重复 `/`,交给 toAbsPath 的边界检查兜底。
    const relPath = url.rawPathname.replace(/^\/+/, '').replace(/\/+$/, '');
    return { name, relPath };
  }

  /**
   * `{name}` + `{relPath}` → 绝对路径,做**两层** `..` 逃逸防护:
   *
   * 1. `name`(host,LLM 可控)必须恰好是 skills 根目录下的一级子目录 —— 否则
   *    `skill://../auth.json`(name=`..`)会把基准拉出 skills 目录读到 profile
   *    的认证文件。**不能**先把未净化的 name 拼进 base 再检查,那样 base 自己
   *    就被 `..` 拉走了。这里用 `dirname(skillDir) === skillsRoot` 卡死。
   * 2. `relPath` 必须落在该 skill 目录内(挡 `skill://pdf/../../etc/passwd`)。
   */
  private async toMainDocPath(
    name: string,
    ctx: ResolveContext,
  ): Promise<string> {
    const canonical = await this.toAbsPath(name, 'SKILL.md', ctx);
    try {
      await fsp.access(canonical);
      return canonical;
    } catch {
      return this.toAbsPath(name, 'skill.md', ctx);
    }
  }

  private async toAbsPath(
    name: string,
    relPath: string,
    ctx: ResolveContext,
  ): Promise<string> {
    const skillsRoot = nodePath.resolve(
      PERSIST_PATH.skillsDir(getAppRoot(), ctx.profileId),
    );
    const skillDir = nodePath.resolve(skillsRoot, name);
    if (nodePath.dirname(skillDir) !== skillsRoot) {
      throw new Error(`Invalid skill name "${name}" (must be a single path segment).`);
    }
    const resolved = nodePath.resolve(skillDir, relPath);
    if (resolved !== skillDir && !resolved.startsWith(skillDir + nodePath.sep)) {
      throw new Error(`Path "${relPath}" escapes the skill:// directory.`);
    }
    // 词法检查只挡 `..`。linked skill 的根是指向外部第三方目录的 symlink,其内容
    // live 可变;若外部目录里藏一个内层 symlink(`evil -> ~/.ssh/id_rsa`),词法上
    // `skill://foo/evil` 仍在 skill 目录内,但 readFile 会跟随它读到目录外机密。
    // 故追加真实路径 containment:把 skill 根 realpath 出来(**跟随根链接是预期的**,
    // 它就是这个 skill 的真实边界),再要求目标的 realpath 落在该根内。deepest-existing
    // 前缀解析 → 内层 symlink(文件或中间目录)一旦逃出根即拒。TOCTOU 窗口仍在
    // (校验后文件可能被换成链接),但读取侧校验完立即 readFile,窗口极小;这是对
    // 第三方 live 目录能做的最强本地防护。copy 模式的内层 symlink 也一并挡住。
    const realRoot = await fsp.realpath(skillDir).catch(() => null);
    if (realRoot !== null) {
      const realTarget = await this.realpathDeepest(resolved);
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + nodePath.sep)) {
        throw new Error(`Path "${relPath}" escapes the skill:// directory.`);
      }
    }
    return resolved;
  }

  /**
   * 解析 `target` 的真实路径:对已存在的最深前缀跟随 symlink(realpath),再把尚不
   * 存在的尾段原样拼回。用于在文件可能尚未存在时仍能做 containment 校验 —— 不存在的
   * 叶子无法泄漏,存在的叶子/中间目录若是逃逸链接则被 realpath 暴露。
   */
  private async realpathDeepest(target: string): Promise<string> {
    let current = target;
    const suffix: string[] = [];
    for (;;) {
      try {
        const real = await fsp.realpath(current);
        return suffix.length ? nodePath.join(real, ...suffix.reverse()) : real;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        const parent = nodePath.dirname(current);
        if (parent === current) return target;
        suffix.push(nodePath.basename(current));
        current = parent;
      }
    }
  }
}

/** 用前 8KB 检测 NUL byte —— 经典 binary 判别启发式。 */
function containsNul(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  return probe.includes(0);
}

function classifyContentType(
  relPath: string,
): 'text/markdown' | 'application/json' | 'text/plain' {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  return 'text/plain';
}
