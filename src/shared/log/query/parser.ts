// 时间表达式解析。支持：
//   相对：10m / 2h / 1d / 30s / 500ms
//   绝对：@2026-05-28 / @2026-05-28T10:00:00 / ISO8601
//   特殊：now

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDuration(s: string): number {
  const m = DURATION_RE.exec(s.trim());
  if (!m) throw new Error(`invalid duration: ${s}`);
  return Number(m[1]) * UNIT_MS[m[2]];
}

function parseAbsolute(s: string): number {
  const stripped = s.startsWith('@') ? s.slice(1) : s;
  const t = Date.parse(stripped);
  if (Number.isNaN(t)) throw new Error(`invalid timestamp: ${s}`);
  return t;
}

// 解析 since：相对值则 now - duration，绝对值则按字面值。
export function parseSince(s: string, now: number = Date.now()): number {
  const t = s.trim();
  if (t === 'now') return now;
  if (t.startsWith('@') || /^\d{4}-/.test(t)) return parseAbsolute(t);
  return now - parseDuration(t);
}

// until 含义同上；相对值代表"截止到 now - duration"。
export function parseUntil(s: string, now: number = Date.now()): number {
  const t = s.trim();
  if (t === 'now') return now;
  if (t.startsWith('@') || /^\d{4}-/.test(t)) return parseAbsolute(t);
  return now - parseDuration(t);
}
