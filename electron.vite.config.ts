import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react-swc'

import { ejsTemplatePlugin } from './scripts/vite/ejs-template-plugin'
import { monacoWorkerPlugin } from './scripts/vite/monaco-worker-plugin'
import { copyFilesPlugin } from './scripts/vite/copy-files-plugin'
import { sharedDefines, rendererOnlyDefines } from './scripts/vite/defines'
import appConfig from './brands/deskmate/config.json'

export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve'

  const shared = sharedDefines(mode)
  const rendererOnly = rendererOnlyDefines()
  return {
    main: {
      build: {
        outDir: 'out/main',
        rolldownOptions: {
          external: ['bufferutil', 'utf-8-validate'],
          input: {
            bootstrap: resolve(__dirname, 'src/main/bootstrap.ts'),
            main: resolve(__dirname, 'src/main/main.ts'),
          },
          output: {
            // 让 chunk 直接落在 main.js 同目录（不进 chunks/ 子目录），
            // 这样任何 chunk 里的 __dirname === out/main/，main.ts 可以直接
            // path.join(__dirname, '..', 'preload', '...') 找到 preload。
            chunkFileNames: '[name]-[hash].js',
          },
        },
        sourcemap: isDev ? true : false,
      },
      define: shared,
      plugins: [
        copyFilesPlugin([
          { src: 'src/main/log/sqlite-transport.cjs' },
        ]),
      ],
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'src/shared'),
          '@main': resolve(__dirname, 'src/main'),
        },
      },
    },

    preload: {
      build: {
        outDir: 'out/preload',
        lib: {
          entry: {
            preload: resolve(__dirname, 'src/preload/main.ts'),
            'preload.toolbar': resolve(__dirname, 'src/preload/toolbar.ts'),
            'preload.screenshot': resolve(__dirname, 'src/preload/screenshot.ts'),
            'preload.log-viewer': resolve(__dirname, 'src/preload/log-viewer.ts'),
          },
          formats: ['cjs'], // Preload 必须 CJS — ESM preload 无法 require('electron')
        },
      },
      define: shared,
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
    },

    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      build: {
        outDir: resolve(__dirname, 'out/renderer'),
        minify: isDev ? undefined : 'oxc',
        // cssMinify: isDev ? undefined : 'oxc',
        rolldownOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            toolbar: resolve(__dirname, 'src/renderer/toolbar.html'),
            screenshot: resolve(__dirname, 'src/renderer/screenshot.html'),
            'log-viewer': resolve(__dirname, 'src/renderer/log-viewer.html'),
          },
        },
        sourcemap: isDev ? 'inline' : false,
      },
      plugins: [
        react(),
        monacoWorkerPlugin(),
        ejsTemplatePlugin({ appConfig, isDev }),
      ],
      define: {
        ...shared,
        ...rendererOnly,
      },
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'src/shared'),
          '@renderer': resolve(__dirname, 'src/renderer'),
          '@': resolve(__dirname, 'src/renderer'),
        },
      },
      optimizeDeps: {
        include: [
          'react',
          'react-dom',
          'react-dom/client',
          'react-router-dom',
          'lucide-react',
          'react-markdown',
          'react-syntax-highlighter',
          'react-syntax-highlighter/dist/esm/styles/prism',
          'remark-gfm',
          'remark-breaks',
          'rehype-raw',
          'immer',
          'clsx',
          'tailwind-merge',
          'monaco-editor',
        ],
      },
      server: {
        port: 39017,
        warmup: {
          clientFiles: [
            './index.tsx',
            './toolbar.tsx',
            './screenshot.tsx',
          ],
        },
      },
    },
  }
})
