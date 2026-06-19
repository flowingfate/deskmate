/**
 * Vite plugin: sets up monaco-editor Web Workers.
 *
 * Why a Vite plugin instead of regular source code under src/renderer/:
 *   - The `?worker` suffix is a Vite-specific resolver hint. Keeping the setup
 *     code out of `src/` makes it explicit that this is build-tool plumbing.
 *
 * Implementation mechanism:
 *
 * 1. Expose the setup script to Vite via a virtual module (virtual: prefix + null-byte resolved id).
 *    The script imports each language worker entry with the `?worker` suffix; Vite bundles them
 *    into separate chunks.
 * 2. Dev: inject via `/@id/__x00__virtual:monaco-setup` in transformIndexHtml
 *    (this is the Vite dev-server convention for resolving virtual module URLs).
 * 3. Build: add the virtual module as an extra entry via rollupOptions.input so Rollup
 *    emits a hash-named chunk; then in the generateBundle phase replace the placeholder
 *    in index.html with the final chunk's relative path.
 *
 * When monaco starts a worker it reads the global `self.MonacoEnvironment.getWorker(_, label)`.
 * See call chain: node_modules/monaco-editor/esm/vs/base/browser/webWorkerFactory.js
 *
 * Only applies to index.html — the screenshot entry does not use monaco.
 */

import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:monaco-setup'
const RESOLVED_ID = '\0' + VIRTUAL_ID
const INPUT_KEY = 'monaco-setup'

const SETUP_CODE = `
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      default:
        return new EditorWorker()
    }
  },
}
`

export function monacoWorkerPlugin(): Plugin {
  let isBuild = false

  return {
    name: 'monaco-worker-setup',

    config(_userConfig, env) {
      isBuild = env.command === 'build'
      // Build: add the virtual module as an extra entry into rollupOptions.input
      // so Rollup actually emits a hash-named chunk.
      if (!isBuild) return
      return {
        build: {
          rollupOptions: {
            input: {
              [INPUT_KEY]: VIRTUAL_ID,
            },
          },
        },
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },

    load(id) {
      if (id === RESOLVED_ID) return SETUP_CODE
      return null
    },

    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const filename = ctx.filename.split('/').pop() || ''
        if (filename !== 'index.html') return html

        if (!isBuild) {
          // Dev: use Vite's virtual module URL convention directly
          const tag = `<script type="module" src="/@id/__x00__${VIRTUAL_ID}"></script>`
          return html.replace('</head>', `  ${tag}\n  </head>`)
        }

        // Build: find the chunk we emitted in the bundle and inject the actual path
        const bundle = ctx.bundle
        if (!bundle) return html
        const chunk = Object.values(bundle).find(
          (c) => c.type === 'chunk' && c.isEntry && c.name === INPUT_KEY,
        )
        if (!chunk || chunk.type !== 'chunk') return html

        const tag = `<script type="module" crossorigin src="./${chunk.fileName}"></script>`
        return html.replace('</head>', `  ${tag}\n  </head>`)
      },
    },
  }
}
