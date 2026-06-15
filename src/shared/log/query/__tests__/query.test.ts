import { describe, expect, it } from 'vitest';
import { buildQuery } from '../filter';
import { parseDuration, parseSince, parseUntil } from '../parser';
import { formatJson, formatText, formatMarkdown } from '../format';
import { LEVEL_NUM, type LogRow } from '../../types';

describe('parser', () => {
  it('parses duration units', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('1d')).toBe(86_400_000);
  });

  it('rejects invalid duration', () => {
    expect(() => parseDuration('10x')).toThrow();
  });

  it('parseSince relative vs absolute', () => {
    const now = 1_700_000_000_000;
    expect(parseSince('10m', now)).toBe(now - 600_000);
    expect(parseSince('now', now)).toBe(now);
    expect(parseSince('@2024-01-01T00:00:00Z', now)).toBe(
      Date.parse('2024-01-01T00:00:00Z')
    );
    expect(parseSince('2024-01-01T00:00:00Z', now)).toBe(
      Date.parse('2024-01-01T00:00:00Z')
    );
  });

  it('parseUntil mirrors parseSince', () => {
    const now = 1_700_000_000_000;
    expect(parseUntil('1h', now)).toBe(now - 3_600_000);
  });
});

describe('buildQuery', () => {
  it('empty filter selects all with default limit', () => {
    const q = buildQuery({});
    expect(q.sql).not.toContain('WHERE');
    expect(q.params).toEqual([500, 0]);
    expect(q.countSql).toContain('COUNT(*)');
    expect(q.countParams).toEqual([]);
  });

  it('combines all clauses with AND and parametrizes', () => {
    const q = buildQuery({
      since: 1000,
      until: 2000,
      minLevel: 'warn',
      componentGlob: 'chat.*',
      traceId: 't-1',
      lifeId: 42,
      grep: 'boom',
      limit: 10,
      offset: 5,
    });
    expect(q.sql).toContain('ts >= ?');
    expect(q.sql).toContain('ts <= ?');
    expect(q.sql).toContain('level >= ?');
    expect(q.sql).toContain('component LIKE ?');
    expect(q.sql).toContain('trace_id = ?');
    expect(q.sql).toContain('life_id = ?');
    expect(q.sql).toContain('app_logs_fts MATCH ?');
    expect(q.sql).toContain('LIMIT ? OFFSET ?');
    expect(q.params).toEqual([
      1000,
      2000,
      LEVEL_NUM.warn,
      'chat.%',
      't-1',
      42,
      'boom',
      10,
      5,
    ]);
    expect(q.countParams).toEqual([
      1000,
      2000,
      LEVEL_NUM.warn,
      'chat.%',
      't-1',
      42,
      'boom',
    ]);
  });

  it('escapes LIKE special chars in componentGlob', () => {
    const q = buildQuery({ componentGlob: 'pre_%fix.*' });
    expect(q.params[0]).toBe('pre\\_\\%fix.%');
  });

  it('appends id > ? when sinceId is set', () => {
    const q = buildQuery({ sinceId: 42 });
    expect(q.sql).toContain('id > ?');
    expect(q.params).toEqual([42, 500, 0]);
    expect(q.countParams).toEqual([42]);
  });

  it('filters by lifeId when set', () => {
    const q = buildQuery({ lifeId: 7 });
    expect(q.sql).toContain('life_id = ?');
    expect(q.params).toEqual([7, 500, 0]);
    expect(q.countParams).toEqual([7]);
  });
});

const row: LogRow = {
  id: 1,
  ts: Date.parse('2026-01-02T03:04:05Z'),
  level: 30,
  process_type: 'main',
  pid: 999,
  component: 'chat.streaming',
  msg: 'hello | world',
  trace_id: 't-1',
  span_id: 'sp-1',
  parent_span_id: null,
  err_message: null,
  err_stack: null,
  window_id: null,
  life_id: 1,
  fields: JSON.stringify({ sessionId: 's-1' }),
};

describe('format', () => {
  it('formatJson emits decoded fields and ISO time', () => {
    const out = JSON.parse(formatJson([row]));
    expect(out[0].iso).toBe('2026-01-02T03:04:05.000Z');
    expect(out[0].level).toBe('info');
    expect(out[0].fields).toEqual({ sessionId: 's-1' });
    expect(out[0].traceId).toBe('t-1');
  });

  it('formatText contains level and component', () => {
    const out = formatText([row]);
    expect(out).toContain('INFO');
    expect(out).toContain('[main/chat.streaming]');
    expect(out).toContain('trace=t-1');
  });

  it('formatMarkdown escapes pipes in msg', () => {
    const out = formatMarkdown([row]);
    expect(out).toContain('hello \\| world');
    expect(out.split('\n').length).toBe(3); // header + sep + 1 row
  });
});
