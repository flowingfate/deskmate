/**
 * Source-grep regression guards for Bing 搜索 kernel 的 timeout 修复。
 *
 * 历史 issue:Bing/Google 页面挂着大量异步加载(广告、tracking、动态内容),
 * `'networkidle'` 等待策略会卡到 60s 超时 — 搜索表面看像"没结果"。
 *
 * 修复:把 `page.goto({ waitUntil: ... })` 与 `waitForLoadState(...)` 从
 * `'networkidle'` 切到 `'domcontentloaded'`,再 `waitForSelector('li.b_algo')`
 * 显式等结果出现。
 *
 * 这两条断言通过 grep kernel 源文件保证修复在位 — 比 e2e 跑实际搜索成本
 * 低三个数量级,又不会被 mock 假阳性掩盖。
 *
 * 历史路径:`pi/tools/__tests__/bingSearchTimeout.test.ts` →
 *     `appcmd/__tests__/web/bingSearchTimeout.test.ts`(web 域迁移时同步搬过来)。
 * 路径常量也对齐到新 kernel 位置。
 */

import * as fs from 'fs';
import * as path from 'path';

const KERNEL_DIR = path.join(__dirname, '..', '..', 'builtins', 'web', 'kernel');

describe('Bing web search kernel - timeout fix verification', () => {
  const implFilePath = path.join(KERNEL_DIR, 'bingWebSearch.ts');
  let implSourceCode: string;

  beforeAll(() => {
    implSourceCode = fs.readFileSync(implFilePath, 'utf-8');
  });

  describe('page.goto() wait strategy', () => {
    it('uses domcontentloaded (NOT networkidle) for every page.goto', () => {
      const gotoPattern = /page\.goto\([^)]+waitUntil:\s*['"](\w+)['"]/g;
      const matches = [...implSourceCode.matchAll(gotoPattern)];
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match[1]).toBe('domcontentloaded');
      }
    });

    it('has zero `page.goto({ waitUntil: networkidle })` call sites', () => {
      const badPattern = /page\.goto\([^)]+waitUntil:\s*['"]networkidle['"]/;
      expect(implSourceCode).not.toMatch(badPattern);
    });
  });

  describe('waitForLoadState calls', () => {
    it('uses domcontentloaded for every waitForLoadState; zero networkidle', () => {
      const loadStatePattern = /waitForLoadState\(\s*['"](\w+)['"]/g;
      const matches = [...implSourceCode.matchAll(loadStatePattern)];
      const domContentLoadedCalls = matches.filter((m) => m[1] === 'domcontentloaded');
      expect(domContentLoadedCalls.length).toBeGreaterThan(0);
      const networkIdleCalls = matches.filter((m) => m[1] === 'networkidle');
      expect(networkIdleCalls.length).toBe(0);
    });
  });

  describe('search result selector waiting', () => {
    it("waits for li.b_algo selector for search results", () => {
      expect(implSourceCode).toContain("waitForSelector('li.b_algo'");
    });

    it('falls back gracefully on selector timeout (not throw)', () => {
      expect(implSourceCode).toContain('Timed out waiting for search results selector, trying to continue');
    });
  });

  describe('page stability handling', () => {
    it('does not throw on page-not-stable', () => {
      expect(implSourceCode).toContain('Page did not fully stabilize, but continuing to parse results');
      expect(implSourceCode).not.toContain("throw new Error('页面未能稳定，可能仍在导航中')");
    });
  });

  describe('timeout configuration', () => {
    it('caps selector wait below page timeout (Math.min(timeout, …) <= 30s)', () => {
      const selectorTimeoutPattern = /waitForSelector\([^)]+timeout:\s*Math\.min\(timeout,\s*(\d+)\)/;
      const match = implSourceCode.match(selectorTimeoutPattern);
      expect(match).toBeTruthy();
      if (match) {
        expect(parseInt(match[1], 10)).toBeLessThanOrEqual(30000);
      }
    });
  });
});

describe('Bing image search kernel - timeout fix verification', () => {
  const implFilePath = path.join(KERNEL_DIR, 'bingImageSearch.ts');
  const implSourceCode = fs.readFileSync(implFilePath, 'utf-8');

  it('has zero `page.goto({ waitUntil: networkidle })` call sites', () => {
    const badPattern = /page\.goto\([^)]+waitUntil:\s*['"]networkidle['"]/;
    expect(implSourceCode).not.toMatch(badPattern);
  });

  it('has zero `waitForLoadState networkidle` call sites', () => {
    const loadStatePattern = /waitForLoadState\(\s*['"]networkidle['"]/g;
    const matches = [...implSourceCode.matchAll(loadStatePattern)];
    expect(matches.length).toBe(0);
  });
});
