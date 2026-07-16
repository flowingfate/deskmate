/**
 * `web download <url> <filename> [options]` —— 从 HTTP/HTTPS URL 下载文件落盘。
 *
 * web 域里**唯一的产出型命令**(其余 search / image / fetch 全 read-only):它
 * 写文件,因此通过 `ctx.addDeliverable(fileUri)` 把产出登记给 dispatcher,经
 * facade → `ToolResult.deliverables` 回流给 sub-agent 的 deliverable 审计 ——
 * 与 `write` 工具的产出追踪对齐,不需要下游解析 cmdline。
 *
 * 形态:
 *   - `<url>` positional **必填**(HTTP/HTTPS)。
 *   - `<filename>` positional **必填**(含扩展名,不得含路径分隔符)。
 *   - `--dir <uri>` 落盘目录,默认 `local://`(当前 session sandbox);也接受
 *     `knowledge://<sub>` 或 homedir 内绝对路径。`fileUri` 镜像形态(URI 进 →
 *     URI 出,abs 进 → abs 出)。
 *   - `--max-size <bytes>` 单文件上限,默认 100MB,最大 1GB。
 *   - `--timeout <sec>` 请求超时,**秒**(与 `web fetch` 一致),默认 30,内核转 ms。
 *   - `--overwrite` 覆盖同名文件(默认拒绝)。
 *   - `--json` 透传 `DownloadResult`。
 *
 * 不是 `remove` 那种 destructive op(只创建新文件、带 path/size 校验),因此
 * **不需要 `--yes`**。失败(HTTP / 超限 / 取消)由内核收敛进 `{ success: false,
 * error }`,这里据此 `(exit 1)`。
 */

import { toResolveContext } from '@main/pi/internal-urls';
import { downloadFileInternal, type DownloadArgs } from './kernel/download';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCommand, AppCmdContext } from '../../types';

import { parseNumberFlag } from './_shared';

const HELP = `USAGE
  web download <url> <filename> [options]

DESCRIPTION
  Download any file from an HTTP/HTTPS URL and save it locally. No restrictions
  on file type. The saved file is auto-tracked as a deliverable.

ARGUMENTS
  <url>          HTTP/HTTPS URL of the file to download.
  <filename>     Name to save as, including extension. No path separators.

OPTIONS
  --dir <uri>          Save directory. Default: local:// (current session sandbox).
                       Accepts local://<sub>, knowledge://<sub>, or an absolute
                       path within the user home directory. Result fileUri mirrors
                       the form: URI in -> URI out, abs in -> abs out.
  --max-size <bytes>   Max file size, 1-1073741824 (1GB). Default: 104857600 (100MB).
  --timeout <sec>      Request timeout in seconds (1-300). Default: 30.
  --overwrite          Overwrite an existing file (default: refuse).
  --json               Output the raw DownloadResult as JSON.
  --help, -h           Show this help.

EXAMPLES
  web download https://example.com/photo.png photo.png
  web download https://example.com/q3.json q3.json --dir local://reports
  web download https://example.com/manual.pdf manual.pdf --dir knowledge:// --json
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'dir', type: 'string' },
  { name: 'max-size', type: 'string' },
  { name: 'timeout', type: 'string' },
  { name: 'overwrite', type: 'boolean' },
];

const MAX_SIZE_CEIL = 1073741824; // 1GB
const TIMEOUT_MIN_SEC = 1;
const TIMEOUT_MAX_SEC = 300;

export async function runDownload(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`web download: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  const [url, filename, ...extra] = parsed.positional;
  if (!url) {
    ctx.printErr('web download: <url> argument required.\n');
    ctx.setExitCode(2);
    return;
  }
  if (!filename) {
    ctx.printErr('web download: <filename> argument required.\n');
    ctx.setExitCode(2);
    return;
  }
  if (extra.length > 0) {
    ctx.printErr(`web download: too many positional args (${parsed.positional.length}); expected <url> <filename>.\n`);
    ctx.setExitCode(2);
    return;
  }

  const args: DownloadArgs = { url, filename };

  const dir = parsed.flags.dir;
  if (typeof dir === 'string' && dir.trim() !== '') {
    args.saveDirectory = dir;
  }

  const maxSizeRaw = parsed.flags['max-size'];
  if (maxSizeRaw !== undefined) {
    const n = parseNumberFlag(maxSizeRaw);
    if (n === undefined || Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > MAX_SIZE_CEIL) {
      ctx.printErr(`web download: --max-size must be an integer between 1 and ${MAX_SIZE_CEIL} (got "${String(maxSizeRaw)}").\n`);
      ctx.setExitCode(2);
      return;
    }
    args.maxSizeBytes = n;
  }

  const timeoutRaw = parsed.flags.timeout;
  if (timeoutRaw !== undefined) {
    const sec = parseNumberFlag(timeoutRaw);
    if (sec === undefined || Number.isNaN(sec) || !Number.isInteger(sec) || sec < TIMEOUT_MIN_SEC || sec > TIMEOUT_MAX_SEC) {
      ctx.printErr(`web download: --timeout must be an integer between ${TIMEOUT_MIN_SEC} and ${TIMEOUT_MAX_SEC} seconds (got "${String(timeoutRaw)}").\n`);
      ctx.setExitCode(2);
      return;
    }
    args.timeout = sec * 1000;
  }

  if (parsed.flags.overwrite === true) {
    args.overwrite = true;
  }

  const result = await downloadFileInternal(args, {
    signal: ctx.signal,
    ctx: toResolveContext(ctx),
  });

  if (isJson(parsed.flags)) {
    ctx.print(`${JSON.stringify(result)}\n`);
  }

  if (!result.success) {
    if (!isJson(parsed.flags)) {
      ctx.printErr(`web download: ${result.error ?? 'download failed'}\n`);
    }
    ctx.setExitCode(1);
    return;
  }

  // 成功:登记产出 + 打印人话(json 模式已打印结构化结果,不再重复人话)。
  ctx.addDeliverable(result.fileUri);
  if (!isJson(parsed.flags)) {
    const sizeKb = (result.fileSize / 1024).toFixed(1);
    ctx.print(
      `Downloaded ${result.fileUri} (${sizeKb} KB` +
        `${result.mimeType ? `, ${result.mimeType}` : ''}` +
        `, ${result.downloadTime}ms)\n`,
    );
  }
}

export const downloadCommand: AppCommand = {
  name: 'download',
  synopsis: 'Download a file from an HTTP/HTTPS URL and save it locally',
  help: HELP,
  run: runDownload,
};
