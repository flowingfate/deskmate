/**
 * `parseCmdline` 单测 —— 也是 vendored `argsTokenizer` 0.3.0 + 我们 [M1]
 * 改动的契约文档。这套测试是 vendor 的"质量底"——任何上游 diff 想拉过来,
 * 必须先过本文件;我们的 [M1] 改动想撤,必须先改本文件的"单引号"段。
 *
 * 测点覆盖每条分支:
 *   - 空 / 纯空白 / 多空白
 *   - 普通 token / 多个 token
 *   - 双引号(包含空格、`\"` 转义、`\\` 转义、其它 `\X` 跟上游静默吞 `\`)
 *   - 单引号([M1] POSIX 严格:内部一切字面,包括 `\` 与 `"`)
 *   - 引号外反斜杠转义(`\ ` 保留空格作为 token 字符;尾孤立 `\` 静默吞)
 *   - 错误:未闭合引号 throw → wrapper 收敛成 `{ ok: false }`
 *   - 不识别的 shell 字符(`|` / `>` / `;` / `$`)按字面 token 出来,不当
 *     语法处理(LLM 在 `app(...)` 里写 pipe 是 bug,我们就让它表现出来)
 */

import { describe, it, expect } from 'vitest';

import { parseCmdline } from '../parseCmdline';

function ok(cmdline: string): string[] {
  const r = parseCmdline(cmdline);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.argv;
}

function err(cmdline: string): string {
  const r = parseCmdline(cmdline);
  if (r.ok) throw new Error(`expected error, got argv: ${JSON.stringify(r.argv)}`);
  return r.error;
}

describe('parseCmdline', () => {
  describe('空白处理', () => {
    it('空串返回空 argv', () => {
      expect(ok('')).toEqual([]);
    });
    it('纯空白返回空 argv', () => {
      expect(ok('   \t  \n ')).toEqual([]);
    });
    it('多空白被压缩,不产生空 token', () => {
      expect(ok('a    b\t\tc')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('普通 token', () => {
    it('单个 token', () => {
      expect(ok('hello')).toEqual(['hello']);
    });
    it('多个 token', () => {
      expect(ok('mcp install brave-search')).toEqual(['mcp', 'install', 'brave-search']);
    });
    it('flag 形态原样保留', () => {
      expect(ok('--env KEY=value')).toEqual(['--env', 'KEY=value']);
    });
  });

  describe('双引号', () => {
    it('引号内空格保留为单 token', () => {
      expect(ok('echo "hello world"')).toEqual(['echo', 'hello world']);
    });
    it('双引号支持 \\" 转义', () => {
      expect(ok('echo "say \\"hi\\""')).toEqual(['echo', 'say "hi"']);
    });
    it('双引号支持 \\\\ 转义', () => {
      expect(ok('echo "back\\\\slash"')).toEqual(['echo', 'back\\slash']);
    });
    it('双引号内 \\X(X 不是 " / \\)— 静默吞掉 `\\`(跟上游零偏差)', () => {
      // POSIX 严格说该保留 `\`(`echo "foo\nbar"` 在 bash 里是 `foo\nbar`),
      // 但上游 args-tokenizer 选择吞 `\`。我们**故意**不在 wrapper 里纠正
      // 这个 —— LLM 几乎不会写 `"foo\nbar"` 这种依赖差异的形态,而保留与
      // 上游零偏差让 vendor 的 diff 比对永远简单。
      // 真正用得到的两条转义(`\"` / `\\`)上面已经有专门测试覆盖。
      expect(ok('echo "foo\\nbar"')).toEqual(['echo', 'foonbar']);
    });
    it('紧贴的引号 + 字面拼接成同一 token', () => {
      expect(ok('prefix"with space"suffix')).toEqual(['prefixwith spacesuffix']);
    });
  });

  describe('单引号', () => {
    it('[M1] 单引号内一切字面,包括反斜杠(POSIX 严格,vendor 改了上游)', () => {
      // 上游 0.3.0 会吃掉 `\` → `["echo","ab\"c"]`,这导致 LLM 后续推理
      // 与现实漂移。我们的 [M1] 改动让 `\` 在单引号内当字面保留。
      // 详细理由见 `vendor/argsTokenizer.ts` 模块头 "Modifications" 段。
      expect(ok("echo 'a\\b\"c'")).toEqual(['echo', 'a\\b"c']);
    });
    it('单引号内空格保留', () => {
      expect(ok("echo 'hello world'")).toEqual(['echo', 'hello world']);
    });
  });

  describe('引号外的反斜杠', () => {
    it('\\ 加空格 → 空格成为 token 字符', () => {
      expect(ok('path/with\\ space.txt')).toEqual(['path/with space.txt']);
    });
    it('\\ 加引号 → 引号成为字面字符,不进入引号状态', () => {
      expect(ok('echo \\"raw\\"')).toEqual(['echo', '"raw"']);
    });
  });

  describe('错误', () => {
    // vendored tokenizer 只 throw 一种消息;wrapper 把它收敛成
    // `{ ok: false, error: <upstream message> }`。
    const UNCLOSED = /Closing quote is missing/;

    it('未闭合的双引号 → err', () => {
      expect(err('echo "unterminated')).toMatch(UNCLOSED);
    });
    it('未闭合的单引号 → err', () => {
      expect(err("echo 'unterminated")).toMatch(UNCLOSED);
    });
    it('孤立尾反斜杠(引号外)→ 静默吞,**不**报错(跟上游零偏差)', () => {
      // 顶层 app.ts 已经松散兜底,孤立 `\` 最坏只是 argv 少一个字符。
      // 我们刻意保留与上游一致的"静默"行为以最小化 vendor diff。
      const r = parseCmdline('foo \\');
      expect(r.ok).toBe(true);
      // 注意:`foo \\` 在 vendored 里 `\\` 把 EOS 标记当下一个字符吃,
      // 然后 `escaped` 没机会消费 → currentToken 始终是 'foo',结果 ["foo"]。
      // 我们只锁"不报错 + 不丢前缀",具体末尾形态由上游定。
      if (r.ok) expect(r.argv).toEqual(['foo']);
    });
    it('孤立尾反斜杠(双引号内)→ 报"未闭合引号"(quote 也未闭)', () => {
      // 双引号内的尾 `\` 同时触发"escape 没消费"和"引号未闭合"两个状态,
      // vendored throw 时报后者(因为 throw 检查 openningQuote)。
      expect(err('"foo \\')).toMatch(UNCLOSED);
    });
  });

  describe('未支持的 shell 字符按字面处理', () => {
    it('| / > / ; / $ 等不被识别为语法,作为 token 字符出来', () => {
      // 设计意图:LLM 在 app(...) 里写 pipe / redirect 是 bug,tokenizer
      // 不假装支持。AppCommand 看到这种 token 自己 react。
      expect(ok('foo | bar > baz; qux $var')).toEqual(['foo', '|', 'bar', '>', 'baz;', 'qux', '$var']);
    });
  });
});
