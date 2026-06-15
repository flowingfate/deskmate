/**
 * Vite plugin: render EJS templates in HTML files at build time.
 * Uses the `ejs` library. Variables exposed to templates:
 *   - `htmlWebpackPlugin.options.{title, productName, connectSrcExtra, entryScript}`
 *     (legacy namespace kept for template compatibility)
 *   - `connectSrcExtra`, `entryScript` (top-level aliases)
 */
import ejs from 'ejs'
import type { Plugin } from 'vite'

interface PageOptions {
  title: string
  productName: string
  connectSrcExtra: string
  entryScript: string
}

interface EjsTemplatePluginConfig {
  appConfig: { windowTitle: string; productName: string }
  isDev: boolean
}

export function ejsTemplatePlugin({ appConfig, isDev }: EjsTemplatePluginConfig): Plugin {
  const pageOptions: Record<string, PageOptions> = {
    'index.html': {
      title: appConfig.windowTitle,
      productName: appConfig.productName,
      connectSrcExtra: isDev ? ' ws: wss:' : '',
      entryScript: '<script type="module" src="./index.tsx"></script>',
    },
    'toolbar.html': {
      title: `${appConfig.productName} - ToolBar`,
      productName: appConfig.productName,
      connectSrcExtra: isDev ? ' ws: wss:' : '',
      entryScript: '<script type="module" src="./toolbar.tsx"></script>',
    },
    'screenshot.html': {
      title: `${appConfig.productName} - Screenshot`,
      productName: appConfig.productName,
      connectSrcExtra: isDev ? ' ws: wss:' : '',
      entryScript: '<script type="module" src="./screenshot.tsx"></script>',
    },
    'log-viewer.html': {
      title: `${appConfig.productName} - Log Viewer`,
      productName: appConfig.productName,
      connectSrcExtra: isDev ? ' ws: wss:' : '',
      entryScript: '<script type="module" src="./log-viewer.tsx"></script>',
    },
  }

  const fallback: PageOptions = {
    title: appConfig.productName,
    productName: appConfig.productName,
    connectSrcExtra: '',
    entryScript: '',
  }

  return {
    name: 'ejs-template-compat',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const filename = ctx.filename.split('/').pop() || ''
        const opts = pageOptions[filename] || fallback

        return ejs.render(html, {
          htmlWebpackPlugin: { options: opts },
          connectSrcExtra: opts.connectSrcExtra,
          entryScript: opts.entryScript,
        })
      },
    },
  }
}
