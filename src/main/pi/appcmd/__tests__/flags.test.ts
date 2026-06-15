/**
 * `parseFlags` 单测。
 *
 * 测点:
 *   - 三种 flag type(boolean / string / array)的解析
 *   - `--foo bar` / `--foo=bar` 两种形态
 *   - 短 flag alias(`-y`)
 *   - 重复 string flag 取最后,重复 array flag 收集成 string[]
 *   - 位置参数与 flag 混合,顺序无关
 *   - `--` 终止 flag 解析
 *   - 错误:未知 flag / boolean 不能带值 / string 缺值
 *   - 重名 / 重 alias 在 spec 阶段就报错(programmer error,fail fast)
 */

import { describe, it, expect } from 'vitest';

import { parseFlags } from '../flags';
import type { FlagSpec } from '../flags';

function ok(argv: string[], specs: FlagSpec[]) {
  const r = parseFlags(argv, specs);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return { flags: r.flags, positional: [...r.positional] };
}

function err(argv: string[], specs: FlagSpec[]): string {
  const r = parseFlags(argv, specs);
  if (r.ok) throw new Error(`expected error, got: ${JSON.stringify(r)}`);
  return r.error;
}

const COMMON_SPECS: FlagSpec[] = [
  { name: 'yes', alias: 'y', type: 'boolean' },
  { name: 'name', type: 'string' },
  { name: 'env', type: 'array' },
];

describe('parseFlags', () => {
  it('空 argv → 空 flags + 空 positional', () => {
    expect(ok([], COMMON_SPECS)).toEqual({ flags: {}, positional: [] });
  });

  describe('boolean flag', () => {
    it('出现即 true', () => {
      expect(ok(['--yes'], COMMON_SPECS).flags).toEqual({ yes: true });
    });
    it('短 alias 同语义', () => {
      expect(ok(['-y'], COMMON_SPECS).flags).toEqual({ yes: true });
    });
    it('缺席 → 不出现在 flags 对象里(不强制 false)', () => {
      expect(ok([], COMMON_SPECS).flags).toEqual({});
    });
    it('boolean 不能带值 → 错', () => {
      expect(err(['--yes=true'], COMMON_SPECS)).toMatch(/boolean flag/);
    });
  });

  describe('string flag', () => {
    it('--name <val>', () => {
      expect(ok(['--name', 'alice'], COMMON_SPECS).flags).toEqual({ name: 'alice' });
    });
    it('--name=<val>', () => {
      expect(ok(['--name=alice'], COMMON_SPECS).flags).toEqual({ name: 'alice' });
    });
    it('重复出现取最后(GNU 风格)', () => {
      expect(ok(['--name', 'alice', '--name', 'bob'], COMMON_SPECS).flags).toEqual({ name: 'bob' });
    });
    it('缺值 → 错', () => {
      expect(err(['--name'], COMMON_SPECS)).toMatch(/requires a value/);
    });
    it('值可以是空串 (--name=)', () => {
      expect(ok(['--name='], COMMON_SPECS).flags).toEqual({ name: '' });
    });
  });

  describe('array flag', () => {
    it('单次出现也成为 string[]', () => {
      expect(ok(['--env', 'A=1'], COMMON_SPECS).flags).toEqual({ env: ['A=1'] });
    });
    it('重复出现 collected 成 string[],顺序保留', () => {
      expect(ok(['--env', 'A=1', '--env=B=2', '--env', 'C=3'], COMMON_SPECS).flags).toEqual({
        env: ['A=1', 'B=2', 'C=3'],
      });
    });
  });

  describe('位置参数', () => {
    it('flag 之前的位置参数', () => {
      expect(ok(['install', 'brave', '--yes'], COMMON_SPECS).positional).toEqual(['install', 'brave']);
    });
    it('flag 之后的位置参数', () => {
      expect(ok(['--yes', 'install', 'brave'], COMMON_SPECS).positional).toEqual(['install', 'brave']);
    });
    it('flag 之间的位置参数', () => {
      expect(ok(['--yes', 'install', '--name=x', 'brave'], COMMON_SPECS).positional).toEqual([
        'install',
        'brave',
      ]);
    });
  });

  describe('-- 终止符', () => {
    it('之后的 token 全部进 positional,即使长得像 flag', () => {
      const r = ok(['--yes', '--', '--name', 'still-positional'], COMMON_SPECS);
      expect(r.flags).toEqual({ yes: true });
      expect(r.positional).toEqual(['--name', 'still-positional']);
    });
    it('-- 本身不会成为 positional', () => {
      const r = ok(['--', 'x'], COMMON_SPECS);
      expect(r.positional).toEqual(['x']);
    });
  });

  describe('错误', () => {
    it('未知 long flag', () => {
      expect(err(['--bogus'], COMMON_SPECS)).toMatch(/unknown flag: --bogus/);
    });
    it('未知 short flag', () => {
      expect(err(['-z'], COMMON_SPECS)).toMatch(/unknown flag: -z/);
    });
    it('-abc 串联 short flag 不支持 → unknown', () => {
      // 我们故意不支持串联,LLM 不会写,做了纯负载。
      expect(err(['-abc'], COMMON_SPECS)).toMatch(/unknown flag/);
    });
    it('--foo= 在 string flag 上是合法空值,不是错', () => {
      expect(ok(['--name='], COMMON_SPECS).flags).toEqual({ name: '' });
    });
  });

  describe('spec 自身的错误(programmer error)', () => {
    it('重名 long flag → spec error', () => {
      expect(err([], [
        { name: 'x', type: 'string' },
        { name: 'x', type: 'string' },
      ])).toMatch(/flag spec duplicate/);
    });
    it('重 alias → spec error', () => {
      expect(err([], [
        { name: 'a', alias: 'x', type: 'boolean' },
        { name: 'b', alias: 'x', type: 'boolean' },
      ])).toMatch(/flag alias duplicate/);
    });
  });

  it('非 flag-like token(如裸 `-`)走 positional', () => {
    // 现实里 `-` 常表示 stdin/stdout;我们当 positional 处理即可。
    expect(ok(['-'], COMMON_SPECS).positional).toEqual(['-']);
  });
});
