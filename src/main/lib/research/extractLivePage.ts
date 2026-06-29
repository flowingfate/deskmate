// research live view 的薄封装：调用共享 `extractFromWebContents`（保留选区模式），
// 套上 sourceId 即得 InteractiveSearchSource。正文质量、元数据、截断、字段兜底
// 全由共享提取层负责，research 侧只管去重/排序/确认。

import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { InteractiveSearchSource } from '@shared/types/interactiveRequestTypes';
import { extractFromWebContents } from '@main/lib/research/extract/extractFromWebContents'

export interface ExtractLivePageOptions {
  selectedTextOnly: boolean;
}

export async function extractLivePage(
  webContents: WebContents,
  options: ExtractLivePageOptions,
): Promise<InteractiveSearchSource> {
  const content = await extractFromWebContents(webContents, {
    selectedTextOnly: options.selectedTextOnly,
  });
  return { sourceId: `src_${randomUUID()}`, ...content };
}
