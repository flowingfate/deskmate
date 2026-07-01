// 「网页 → 给 LLM 的高质量 Markdown」的统一产物形态。
//
// 所有「网页 → 文本」消费者（research live view、web fetch headless 渲染）
// 共用同一条注入提取链（Readability + turndown），产出本结构。
// DOM 来源可换，提取器唯一、输出形态唯一。
//
// 注意：本结构**不落盘**，但它是跨进程 IPC 契约（research snapshot / source 回传），
// 字段调整需 clean cutover 全消费者。

export type ExtractionMethod =
  // Readability 判定为文章页，正文经 turndown 转 Markdown。
  | 'readability'
  // Readability 判非文章页返回 null，退到「最长可见容器 innerText」兜底。
  | 'readability-fallback'
  // research 选区模式：用户选中文本。
  | 'selection'
  // web fetch 渲染失败时退回的旧 node-html-parser 纯文本路径。
  | 'raw-text';

export interface ExtractedContent {
  url: string;
  title: string;
  /** Readability content(HTML) → turndown 后的 Markdown（或兜底纯文本）。 */
  markdown: string;
  /** 作者（Readability byline）。 */
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  excerpt?: string;
  lang?: string;
  charCount: number;
  method: ExtractionMethod;
  capturedAt: string;
}
