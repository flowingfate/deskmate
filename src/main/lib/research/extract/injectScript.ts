// 运行时读取并 memoize extractor IIFE 产物字符串（`out/preload/extractor.js`）。
// 读一次、零持续开销；动态注入 API 只吃 code string，故必须读成 string。

import fs from 'node:fs';
import { INJECT_PATH } from '@main/lib/buildPaths';

let cached: string | null = null;

export function getExtractorScript(): string {
  if (cached === null) {
    cached = fs.readFileSync(INJECT_PATH.extractor, 'utf8');
  }
  return cached;
}
