/**
 * `web` AppCommand —— Web 抓取与搜索能力域。
 *
 * 4 个 subcommand,全部 **read-only**:
 *   - `search <query>`     Bing 网页搜索(Playwright)
 *   - `image <query>`      Bing 图片搜索(Playwright)
 *   - `fetch <url>`        多 URL 并行抓取 + 纯文本抽取
 *   - `read-html <file>`   agent-safe HTML reader,绝不返全页
 *
 * 设计纪律:
 *   - 全部 subcommand 支持 `--json`(read-only 的红线)
 *   - **没有** destructive op,**不**需要 `--yes` / `--dry-run`
 *   - `<query>` / `<url>` 既接 positional **也**接 repeatable `--query/--url`,
 *     与 `curl -d k=v` repeatable form 同范式 —— LLM 习惯哪个用哪个
 *   - `--lang`/`--locale` 与 Bing 的 ICU 语言/区域路由一一对应,缺省 `en/us`,
 *     中文 query 自动指引到 `zh/cn`(`_shared.resolveLangLocale` 集中校验)
 *
 * 历史:替代旧 `bing_web_search` / `bing_image_search` / `fetch_web_content` /
 * `read_html` 四个独立 LocalTool。kernel 由 `pi/tools/impl/*` 平移而来,
 * body 一字不改;只去掉跨进程的 `@shared/types/toolCallArgs` 依赖(view 已删)。
 */

import type { AppCommand } from '../../types';

import { runFetch } from './fetch';
import { runImage } from './image';
import { runReadHtml } from './read-html';
import { runSearch } from './search';

const HELP_TOP = `USAGE
  web <subcommand> [options]

DESCRIPTION
  Web access — search, image search, content fetch, and safe HTML reading.
  All subcommands are read-only.

SUBCOMMANDS
  search <query>     Bing web search (Playwright headless Chromium).
  image <query>      Bing image search.
  fetch <url>        Fetch text content from URLs in parallel (max 20).
  read-html <file>   Safely read a local HTML file (outline / section / selector).

GLOBAL OPTIONS (recognised by every subcommand)
  --help, -h     Show subcommand help.
  --json         Output the raw envelope as JSON.

EXAMPLES
  web search "GitHub Copilot pricing"
  web search "深圳 天气" --lang zh --locale cn --json
  web image "studio ghibli concept art" --safe-search Strict
  web fetch https://example.com/article
  web fetch https://a.com https://b.com --json
  web read-html /tmp/page.html
  web read-html /tmp/page.html --mode section --section main
`;

export const webCommand: AppCommand = {
  name: 'web',
  synopsis: 'Search / image-search the web, fetch URLs, read HTML files',
  help: HELP_TOP,
  async run(argv, ctx) {
    const [sub, ...rest] = argv;
    if (sub === undefined || sub === '--help' || sub === '-h') {
      ctx.print(HELP_TOP);
      return;
    }
    switch (sub) {
      case 'search':
        await runSearch(rest, ctx);
        return;
      case 'image':
        await runImage(rest, ctx);
        return;
      case 'fetch':
        await runFetch(rest, ctx);
        return;
      case 'read-html':
        await runReadHtml(rest, ctx);
        return;
      default:
        ctx.printErr(`web: unknown subcommand "${sub}". See "web --help".\n`);
        ctx.setExitCode(2);
        return;
    }
  },
};
