import { describe, expect, it } from 'vitest';
import type { LogRow } from '@shared/log/types';
import { buildSpanForest } from '../spanTree';

function row(partial: Partial<LogRow> & Pick<LogRow, 'id' | 'ts' | 'level' | 'component' | 'msg'>): LogRow {
  return {
    process_type: 'main',
    pid: 1,
    trace_id: 't',
    span_id: null,
    parent_span_id: null,
    err_message: null,
    err_stack: null,
    window_id: null,
    life_id: 1,
    fields: null,
    ...partial,
  };
}

describe('buildSpanForest', () => {
  it('returns empty forest for no rows', () => {
    const f = buildSpanForest([]);
    expect(f.roots).toEqual([]);
    expect(f.flat).toEqual([]);
    expect(f.orphans).toEqual([]);
    expect(f.minTs).toBe(0);
    expect(f.maxTs).toBe(0);
  });

  it('merges start/end rows sharing a sid and reads dur from fields', () => {
    const rows = [
      row({ id: 1, ts: 1_000, level: 30, component: 'chat.turn', msg: 'turn start', span_id: 'A' }),
      row({ id: 2, ts: 1_200, level: 30, component: 'chat.turn', msg: 'turn done', span_id: 'A', fields: JSON.stringify({ dur: 250 }) }),
    ];
    const f = buildSpanForest(rows);
    expect(f.roots).toHaveLength(1);
    const span = f.roots[0];
    expect(span.sid).toBe('A');
    expect(span.rows).toHaveLength(2);
    expect(span.startTs).toBe(1_000);
    // endTs prefers startTs + dur over max(ts)
    expect(span.endTs).toBe(1_250);
    expect(span.hasDur).toBe(true);
  });

  it('falls back to max(ts) when no dur present', () => {
    const rows = [
      row({ id: 1, ts: 1_000, level: 30, component: 'chat.llm', msg: 'stream start', span_id: 'A' }),
      row({ id: 2, ts: 1_300, level: 40, component: 'chat.llm', msg: 'stream warn', span_id: 'A' }),
    ];
    const f = buildSpanForest(rows);
    const span = f.roots[0];
    expect(span.endTs).toBe(1_300);
    expect(span.hasDur).toBe(false);
    expect(span.maxLevel).toBe(40);
  });

  it('links psid to parent and orders siblings by startTs', () => {
    const rows = [
      row({ id: 1, ts: 1_000, level: 30, component: 'chat.turn', msg: 'turn start', span_id: 'P' }),
      // sibling B starts later — must come after A in children
      row({ id: 2, ts: 1_050, level: 30, component: 'chat.tool', msg: 'tool start', span_id: 'B', parent_span_id: 'P' }),
      row({ id: 3, ts: 1_020, level: 30, component: 'chat.tool', msg: 'tool start', span_id: 'A', parent_span_id: 'P' }),
      row({ id: 4, ts: 1_080, level: 30, component: 'chat.tool', msg: 'tool ok', span_id: 'A', parent_span_id: 'P', fields: JSON.stringify({ dur: 60 }) }),
      row({ id: 5, ts: 1_200, level: 30, component: 'chat.tool', msg: 'tool ok', span_id: 'B', parent_span_id: 'P', fields: JSON.stringify({ dur: 150 }) }),
      row({ id: 6, ts: 1_400, level: 30, component: 'chat.turn', msg: 'turn done', span_id: 'P', fields: JSON.stringify({ dur: 400 }) }),
    ];
    const f = buildSpanForest(rows);
    expect(f.roots).toHaveLength(1);
    const parent = f.roots[0];
    expect(parent.sid).toBe('P');
    expect(parent.children.map((c) => c.sid)).toEqual(['A', 'B']);
    // DFS flat order: P, A, B
    expect(f.flat.map((n) => n.sid)).toEqual(['P', 'A', 'B']);
    // depth filled
    expect(parent.depth).toBe(0);
    expect(parent.children[0].depth).toBe(1);
  });

  it('promotes spans with missing parent to a root', () => {
    const rows = [
      // psid 'GHOST' is not in this trace slice — should still render as root
      row({ id: 1, ts: 1_000, level: 30, component: 'chat.tool', msg: 'tool start', span_id: 'A', parent_span_id: 'GHOST' }),
    ];
    const f = buildSpanForest(rows);
    expect(f.roots).toHaveLength(1);
    expect(f.roots[0].sid).toBe('A');
    expect(f.roots[0].psid).toBe('GHOST'); // 保留原始 psid 给 UI 标"孤儿父"
  });

  it('captures rows without span_id as orphans', () => {
    const rows = [
      row({ id: 1, ts: 1_000, level: 30, component: 'misc', msg: 'no trace here' }),
      row({ id: 2, ts: 1_100, level: 30, component: 'chat.turn', msg: 'turn start', span_id: 'A' }),
    ];
    const f = buildSpanForest(rows);
    expect(f.roots).toHaveLength(1);
    expect(f.orphans).toHaveLength(1);
    expect(f.orphans[0].row.id).toBe(1);
  });

  it('records hasError when any row carries err_message', () => {
    const rows = [
      row({ id: 1, ts: 1_000, level: 30, component: 'chat.llm', msg: 'stream start', span_id: 'A' }),
      row({ id: 2, ts: 1_100, level: 50, component: 'chat.llm', msg: 'stream failed', span_id: 'A', err_message: 'boom', fields: JSON.stringify({ dur: 100 }) }),
    ];
    const f = buildSpanForest(rows);
    expect(f.roots[0].hasError).toBe(true);
    expect(f.roots[0].maxLevel).toBe(50);
  });
});
