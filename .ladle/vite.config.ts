import { resolve } from 'path';
import { fileURLToPath } from 'url';
import type { UserConfig } from 'vite';

// .ladle/vite.config.ts → 仓库根目录
const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');

// Ladle 通过 vite 的 loadConfigFromFile 加载本文件并 merge 进其内置配置。
// 仅补充 renderer 的路径别名（根 tsconfig.json 只有 references、无 paths，
// 故 Ladle 内置的 vite-tsconfig-paths 解析不到 @/*，这里显式声明）。
const config: UserConfig = {
  resolve: {
    alias: {
      '@shared': resolve(repoRoot, 'src/shared'),
      '@renderer': resolve(repoRoot, 'src/renderer'),
      '@': resolve(repoRoot, 'src/renderer'),
    },
  },
};

export default config;
