/**
 * `subagent` 命令族 _shared.ts 的纯函数单测 —— 直接测 parser 边界,不走
 * dispatcher。spawn / spawn-many 端到端覆盖在各自 test 文件,这里抓边角
 * case(quoted entries / empty / repeatable forms / shareContext truthy
 * variants)避免重复跑 dispatcher。
 */

import { describe, expect, it } from 'vitest';

import {
  parseConfigJsonFlag,
  parseTaskFlag,
} from '@main/pi/appcmd/builtins/app/subagent/_shared';

describe('parseTaskFlag', () => {
  it('undefined → 报错 missing required', () => {
    const r = parseTaskFlag(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('missing required --task');
  });

  it('false(boolean flag 未给值)→ 同样报 missing', () => {
    const r = parseTaskFlag(false);
    expect(r.ok).toBe(false);
  });

  it('单个 string 形态 → 解析为单 entry', () => {
    const r = parseTaskFlag('a:do work');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tasks).toEqual([{ name: 'a', task: 'do work' }]);
  });

  it('readonly array 形态 → 全部 entry 解析', () => {
    const r = parseTaskFlag(['a:t1', 'b:t2']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tasks).toEqual([
        { name: 'a', task: 't1' },
        { name: 'b', task: 't2' },
      ]);
    }
  });

  it('空数组 → 报 missing required', () => {
    const r = parseTaskFlag([]);
    expect(r.ok).toBe(false);
  });

  it('单个 entry 缺 ":" → 报错', () => {
    const r = parseTaskFlag(['no_colon']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('"name:task description"');
  });

  it('entry name 为空(冒号开头)→ 报错', () => {
    const r = parseTaskFlag([':only-task']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('empty <name>');
  });

  it('entry task 为空(冒号结尾)→ 报错', () => {
    const r = parseTaskFlag(['name:']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('empty <task description>');
  });

  it('entry 含多个 ":" → 首个为分隔,task 保留剩余', () => {
    const r = parseTaskFlag(['a:do X: with Y: zzz']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tasks[0].task).toBe('do X: with Y: zzz');
  });
});

describe('parseConfigJsonFlag', () => {
  it('undefined → ok=false', () => {
    const r = parseConfigJsonFlag(undefined);
    expect(r.ok).toBe(false);
  });

  it('数组 / 重复 flag 形态 → 拒绝(只接 string)', () => {
    const r = parseConfigJsonFlag(['[]']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('not repeatable');
  });

  it('合法 JSON 数组 → 解析每个 entry,shareContext 默认 false', () => {
    const r = parseConfigJsonFlag(JSON.stringify([
      { name: 'a', task: 't1' },
      { name: 'b', task: 't2', shareContext: true },
    ]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tasks).toEqual([
        { name: 'a', task: 't1', shareContext: false },
        { name: 'b', task: 't2', shareContext: true },
      ]);
    }
  });

  it('JSON parse 失败 → 报 parse error + 上游 message 透传', () => {
    const r = parseConfigJsonFlag('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('parse error');
  });

  it('JSON 非数组 → 报错', () => {
    const r = parseConfigJsonFlag('{"name":"a","task":"t"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('must be an array');
  });

  it('数组元素非 object → 报错 + 包含索引', () => {
    const r = parseConfigJsonFlag('[null,42,"x"]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\[0\] must be an object/);
  });

  it('数组元素缺 name → 报错', () => {
    const r = parseConfigJsonFlag('[{"task":"t"}]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('.name must be a non-empty string');
  });

  it('数组元素缺 task → 报错', () => {
    const r = parseConfigJsonFlag('[{"name":"a"}]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('.task must be a non-empty string');
  });

  it('shareContext 非 true 值(string / number / null / 缺失)→ 视作 false', () => {
    const r = parseConfigJsonFlag(JSON.stringify([
      { name: 'a', task: 't', shareContext: 'yes' },
      { name: 'b', task: 't', shareContext: 1 },
      { name: 'c', task: 't', shareContext: null },
      { name: 'd', task: 't' },
    ]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tasks.every((t) => t.shareContext === false)).toBe(true);
    }
  });
});
