/**
 * `read` 工具的"路径 + 选择器"语法解析。
 *
 * 范式来自 omp:`<path>:<sel>` 一个字符串塞下所有"如何读"的次结构,LLM 不
 * 需要在多个工具或多个字段间做选择题。
 *
 * 当前支持的 selector chunk(每段独立、用 `:` 串联):
 * - **行号** `N` / `N-` / `N-M` / `N+K` —— 文本/internal-url 行号范围
 * - **页码** `pN` / `pN-` / `pN-M` / `pN+K` —— office 文档页码范围(PDF/PPT/Excel)
 * - **修饰符** `raw` —— 关闭分页/智能 hint
 *
 * 多段合法组合:
 * - `:50-100` —— 行号范围(office 时也接收行号)
 * - `:p3-7` —— page 范围(只对 office 有意义)
 * - `:p3-7:50-100` —— page + page 内行号范围
 * - `:50-100:raw` / `:raw:50-100` —— range + raw,顺序无关
 * - `:p3-7:50-100:raw` —— 三件套,顺序无关
 *
 * **拒绝的形态**(parser 抛 Error):
 * - 同 selector 出现两个 line range / 两个 page range
 * - 多段范围逗号语法 `:5-10,20-30` —— 后续按需开
 * - `:conflicts` —— 我们没 git conflict 视角
 *
 * 关键设计:**严格白名单匹配** —— 文件名 `foo:bar.txt` 不会被误吞,因为
 * `bar.txt` 不是合法 selector 形态;只有 `foo:50` / `foo:raw` / `foo:p3` 这种
 * **确定**是 selector 的尾段才会被切下来。"拿不准就当 path",失败模式安全。
 */

/**
 * 一段闭区间行号 selector。`endLine` 为 undefined 表示 "open-ended"(到 EOF)。
 * 行号 1-indexed,与 readFile / readline 模块一致。
 */
export interface LineRange {
  readonly startLine: number;
  /** undefined = 开放结尾(`50-` 形态)。 */
  readonly endLine?: number;
}

export interface ReadSelector {
  /** 行号范围(可能多段;当前限制一段)。空数组表示"未指定行号"。 */
  readonly ranges: readonly LineRange[];
  /**
   * 页码范围(office 文档专用)。空数组表示"未指定页"—— office backend 会
   * 默认读全部页。非 office backend 看到非空 pages 时**应忽略**(LLM 给文本
   * 文件传 `:p3` 不抛错,只是 page 无意义)—— 这跟"忽略 raw"是同纪律。
   */
  readonly pages: readonly LineRange[];
  /** 是否带 `:raw`。 */
  readonly raw: boolean;
}

/**
 * 单段 selector chunk 匹配:`N` / `N-` / `N-M` / `N+K`。
 *
 * 这是**底线严格**版 —— 行号必须 `>= 1`,`+K` 时 `K >= 1`,`N-M` 时 `M >= N`。
 * 任何违反都抛 Error,而不是 silently 取负值。
 */
const LINE_RANGE_CHUNK_RE = /^(\d+)(?:([-+])(\d+)?)?$/;
const PAGE_RANGE_CHUNK_RE = /^p(\d+)(?:([-+])(\d+)?)?$/i;
const RAW_RE = /^raw$/i;
// selector chunk 的"什么是合法 selector"白名单(用来判断 `:xxx` 是否要切下来)。
// `splitPathAndSel` 贪心向前合并所有连续合法 chunk —— 这个白名单是唯一边界。
const SELECTOR_CHUNK_RE =
  /^(?:raw|p\d+(?:[-+]\d+)?|p\d+-|\d+(?:[-+]\d+)?|\d+-)$/i;

/**
 * 解析一段 chunk(`N` / `N-M` / `N+K` / `N-`)。
 *
 * 不匹配返回 null;匹配但越界(`0` / `N-M` 中 M<N / `N+K` 中 K<1)抛 Error。
 * 调用方:对未知 chunk 用 SELECTOR_CHUNK_RE 先判,再调本函数。
 */
export function parseLineRangeChunk(chunk: string): LineRange | null {
  const m = LINE_RANGE_CHUNK_RE.exec(chunk);
  if (!m) return null;
  const start = Number.parseInt(m[1], 10);
  if (start < 1) {
    throw new Error(
      `Invalid line selector "${chunk}": line numbers are 1-indexed (use :1 instead of :0).`,
    );
  }
  const sep = m[2];
  const rhs = m[3] !== undefined ? Number.parseInt(m[3], 10) : undefined;

  if (sep === undefined) {
    // 纯 `N` —— 单行 anchor。endLine = startLine。
    return { startLine: start, endLine: start };
  }
  if (sep === '+') {
    if (rhs === undefined || rhs < 1) {
      throw new Error(
        `Invalid line selector "${chunk}": "+K" requires K >= 1.`,
      );
    }
    return { startLine: start, endLine: start + rhs - 1 };
  }
  // sep === '-'
  if (rhs === undefined) {
    // 开放结尾 `N-` —— 到 EOF。
    return { startLine: start, endLine: undefined };
  }
  if (rhs < start) {
    throw new Error(
      `Invalid line selector "${chunk}": end (${rhs}) must be >= start (${start}).`,
    );
  }
  return { startLine: start, endLine: rhs };
}

