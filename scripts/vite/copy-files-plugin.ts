// 把指定文件原样拷到 outDir。
// 用途：vite/rolldown 不感知的运行时资产——例如手写的 CJS worker 入口
// （pino transport 的 sqlite-transport.cjs），需要保持源文件结构、不参与打包。
//
// 在 closeBundle 钩子里执行，确保 main build 完成后再拷贝。

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface CopyFilesItem {
  // 相对仓库根的源路径
  src: string;
  // 拷贝后的文件名（写入 outDir 根）。省略则用源文件 basename。
  rename?: string;
}

export function copyFilesPlugin(items: CopyFilesItem[]): Plugin {
  return {
    name: 'deskmate:copy-files',
    apply: 'build',
    closeBundle: {
      sequential: true,
      handler(this: { environment?: { config?: { build?: { outDir?: string } } } }) {
        const outDir = this.environment?.config?.build?.outDir;
        if (!outDir) {
          throw new Error('[copy-files] outDir unavailable in closeBundle context');
        }
        fs.mkdirSync(outDir, { recursive: true });
        for (const it of items) {
          const srcAbs = path.resolve(it.src);
          if (!fs.existsSync(srcAbs)) {
            throw new Error(`[copy-files] source missing: ${srcAbs}`);
          }
          const destName = it.rename ?? path.basename(srcAbs);
          fs.copyFileSync(srcAbs, path.join(outDir, destName));
        }
      },
    },
  };
}
