/**
 * Compile-time replacements for Vite `define`.
 */

export function sharedDefines(mode: string): Record<string, string> {
  // 注入 root package.json 的 version。dev 用 out/main/bootstrap.js 作 entry，
  // appPath 无 package.json，app.getVersion() 会回退成 Electron bundle 版本，
  // 故版本号一律走构建期常量，仅在 define 缺失时回退 app.getVersion()。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const version: string = require('../../package.json').version;
  return {
    'process.env.NODE_ENV': JSON.stringify(mode),
    '__APP_VERSION__': JSON.stringify(version),
  }
}

export function rendererOnlyDefines(): Record<string, string> {
  return {
    'global': 'globalThis',
    'window.global': 'globalThis',
    'process.platform': JSON.stringify(process.platform),
    'process.versions': JSON.stringify(process.versions),
    'process.argv': '[]',
    'process.browser': 'true',
  }
}
