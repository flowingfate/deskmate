/**
 * AppCommand 共享的最小 flag 解析器。
 *
 * 目标:覆盖 LLM 实际会写的 90% shell 风格,**不**支持别名链 / 短 flag
 * 串联 / `--no-foo` 自动否定等高级特性 —— 不是不能做,而是 LLM 在
 * `app("...")` 里**不会**那样写,做了纯负载。
 *
 * 支持的形态:
 *   - `--foo bar`        → flag "foo" = "bar"
 *   - `--foo=bar`        → 同上
 *   - `--foo`            → flag "foo" = true(boolean flag)
 *   - `-y`               → flag "y" = true
 *   - `--env KEY=v` ×N   → repeatable string flag,collected 成 string[]
 *
 * **不**支持:
 *   - `-abc` 不会拆成 `-a -b -c`(LLM 不写这种,人写也不该写)
 *   - `--no-foo` 不会自动设 foo=false(需要 flag 显式声明 negatable)
 *   - 配置文件 / 环境变量 / 默认值合并(那是 yargs/commander 的事)
 *
 * 结果:`{ flags, positional }`。caller 自己用 spec 校验,本 helper
 * 不做 schema 验证 —— 那是 AppCommand 自己的职责。
 */

/** flag 声明 —— AppCommand 解析 argv 前先描述 expected flag。 */
export interface FlagSpec {
  /** flag 名(不带 `--`),例如 "env"、"yes"。 */
  readonly name: string;
  /** 单字母 alias,例如 "yes" 的 alias "y"。可选。 */
  readonly alias?: string;
  /**
   * flag 类型:
   *   - 'boolean':无值,出现即 true
   *   - 'string':要值,出现一次 → string;出现多次 → 取最后一次
   *   - 'array':要值,可重复,最终是 string[](即使只出现一次)
   */
  readonly type: 'boolean' | 'string' | 'array';
}

export interface ParseFlagsOk {
  readonly ok: true;
  /** 名字键固定为 spec.name(不是 alias)。boolean 缺席 → 不出现在对象里。 */
  readonly flags: Readonly<Record<string, string | boolean | readonly string[]>>;
  /** 非 flag 的纯位置参数。 */
  readonly positional: readonly string[];
}

export interface ParseFlagsErr {
  readonly ok: false;
  readonly error: string;
}

export type ParseFlagsResult = ParseFlagsOk | ParseFlagsErr;

/**
 * `--` 终止解析:之后全部 token 进 positional,即便长得像 flag。与
 * shell 完全一致语义,LLM 偶尔会用(`app("foo bar -- --weird-arg")`)。
 */
const TERMINATOR = '--';

export function parseFlags(argv: readonly string[], specs: readonly FlagSpec[]): ParseFlagsResult {
  // 索引:支持按 "--name" / "-alias" 两种形态 O(1) 查 spec
  const byLong = new Map<string, FlagSpec>();
  const byShort = new Map<string, FlagSpec>();
  for (const s of specs) {
    if (byLong.has(s.name)) return { ok: false, error: `flag spec duplicate: ${s.name}` };
    byLong.set(s.name, s);
    if (s.alias) {
      if (byShort.has(s.alias)) return { ok: false, error: `flag alias duplicate: -${s.alias}` };
      byShort.set(s.alias, s);
    }
  }

  const flags: Record<string, string | boolean | string[]> = {};
  const positional: string[] = [];
  let terminated = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    if (terminated) {
      positional.push(tok);
      continue;
    }
    if (tok === TERMINATOR) {
      terminated = true;
      continue;
    }

    // 解析 --name / --name=val / -a 三形态
    let spec: FlagSpec | undefined;
    let inlineValue: string | undefined; // `--foo=bar` 里的 `bar`
    let flagToken: string; // 原始拼写,用于错误信息

    if (tok.startsWith('--')) {
      const body = tok.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        const name = body.slice(0, eq);
        inlineValue = body.slice(eq + 1);
        spec = byLong.get(name);
        flagToken = `--${name}`;
      } else {
        spec = byLong.get(body);
        flagToken = tok;
      }
    } else if (tok === '-') {
      // 裸 `-` 现实里常表示 stdin/stdout,走 positional。
      positional.push(tok);
      continue;
    } else if (tok.startsWith('-')) {
      // 任何以 `-` 开头的 token 都被当作 flag 意图:不识别就报错,
      // 不能静默 fallback 成 positional —— LLM 写 `-abc` 时永远不是
      // "我想传字面 -abc 给 positional",必须立刻 surface 问题。
      if (tok.length === 2) {
        spec = byShort.get(tok.slice(1));
      }
      // length !== 2 → 直接落到下面 `!spec` 报 unknown flag
      flagToken = tok;
    } else {
      positional.push(tok);
      continue;
    }

    if (!spec) {
      return { ok: false, error: `unknown flag: ${flagToken}` };
    }

    // boolean:不吃值,inline value 视为错误(LLM 写 `--yes=true` 是 anti-pattern)
    if (spec.type === 'boolean') {
      if (inlineValue !== undefined) {
        return { ok: false, error: `${flagToken} is a boolean flag, does not take a value` };
      }
      flags[spec.name] = true;
      continue;
    }

    // string / array:取值
    let value: string;
    if (inlineValue !== undefined) {
      value = inlineValue;
    } else {
      const next = argv[i + 1];
      if (next === undefined || next === TERMINATOR) {
        return { ok: false, error: `${flagToken} requires a value` };
      }
      value = next;
      i++; // 吃掉下一个 token
    }

    if (spec.type === 'array') {
      const existing = flags[spec.name];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        flags[spec.name] = [value];
      }
    } else {
      // string:重复出现 → 取最后(与 GNU 风格一致)
      flags[spec.name] = value;
    }
  }

  return { ok: true, flags, positional };
}
