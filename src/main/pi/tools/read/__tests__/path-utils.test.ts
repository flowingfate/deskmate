/**
 * `read` 工具的 path-utils 单测。
 *
 * 测点覆盖三块互相独立的能力,故意分 describe 块,失败定位精确:
 * - parseLineRangeChunk:一段 selector chunk 的解析与边界(0、负、N-M with M<N)
 * - parseSelector:多段 selector 的组合规则(raw + range,多段 raw 等价一段)
 * - splitPathAndSel:把 raw path 切成 (path, sel) —— 严格白名单,文件名带 `:` 不
 *   被误吞
 */
import { describe, it, expect } from 'vitest';

import {
  parseLineRangeChunk,
  parsePageRangeChunk,
  parseSelector,
  splitPathAndSel,
} from '../path-utils';

describe('parseLineRangeChunk', () => {
  it('单数字:N 是单行 anchor(start === end)', () => {
    const r = parseLineRangeChunk('42');
    expect(r).toEqual({ startLine: 42, endLine: 42 });
  });

  it('开放结尾:N- 是 endLine undefined,语义"到 EOF"', () => {
    expect(parseLineRangeChunk('50-')).toEqual({ startLine: 50, endLine: undefined });
  });

  it('闭区间:N-M 解析 start/end 双端', () => {
    expect(parseLineRangeChunk('50-200')).toEqual({ startLine: 50, endLine: 200 });
  });

  it('count 形式:N+K 转为 [N, N+K-1] —— "K 行起于 N"语义', () => {
    expect(parseLineRangeChunk('50+150')).toEqual({ startLine: 50, endLine: 199 });
  });

  it('行号 0 抛错(1-indexed 红线)', () => {
    expect(() => parseLineRangeChunk('0')).toThrow(/1-indexed/);
    expect(() => parseLineRangeChunk('0-10')).toThrow(/1-indexed/);
  });

  it('M < N 抛错:start 已知,end 不能往左拐', () => {
    expect(() => parseLineRangeChunk('100-50')).toThrow(/must be >= start/);
  });

  it('+0 / +负 抛错:不允许"读 0 行起于 N"这种诡异 op', () => {
    expect(() => parseLineRangeChunk('50+0')).toThrow(/K >= 1/);
  });

  it('非数字开头返回 null —— "不是 chunk"由调用方判断如何处理', () => {
    expect(parseLineRangeChunk('raw')).toBeNull();
    expect(parseLineRangeChunk('abc')).toBeNull();
  });
});

describe('parseSelector', () => {
  it('单段 raw → raw=true,无 ranges', () => {
    expect(parseSelector('raw')).toEqual({ ranges: [], pages: [], raw: true });
  });

  it('单段 range → ranges 一段,raw=false', () => {
    expect(parseSelector('50-200')).toEqual({
      ranges: [{ startLine: 50, endLine: 200 }],
      pages: [],
      raw: false,
    });
  });

  it('二段组合 range:raw 与 raw:range 等价(顺序无关)', () => {
    const a = parseSelector('50-200:raw');
    const b = parseSelector('raw:50-200');
    expect(a).toEqual(b);
    expect(a).toEqual({
      ranges: [{ startLine: 50, endLine: 200 }],
      pages: [],
      raw: true,
    });
  });

  it('多段 range 暂不支持 —— 抛错指引 LLM 拆成多次调用', () => {
    expect(() => parseSelector('50-100:200-300')).toThrow(/Multiple line ranges/);
  });

  it('未知 chunk 抛错,列出支持的形态', () => {
    expect(() => parseSelector('bogus')).toThrow(/Supported.*raw/);
  });

  it('page chunk 单段:`p3-7` → pages 一段,ranges 空', () => {
    expect(parseSelector('p3-7')).toEqual({
      ranges: [],
      pages: [{ startLine: 3, endLine: 7 }],
      raw: false,
    });
  });

  it('page + line 组合:`p3-7:50-100` → pages + ranges 各一段', () => {
    expect(parseSelector('p3-7:50-100')).toEqual({
      ranges: [{ startLine: 50, endLine: 100 }],
      pages: [{ startLine: 3, endLine: 7 }],
      raw: false,
    });
  });

  it('三件套:`p3-7:50-100:raw` 顺序无关', () => {
    const a = parseSelector('p3-7:50-100:raw');
    const b = parseSelector('raw:50-100:p3-7');
    expect(a).toEqual(b);
    expect(a).toEqual({
      ranges: [{ startLine: 50, endLine: 100 }],
      pages: [{ startLine: 3, endLine: 7 }],
      raw: true,
    });
  });

  it('多段 page 暂不支持 —— 抛错', () => {
    expect(() => parseSelector('p1-3:p5-7')).toThrow(/Multiple page ranges/);
  });
});

