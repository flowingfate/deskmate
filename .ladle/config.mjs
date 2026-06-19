import { fileURLToPath } from 'url';

/** @type {import('@ladle/react').UserConfig} */
export default {
  // shadcn 组件的 stories（集中在 src/renderer/story/）
  stories: 'src/renderer/story/**/*.stories.tsx',
  // 复用 renderer 路径别名（见 .ladle/vite.config.ts）
  viteConfig: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
  defaultStory: '',
  // 输出到 out/（已 gitignore），避免污染存放 electron-builder 配置的 build/ 目录
  outDir: 'out/ladle',
  addons: {
    // 明暗主题切换：Provider 据此 toggle <html>.dark
    theme: {
      enabled: true,
      defaultState: 'light',
    },
    // 无障碍检查
    a11y: {
      enabled: true,
    },
    // 关闭与组件库无关的 addon，保持纯净
    rtl: { enabled: false },
    width: { enabled: false },
    mode: { enabled: false },
  },
};
