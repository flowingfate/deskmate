// 单纯的文本提取工具:从一段文本里抽出 internal-URI / 操作系统绝对路径。
// 拆出来作为叶子模块是为了避免 `render-items-manager` ↔ `agentSessionCacheManager`
// 之间的循环导入(后者会在 module init 阶段实例化 `RenderItemsManager`)。

// Windows path regex: matches paths starting with a drive letter
// Negative lookbehind (?<![:/]) prevents matching SharePoint URL fragments like /:p:/r/...Doc.aspx
const WindowsPathRegex = /(?<![:/])([A-Za-z]:[\\\/](?:[^\\\/<>"'|?*:\n]+[\\\/])*[^\\\/<>"'|?*:\n]*\.[a-zA-Z0-9]+)/gi;
// Unix path regex: matches paths starting with common system directories
const UnixPathRegex = /(\/(?:Users|home|opt|var|etc|usr|Applications|Library|System|private|tmp|bin|sbin|dev|proc|sys|mnt|media|run)(?:\/[^\/\n<>"'|?*:]+)*\/[^\/\n<>"'|?*:]*\.[a-zA-Z0-9]+)/gi;
// Internal URI: `local://...` / `knowledge://...` —— 主匹配,LLM 输出文件引用就是
// URI 形态;abs path 仅作"显式 read 外部 fs"的兜底。
// 包到非空白 / 引号 / 括号 / 反引号为止,允许包含 ` / `(KB 嵌套目录)与 `.`。
const InternalUriRegex = /\b(?:local|knowledge):\/\/[^\s'"`<>()]+/g;

/**
 * 从文本里抽出文件路径。优先 internal URIs(`local://` / `knowledge://`),
 * 退到 Windows / Unix 绝对路径作为兜底。匹配区间互斥,结果去重。
 */
export function extractFilePathsFromText(text: string): string[] {
  const filePaths: string[] = [];
  const matchedRanges: Array<{ start: number; end: number }> = [];

  let match;

  // 1) Internal URIs first —— 主路径
  while ((match = InternalUriRegex.exec(text)) !== null) {
    filePaths.push(match[0]);
    matchedRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Check whether a candidate overlaps any earlier match.
  const isOverlapping = (start: number, end: number): boolean => {
    return matchedRanges.some(range =>
      (start >= range.start && start < range.end) ||
      (end > range.start && end <= range.end) ||
      (start <= range.start && end >= range.end)
    );
  };

  // 2) Windows abs paths (fallback)
  while ((match = WindowsPathRegex.exec(text)) !== null) {
    const rawPath = match[1];
    const matchStart = match.index;
    const matchEnd = match.index + rawPath.length;
    if (isOverlapping(matchStart, matchEnd)) continue;

    // Normalise to backslash format (Windows standard)
    const normalizedPath = rawPath.replace(/\//g, '\\');
    filePaths.push(normalizedPath);
    matchedRanges.push({ start: matchStart, end: matchEnd });
  }

  // 3) Unix abs paths (fallback)
  while ((match = UnixPathRegex.exec(text)) !== null) {
    const unixPath = match[1];
    const matchStart = match.index;
    const matchEnd = match.index + unixPath.length;
    if (isOverlapping(matchStart, matchEnd)) continue;
    filePaths.push(unixPath);
  }

  // Deduplicate and return
  return [...new Set(filePaths)];
}