/**
 * 解析整个 sel 字符串(由 `:` 串起的多段 chunk)。每段独立分类:
 * - 匹配 `raw` → 置 `raw=true`(出现多次等价一次)
 * - 匹配 page chunk(`pN` 等)→ push 进 `pages`(当前限制一段;多段抛错)
 * - 匹配 line chunk(`N` 等)→ push 进 `ranges`(当前限制一段;多段抛错)
 * - 都不匹配 → 抛错并列出支持形态
 */
export function parseSelector(sel: string): ReadSelector {
  const chunks = sel.split(':').filter((c) => c.length > 0);
  if (chunks.length === 0) {
    return { ranges: [], pages: [], raw: false };
  }

  let raw = false;
  const ranges: LineRange[] = [];
  const pages: LineRange[] = [];
  for (const chunk of chunks) {
    if (RAW_RE.test(chunk)) {
      raw = true;
      continue;
    }
    if (PAGE_RANGE_CHUNK_RE.test(chunk)) {
      const pageRange = parsePageRangeChunk(chunk);
      // page parser 内部已抛越界错;到这里 pageRange 非 null
      if (pages.length > 0) {
        throw new Error(
          `Multiple page ranges in one selector are not supported yet (got "${sel}").`,
        );
      }
      pages.push(pageRange);
      continue;
    }
    const range = parseLineRangeChunk(chunk);
    if (range === null) {
      throw new Error(
        `Invalid selector chunk "${chunk}". Supported: N, N-M, N+K, N-, pN, pN-M, pN+K, pN-, raw.`,
      );
    }
    if (ranges.length > 0) {
      // 单段限制:多段范围(`5-10:20-30`)未来用逗号语法引入,不混进冒号
      // 语法 —— 冒号语法保留给 "range + page + 修饰符"组合。
      throw new Error(
        `Multiple line ranges in one selector are not supported yet (got "${sel}"). ` +
          'Issue one read per range, or wait for multi-range syntax.',
      );
    }
    ranges.push(range);
  }
  return { ranges, pages, raw };
}

/**
 * 解析 page chunk(`pN` / `pN-` / `pN-M` / `pN+K`)。语法跟 line chunk 完全
 * 同构,仅前缀多一个 `p`。返回的 LineRange 字段名沿用 `startLine` / `endLine`,
 * 调用方知道这里语义是 page —— 字段不重命名是为复用 parser、避免接口爆炸。
 */
export function parsePageRangeChunk(chunk: string): LineRange {
  const m = PAGE_RANGE_CHUNK_RE.exec(chunk);
  if (!m) {
    throw new Error(`Invalid page chunk "${chunk}": expected pN / pN-M / pN+K / pN-.`);
  }
  const start = Number.parseInt(m[1], 10);
  if (start < 1) {
    throw new Error(
      `Invalid page selector "${chunk}": page numbers are 1-indexed (use :p1 instead of :p0).`,
    );
  }
  const sep = m[2];
  const rhs = m[3] !== undefined ? Number.parseInt(m[3], 10) : undefined;

  if (sep === undefined) return { startLine: start, endLine: start };
  if (sep === '+') {
    if (rhs === undefined || rhs < 1) {
      throw new Error(`Invalid page selector "${chunk}": "+K" requires K >= 1.`);
    }
    return { startLine: start, endLine: start + rhs - 1 };
  }
  // sep === '-'
  if (rhs === undefined) return { startLine: start, endLine: undefined };
  if (rhs < start) {
    throw new Error(`Invalid page selector "${chunk}": end (${rhs}) must be >= start (${start}).`);
  }
  return { startLine: start, endLine: rhs };
}

/**
 * 把 raw path 切成 (path, sel)。
 *
 * 算法:**贪心向前合并所有连续合法 selector chunks**。
 * 1. 从尾部找 `:`(`colon > 0` —— 防 windows 盘符 `C:` 被切)
 * 2. `:` 后面段必须匹配 SELECTOR_CHUNK_RE,否则停
 * 3. 切下来作为当前 chunk,base 缩到 `:` 之前
 * 4. 重复 1-3,把多段 chunk 用 `:` 拼回 sel(原顺序)
 * 5. 一旦遇到第一个**不**匹配的尾段就停,base 维持当前(safe fallback)
 *
 * 这样支持任意长度的合法 selector 链(`path:p3-7:50-100:raw`),不需要预先
 * 限定段数。文件名带 `:` 仍然安全 —— 只要尾段不是合法 chunk 形态,就整段
 * 当 path 处理。
 */
export function splitPathAndSel(rawPath: string): { path: string; sel?: string } {
  const collected: string[] = [];
  let base = rawPath;
  while (true) {
    const colon = base.lastIndexOf(':');
    if (colon <= 0) break;
    const tail = base.slice(colon + 1);
    if (!SELECTOR_CHUNK_RE.test(tail)) break;
    collected.unshift(tail);
    base = base.slice(0, colon);
  }
  if (collected.length === 0) return { path: rawPath };
  return { path: base, sel: collected.join(':') };
}