describe('splitPathAndSel', () => {
  it('无 `:` 整段当 path', () => {
    expect(splitPathAndSel('src/foo.ts')).toEqual({ path: 'src/foo.ts' });
  });

  it('合法 range selector 切下来', () => {
    expect(splitPathAndSel('src/foo.ts:50-200')).toEqual({
      path: 'src/foo.ts',
      sel: '50-200',
    });
  });

  it('合法 raw selector 切下来', () => {
    expect(splitPathAndSel('config.json:raw')).toEqual({
      path: 'config.json',
      sel: 'raw',
    });
  });

  it('二段组合:path:N-M:raw → sel="N-M:raw"', () => {
    expect(splitPathAndSel('src/foo.ts:50-200:raw')).toEqual({
      path: 'src/foo.ts',
      sel: '50-200:raw',
    });
  });

  it('二段组合反向:path:raw:N-M → sel="raw:N-M"', () => {
    expect(splitPathAndSel('src/foo.ts:raw:50-200')).toEqual({
      path: 'src/foo.ts',
      sel: 'raw:50-200',
    });
  });

  it('文件名带 `:` 但尾段不是 selector 形态 → 不切', () => {
    // `foo:bar.txt` 中 `bar.txt` 不匹配 selector 白名单 → 整段当 path
    expect(splitPathAndSel('weird:bar.txt')).toEqual({ path: 'weird:bar.txt' });
  });

  it('Windows 盘符 C:\\foo 不被误切(C 在 lastIndexOf 之前;末段非 selector)', () => {
    expect(splitPathAndSel('C:\\Users\\foo.ts')).toEqual({
      path: 'C:\\Users\\foo.ts',
    });
  });

  it('开头 `:` 不切(colon at 0)', () => {
    expect(splitPathAndSel(':50')).toEqual({ path: ':50' });
  });

  it('包含路径 + range selector 正常', () => {
    expect(splitPathAndSel('/abs/path/to/src/foo.ts:50+150')).toEqual({
      path: '/abs/path/to/src/foo.ts',
      sel: '50+150',
    });
  });

  it('internal URL 不被 splitPathAndSel 误切(无 selector 尾段)', () => {
    // `skill://foo` 中 `//foo` 不匹配 selector → 整段当 path,留给 internal-url
    // backend 自己处理(URL parser 不会被这里干扰)
    expect(splitPathAndSel('skill://foo')).toEqual({ path: 'skill://foo' });
  });

  it('internal URL + 行号 selector:`skill://foo:50` 切出 sel=50', () => {
    // 这是有意的:selector 跨 protocol 统一工作。internal-url backend 收到
    // selector 后会在 router 返回的文本上做行号切片。
    expect(splitPathAndSel('skill://foo:50')).toEqual({
      path: 'skill://foo',
      sel: '50',
    });
  });
});

describe('parsePageRangeChunk', () => {
  it('单数字 pN 是单页 anchor(start === end)', () => {
    expect(parsePageRangeChunk('p3')).toEqual({ startLine: 3, endLine: 3 });
  });

  it('开放结尾 pN-:到最后一页', () => {
    expect(parsePageRangeChunk('p3-')).toEqual({ startLine: 3, endLine: undefined });
  });

  it('闭区间 pN-M', () => {
    expect(parsePageRangeChunk('p3-7')).toEqual({ startLine: 3, endLine: 7 });
  });

  it('count 形式 pN+K → [N, N+K-1]', () => {
    expect(parsePageRangeChunk('p3+2')).toEqual({ startLine: 3, endLine: 4 });
  });

  it('页码 0 抛错(1-indexed 红线)', () => {
    expect(() => parsePageRangeChunk('p0')).toThrow(/1-indexed/);
  });

  it('M < N 抛错', () => {
    expect(() => parsePageRangeChunk('p7-3')).toThrow(/must be >= start/);
  });

  it('p+0 抛错', () => {
    expect(() => parsePageRangeChunk('p3+0')).toThrow(/K >= 1/);
  });

  it('大小写不敏感:`P3-7` 也认', () => {
    expect(parsePageRangeChunk('P3-7')).toEqual({ startLine: 3, endLine: 7 });
  });

  it('完全不匹配抛错(给非 page 文本)', () => {
    expect(() => parsePageRangeChunk('not-a-page')).toThrow(/expected pN/);
  });
});

describe('splitPathAndSel — page selectors', () => {
  it('合法 page selector 切下来', () => {
    expect(splitPathAndSel('report.pdf:p3-7')).toEqual({
      path: 'report.pdf',
      sel: 'p3-7',
    });
  });

  it('page + line 组合:`report.pdf:p3-7:50-100`', () => {
    expect(splitPathAndSel('report.pdf:p3-7:50-100')).toEqual({
      path: 'report.pdf',
      sel: 'p3-7:50-100',
    });
  });

  it('三件套:`report.pdf:p3-7:50-100:raw` 一次切完三段', () => {
    expect(splitPathAndSel('report.pdf:p3-7:50-100:raw')).toEqual({
      path: 'report.pdf',
      sel: 'p3-7:50-100:raw',
    });
  });

  it('内部一段不是合法 selector 时切到该位置停止(safe stop)', () => {
    // `report.pdf:bogus:p3` —— 从右往左:`p3` 合法 → 收;往左 `bogus` 非法 → 停。
    // 结果 path = `report.pdf:bogus`,sel = `p3`。
    expect(splitPathAndSel('report.pdf:bogus:p3')).toEqual({
      path: 'report.pdf:bogus',
      sel: 'p3',
    });
  });
});
