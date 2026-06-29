declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  type GfmPlugin = TurndownService.Plugin;
  export const gfm: GfmPlugin;
  export const tables: GfmPlugin;
  export const strikethrough: GfmPlugin;
  export const taskListItems: GfmPlugin;
  export const highlightedCodeBlock: GfmPlugin;
}
