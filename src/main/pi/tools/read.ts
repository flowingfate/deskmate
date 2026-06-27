/**
 * `read` —— 统一读取工具。
 *
 * LLM 只看到 1 个参数 `path: string`,通过 `:<sel>` 后缀承载行号 / 页码 /
 * raw / 组合形态;通过 `scheme://` 前缀承载 internal resource(skill / agent /
 * 等)。范式来自 omp 的同名工具,设计文档见 `ai.prompt/tool-system.md`。
 *
 * 范围:本地文本文件 + office 文档(PDF/DOCX/PPTX/XLSX)+ internal URI
 * (`skill://`)。URL fetch(`https://`)由后续 phase 接入。
 *
 * Description 的核心成本是 prompt cache 永久占用 —— 写法纪律:
 * - 只列**形态示例**,不重复字段语义(`path: string` 字面已说清)
 * - 不写 IMPORTANT/NOTE 这种 LLM 无视的 boilerplate
 * - 暴露的 scheme/扩展 必须当前能跑通,后续加 handler 时同步刷描述
 */
import { jsonSchema } from './schema';
import type { LocalTool } from './types';
import { dispatchRead, type ReadToolArgs } from './read/dispatch';

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description:
        'Filesystem path (relative or absolute), office document path, or ' +
        'internal URI (e.g. `local://notes.md`, `knowledge://kb.md`, ' +
        '`skill://my-skill`). Append `:<sel>` for line ranges or raw mode.',
    },
  },
  required: ['path'],
});

const DESCRIPTION = [
  'Read text files, office documents (PDF/DOCX/PPTX/XLSX), images (PNG/JPEG/GIF/WEBP), and internal resources through a single `path` string.',
  '',
  '# Path forms',
  '- `src/foo.ts` — local text file (relative to cwd or absolute)',
  '- `report.pdf` / `notes.docx` / `data.xlsx` — office document (auto-detected by extension)',
  '- `local://<path>` — file in the current session sandbox (write via `write local://<path>`)',
  '- `knowledge://<path>` — file in the current agent\'s Knowledge Base (write via `write knowledge://<path>`)',
  '- `skill://my-skill` — load a skill\'s SKILL.md (browse available skills via `app skill list`)',
  '- `photo.png` / `local://uploads/shot.jpg` — image file; returns the image so you can view its contents',
  '',
  '# Line selectors (append `:<sel>` to path)',
  'Bare path with no selector reads from the start (text files: up to 2000 lines or 256KB).',
  '- `:50` — single line anchor (line 50 only)',
  '- `:50-200` — lines 50 to 200 inclusive',
  '- `:50-` — line 50 to end of file',
  '- `:50+150` — 150 lines starting at line 50',
  '- `:raw` — verbatim text; no minified/binary hints',
  '- `:50-200:raw` or `:raw:50-200` — combine range and raw (order-independent)',
  '',
  '# Page selectors (office documents only — PDF / PPT / Excel)',
  'Same `N` / `N-M` / `N+K` / `N-` shapes, prefixed with `p`. Word documents ignore page selectors (use line ranges).',
  '- `:p3` — page 3 only',
  '- `:p3-7` — pages 3 to 7',
  '- `:p3+2` — 2 pages starting at page 3',
  '- `:p3-7:50-100` — pages 3-7, then lines 50-100 within those pages',
  '- `:p3-7:50-100:raw` — page + line + raw, order-independent',
  '',
  '<critical>',
  '- Prefer `read` over `shell cat` / `head` / `tail` / `less` for every file inspection. Bash pipelines for reading files are FORBIDDEN.',
  '- For line/page ranges, append the selector to `path` (e.g. `path="src/foo.ts:50-200"`, `path="report.pdf:p3-7"`). NEVER substitute `sed -n` / `awk NR` / `head | tail`.',
  '- For `skill://<name>`, the name is the stable skill id — case-sensitive. If unsure of available names, run `app skill list` first.',
  '- `local://` and `knowledge://` read text files via streaming pagination — large files are truncated by line/byte budget, binary files return a `fileTypeHint=binary` preview rather than an error. Use line selectors (`local://big.log:1000-1100`) for slicing.',
  '</critical>',
].join('\n');

export const read: LocalTool = {
  spec: {
    name: 'read',
    description: DESCRIPTION,
    parameters: PARAMETERS,
  },
  async handler(args, ctx) {
    return dispatchRead(args as ReadToolArgs, ctx);
  },
};
