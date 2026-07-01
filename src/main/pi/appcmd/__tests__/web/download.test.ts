/**
 * `web download` subcommand 测试。
 * 覆盖:positional <url> <filename> 必填 / --max-size + --timeout 校验与单位换算
 * (秒→ms)/ --dir + --overwrite 透传 / 成功登记 deliverable / --json 透传 /
 * 失败 exit 1 / 内核 throw 处理。
 *
 * 内核 `downloadFileInternal` 被 `_fixture` mock —— 测试走真实 dispatcher +
 * flag 解析 + CLI,只在内核边界打桩。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetWebMocks, runWeb, webMocks } from './_fixture';

beforeEach(() => {
  resetWebMocks();
});

function okResult(fileUri: string): unknown {
  return {
    success: true,
    fileUri,
    fileSize: 2048,
    mimeType: 'image/png',
    downloadTime: 12,
    timestamp: new Date().toISOString(),
  };
}

function failResult(error: string): unknown {
  return {
    success: false,
    fileUri: '',
    fileSize: 0,
    downloadTime: 5,
    error,
    timestamp: new Date().toISOString(),
  };
}

describe('web download — args parsing', () => {
  it('缺 url positional → exit 2,不调内核', async () => {
    const r = await runWeb('download');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('<url> argument required');
    expect(webMocks.downloadFileInternal).not.toHaveBeenCalled();
  });

  it('缺 filename positional → exit 2', async () => {
    const r = await runWeb('download https://example.com/a.png');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('<filename> argument required');
    expect(webMocks.downloadFileInternal).not.toHaveBeenCalled();
  });

  it('多余 positional → exit 2', async () => {
    const r = await runWeb('download https://example.com/a.png a.png extra.png');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('too many positional args');
  });

  it('--max-size 非整数 → exit 2', async () => {
    const r = await runWeb('download https://example.com/a.png a.png --max-size abc');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--max-size must be an integer');
    expect(webMocks.downloadFileInternal).not.toHaveBeenCalled();
  });

  it('--timeout 超范围 → exit 2', async () => {
    const r = await runWeb('download https://example.com/a.png a.png --timeout 9999');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--timeout must be an integer between');
  });

  it('--timeout 秒 → 内核收到 ms', async () => {
    webMocks.downloadFileInternal.mockResolvedValueOnce(okResult('local://a.png'));
    await runWeb('download https://example.com/a.png a.png --timeout 45');
    expect(webMocks.downloadFileInternal.mock.calls[0][0]).toMatchObject({
      url: 'https://example.com/a.png',
      filename: 'a.png',
      timeout: 45000,
    });
  });

  it('--dir + --max-size + --overwrite 透传内核', async () => {
    webMocks.downloadFileInternal.mockResolvedValueOnce(okResult('knowledge://reports/q3.json'));
    await runWeb('download https://example.com/q3.json q3.json --dir knowledge://reports --max-size 524288 --overwrite');
    expect(webMocks.downloadFileInternal.mock.calls[0][0]).toMatchObject({
      url: 'https://example.com/q3.json',
      filename: 'q3.json',
      saveDirectory: 'knowledge://reports',
      maxSizeBytes: 524288,
      overwrite: true,
    });
  });
});

describe('web download — output + deliverables', () => {
  it('成功 → exit 0,登记 deliverable,人话输出含 fileUri', async () => {
    webMocks.downloadFileInternal.mockResolvedValueOnce(okResult('local://photo.png'));
    const r = await runWeb('download https://example.com/photo.png photo.png');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('local://photo.png');
    expect(r.deliverables).toEqual(['local://photo.png']);
  });

  it('--json → 透传结构化结果,且仍登记 deliverable', async () => {
    webMocks.downloadFileInternal.mockResolvedValueOnce(okResult('local://photo.png'));
    const r = await runWeb('download https://example.com/photo.png photo.png --json');
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed).toMatchObject({ success: true, fileUri: 'local://photo.png' });
    expect(r.deliverables).toEqual(['local://photo.png']);
  });

  it('内核回 success:false → exit 1,不登记 deliverable', async () => {
    webMocks.downloadFileInternal.mockResolvedValueOnce(failResult('HTTP 404: Not Found'));
    const r = await runWeb('download https://example.com/missing.png missing.png');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('HTTP 404');
    expect(r.deliverables).toEqual([]);
  });

  it('内核 throw → dispatcher 收敛为 exit 1', async () => {
    webMocks.downloadFileInternal.mockRejectedValueOnce(new Error('boom'));
    const r = await runWeb('download https://example.com/a.png a.png');
    expect(r.exitCode).toBe(1);
    expect(r.content).toContain('boom');
    expect(r.deliverables).toEqual([]);
  });
});
