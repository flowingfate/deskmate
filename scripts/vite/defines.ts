/**
 * Compile-time replacements for Vite `define`.
 */

export function sharedDefines(mode: string): Record<string, string> {
  return {
    'process.env.NODE_ENV': JSON.stringify(mode),
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
