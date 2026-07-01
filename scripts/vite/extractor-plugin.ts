// extractor 独立单 entry IIFE 子构建（见 headless-page-extract.md §4.3 / §5）。
//
// 为何不复用 preload 多 entry CJS 段：preload 段是 multi-entry + formats:['cjs']
// （preload 要 require('electron')）。把 extractor 挂进去 → 产物是 CJS，注入页面即炸
// （readability 是 CJS 包，bundler interop 易残留 require/exports，页面无 module/require）。
//
// 单 entry IIFE 子构建结构上不可能含 require/module.exports，天然可注入。
// 产物落 `out/preload/extractor.js`，运行时由 main 侧 executeJavaScript 动态注入。
//
// 作为 preload 段的 build 插件挂载：closeBundle 里串跑一次（dev 与 build 都走 preload
// build，故两边都产出）。built 守卫保证 watch 模式只构建一次。

import fs from 'node:fs';
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

const ROOT = resolve(__dirname, '../..');
const ENTRY = resolve(ROOT, 'src/preload/extract/extractor.ts');
const OUT_DIR = resolve(ROOT, 'out/preload');
const OUT_FILE = resolve(OUT_DIR, 'extractor.js');

// 注入产物硬校验（Phase 1 验收点，不通过即红）：
// 不含 require( / module.exports / exports.，且挂了 window.__deskmateExtract。
function validateBundle(code: string): void {
  const forbidden = ['require(', 'module.exports', 'exports.'];
  for (const token of forbidden) {
    if (code.includes(token)) {
      throw new Error(
        `[extractor] injected bundle contains "${token}" — not injectable into a page (expected pure IIFE).`,
      );
    }
  }
  if (!code.includes('__deskmateExtract')) {
    throw new Error('[extractor] injected bundle does not assign window.__deskmateExtract.');
  }
}

export function extractorBundlePlugin(): Plugin {
  let built = false;
  return {
    name: 'deskmate:extractor-bundle',
    apply: 'build',
    closeBundle: {
      sequential: true,
      async handler() {
        if (built) return;
        built = true;

        await build({
          configFile: false,
          root: ROOT,
          logLevel: 'warn',
          build: {
            outDir: OUT_DIR,
            emptyOutDir: false, // 不清掉 preload 段已产出的 preload*.js
            minify: true,
            lib: {
              entry: ENTRY,
              formats: ['iife'],
              name: '__deskmateExtractBundle', // 内部包装名，绝不挂到 window
              fileName: () => 'extractor.js',
            },
            rollupOptions: {
              // readability/turndown/gfm 必须 inline（默认 bundle，不 external）。
              external: [],
            },
          },
          resolve: {
            alias: { '@shared': resolve(ROOT, 'src/shared') },
          },
        });

        if (!fs.existsSync(OUT_FILE)) {
          throw new Error(`[extractor] sub-build produced no output at ${OUT_FILE}`);
        }
        validateBundle(fs.readFileSync(OUT_FILE, 'utf8'));
      },
    },
  };
}
