/**
 * 实体 id 生成。统一使用 ULID（Crockford Base32 编码，26 字符）。
 *
 * 与 UUIDv7 同样含 48-bit unix ms 时间戳，天然字典序时间有序；但比 UUIDv7 短 10 字符
 * （26 vs 36），4 个嵌套 id 即可节省 40 字符 —— 对 Windows 260 字符路径上限至关重要。
 *
 * 编码：32-char Crockford alphabet (0123456789ABCDEFGHJKMNPQRSTVWXYZ)，
 *      10 位时间戳 (48-bit) + 16 位随机 (80-bit)。
 */

export type EntityPrefix = 'p' | 'a' | 's' | 'j';

const PREFIXES: ReadonlySet<EntityPrefix> = new Set(['p', 'a', 's', 'j']);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function getRandomBytes(n: number): Uint8Array {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (!g || typeof g.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues unavailable');
  }
  return g.getRandomValues(new Uint8Array(n));
}

function encodeTimestamp(ms: number): string {
  // 48 bit → 10 base32 chars
  let n = BigInt(ms);
  const out = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCKFORD[Number(n & 0x1fn)];
    n >>= 5n;
  }
  return out.join('');
}

function encodeRandom16(): string {
  // 16 base32 chars = 80 bits; sample 10 random bytes (80 bits) and base32-encode
  const bytes = getRandomBytes(10);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const out = new Array<string>(16);
  for (let i = 15; i >= 0; i--) {
    out[i] = CROCKFORD[Number(n & 0x1fn)];
    n >>= 5n;
  }
  return out.join('');
}

/** 生成 ULID 字符串（26 字符 Crockford Base32，不含前缀）。 */
export function ulid(): string {
  return encodeTimestamp(Date.now()) + encodeRandom16();
}

/** 'p_{ulid}' / 'a_{ulid}' / 's_{ulid}' / 'j_{ulid}'（总长 28 字符）。 */
export function newEntityId(prefix: EntityPrefix): string {
  if (!PREFIXES.has(prefix)) throw new Error(`invalid entity prefix: ${prefix}`);
  return `${prefix}_${ulid()}`;
}

/** 从一个完整 entity id 中拆出前缀与 ulid。返回 null 表示格式不合法。 */
export function parseEntityId(id: string): { prefix: EntityPrefix; ulid: string } | null {
  if (typeof id !== 'string' || id.length !== 28 || id[1] !== '_') return null;
  const prefix = id[0] as EntityPrefix;
  if (!PREFIXES.has(prefix)) return null;
  const body = id.slice(2);
  if (!isUlid(body)) return null;
  return { prefix, ulid: body };
}

/** 检查字符串是否是合法的 ULID（26 字符 Crockford，不含前缀）。 */
export function isUlid(value: string): boolean {
  return typeof value === 'string' && ULID_RE.test(value);
}

/**
 * 从 entity id 反推 ULID 时间戳（前 10 字符 = 48-bit unix ms）。
 * 入参可以是带前缀的 entity id（`s_XXXX...`）或裸 ULID。
 * 非法格式直接 throw —— 调用方应只对已知合法 id 调用。
 */
export function ulidTimestamp(id: string): Date {
  const body = id.length === 28 && id[1] === '_' ? id.slice(2) : id;
  if (!isUlid(body)) throw new Error(`ulidTimestamp: invalid ulid ${id}`);
  let n = 0n;
  for (let i = 0; i < 10; i++) {
    const v = CROCKFORD.indexOf(body[i]);
    if (v < 0) throw new Error(`ulidTimestamp: bad char ${body[i]}`);
    n = (n << 5n) | BigInt(v);
  }
  return new Date(Number(n));
}
