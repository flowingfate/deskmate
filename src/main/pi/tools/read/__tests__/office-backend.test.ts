/**
 * `read` 工具的 office backend 测试 —— 验证 selector(pages + lines)正确
 * 翻译成 impl 的 startPage / endPage / startLine / endLine。
 *
 * 用 vi.mock 拦截 `impl/readOfficeFile` —— 真 impl 顶层 import 了 mammoth /
 * jszip / pdfreader(~1MB),不应在测试中真触发。mock 提供一个 stub
 * ReadOfficeFileTool 类,我们断言它收到的 args 形态。
 *
 * 单独文件不与 `read-tool.test.ts` 合并是为了 vi.mock 的隔离 ——
 * mock 是 file-scoped 的,合并会污染 filesystem/internal-url 测试。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock 必须在 import readOffice 之前注册。`vi.mock` 被 hoist 到 file 顶部
// (vitest 文档)。**关键:mock path 必须与被测代码内部 import 字符串字面
// 一致** —— office.ts 用 `'../impl/readOfficeFile'`(相对 backends/),从
// 测试视角(__tests__/)同样是 `'../impl/readOfficeFile'`(__tests__/ 与
// backends/ 都是 read/ 的子目录,各自向上一层都到 read/,再进 impl/)。
vi.mock('../impl/readOfficeFile', () => {
  const executeMock = vi.fn(async (args: Record<string, unknown>) => ({
    content: 'mocked content',
    fileName: 'mock.pdf',
    startLine: typeof args.startLine === 'number' ? args.startLine : 1,
    endLine: typeof args.endLine === 'number' ? args.endLine : 1,
    totalLines: 100,
    size: 14,
    truncated: false,
    startPage: typeof args.startPage === 'number' ? args.startPage : 1,
    endPage: typeof args.endPage === 'number' ? args.endPage : 1,
    totalPages: 10,
    // expose 收到的 args 让测试断言(测试通过 lastCall 拿到)
    receivedArgs: args,
  }));
  class ReadOfficeFileTool {
    static execute = executeMock;
  }
  return { ReadOfficeFileTool };
});

import { readOffice } from '../backends/office';
import type { ToolContext } from '../../types';
import { Tracer } from '@shared/log/trace';

function makeCtx(): ToolContext {
  return {
    mode: 'agent',
    profileId: 'p',
    agentId: 'a',
    sessionId: 's',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: Tracer.noop,
    callId: 'c',
    chunkStream: null,
  };
}

// 拿到 mock execute(从 mock module 提取)
async function getExecuteMock() {
  const mod = await import('../impl/readOfficeFile');
  return (mod.ReadOfficeFileTool as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
}

beforeEach(async () => {
  const m = await getExecuteMock();
  m.mockClear();
});

describe('readOffice backend — selector → impl args translation', () => {
  it('无 selector → impl 收到只有 filePath,startLine/endLine/startPage/endPage 全 undefined', async () => {
    await readOffice(
      { path: '/tmp/report.pdf', selector: { ranges: [], pages: [], raw: false } },
      makeCtx(),
    );
    const exec = await getExecuteMock();
    expect(exec).toHaveBeenCalledTimes(1);
    const callArgs = exec.mock.calls[0][0];
    expect(callArgs.filePath).toBe('/tmp/report.pdf');
    expect(callArgs.startLine).toBeUndefined();
    expect(callArgs.endLine).toBeUndefined();
    expect(callArgs.startPage).toBeUndefined();
    expect(callArgs.endPage).toBeUndefined();
  });

  it('行号 range → impl 收到 startLine/endLine,page 字段不带', async () => {
    await readOffice(
      {
        path: '/tmp/report.pdf',
        selector: {
          ranges: [{ startLine: 50, endLine: 100 }],
          pages: [],
          raw: false,
        },
      },
      makeCtx(),
    );
    const exec = await getExecuteMock();
    const callArgs = exec.mock.calls[0][0];
    expect(callArgs.startLine).toBe(50);
    expect(callArgs.endLine).toBe(100);
    expect(callArgs.startPage).toBeUndefined();
    expect(callArgs.endPage).toBeUndefined();
  });

  it('page range → impl 收到 startPage/endPage,行号字段不带', async () => {
    await readOffice(
      {
        path: '/tmp/report.pdf',
        selector: {
          ranges: [],
          pages: [{ startLine: 3, endLine: 7 }], // page range 借用 LineRange shape
          raw: false,
        },
      },
      makeCtx(),
    );
    const exec = await getExecuteMock();
    const callArgs = exec.mock.calls[0][0];
    expect(callArgs.startPage).toBe(3);
    expect(callArgs.endPage).toBe(7);
    expect(callArgs.startLine).toBeUndefined();
    expect(callArgs.endLine).toBeUndefined();
  });

  it('page + line 组合 → impl 同时收到四个边界', async () => {
    await readOffice(
      {
        path: '/tmp/report.pdf',
        selector: {
          ranges: [{ startLine: 50, endLine: 100 }],
          pages: [{ startLine: 3, endLine: 7 }],
          raw: false,
        },
      },
      makeCtx(),
    );
    const exec = await getExecuteMock();
    const callArgs = exec.mock.calls[0][0];
    expect(callArgs.startPage).toBe(3);
    expect(callArgs.endPage).toBe(7);
    expect(callArgs.startLine).toBe(50);
    expect(callArgs.endLine).toBe(100);
  });

  it('open-ended page range(pN-)→ endPage undefined', async () => {
    await readOffice(
      {
        path: '/tmp/report.pdf',
        selector: {
          ranges: [],
          pages: [{ startLine: 5, endLine: undefined }],
          raw: false,
        },
      },
      makeCtx(),
    );
    const exec = await getExecuteMock();
    const callArgs = exec.mock.calls[0][0];
    expect(callArgs.startPage).toBe(5);
    expect(callArgs.endPage).toBeUndefined();
  });

  it('ctx.signal 透传给 impl 的 options', async () => {
    const ctrl = new AbortController();
    const ctx = { ...makeCtx(), signal: ctrl.signal };
    await readOffice(
      { path: '/tmp/report.pdf', selector: { ranges: [], pages: [], raw: false } },
      ctx,
    );
    const exec = await getExecuteMock();
    const callOpts = exec.mock.calls[0][1];
    expect(callOpts.signal).toBe(ctrl.signal);
  });

  it('impl 缓存:首调后第二次不再 dynamic import(同一个 mock execute 收两次 call)', async () => {
    const args = {
      path: '/tmp/report.pdf',
      selector: { ranges: [], pages: [], raw: false },
    };
    await readOffice(args, makeCtx());
    await readOffice(args, makeCtx());
    const exec = await getExecuteMock();
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
