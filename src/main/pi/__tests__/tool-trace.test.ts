import { describe, it, expect, vi, beforeEach } from 'vitest';

import { log } from '@main/log';

// 限定名 route 强制走 MCP 路径，验证 executeToolCall 用 route 中的原始
// toolName 调 MCP，而非直接把 LLM-facing name 传入。
vi.mock('@main/pi/mcp', () => ({
  executeMcpToolOnServer: vi.fn(),
  listAllMcpTools: vi.fn().mockResolvedValue([]),
}));

import { executeToolCall, ToolCatalog, type ToolCallInput } from '../tool';
import type { ToolContext } from '../tools/types';
import { Tracer } from '@shared/log/trace';
import { executeMcpToolOnServer } from '../mcp';

const mockedExecMcp = vi.mocked(executeMcpToolOnServer);

function makeCatalog(toolName: string): ToolCatalog {
  return new ToolCatalog(
    [],
    new Map([[toolName, { kind: 'mcp', serverName: 'srv1', toolName: 'actual_tool' }]]),
  );
}

function makeCtx(call: ToolCallInput, tracer: Tracer): ToolContext {
  // chat.tool span 由 caller derive 后注入(实际 turn loop 也是这么做),不在 executeToolCall 内部 derive。
  const toolTracer = tracer.derive().bind({
    mod: 'chat.tool',
    chatSessionId: 's_test',
    agentId: 'a_test',
    profileId: 'p_test',
    toolName: call.name,
    callId: call.id,
  });
  return {
    mode: 'agent',
    profileId: 'p_test',
    agentId: 'a_test',
    sessionId: 's_test',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: toolTracer,
    callId: call.id,
    chunkStream: null,
  };
}

// 仅断言"主链路日志带 trace 字段"。executeMcpToolOnServer 完全 mocked,不触网络。
describe('executeToolCall — chat.tool span', () => {
  beforeEach(() => {
    mockedExecMcp.mockReset();
    vi.restoreAllMocks();
  });

  it('emits chat.tool start + ok with tid/sid/psid on success', async () => {
    mockedExecMcp.mockResolvedValue('result-content');
    const infoSpy = vi.spyOn(log, 'info');

    // upstream "chat.turn" tracer —— derive 一个 sid 出来,模拟 turn loop。
    const parent = Tracer.startWithSpan('turn');
    const call: ToolCallInput = { id: 'call_1', name: 'foo', arguments: { x: 1 } };
    await executeToolCall(call, makeCatalog(call.name), makeCtx(call, parent));
    expect(mockedExecMcp).toHaveBeenCalledWith('srv1', 'actual_tool', { x: 1 }, expect.any(AbortSignal));

    const calls = infoSpy.mock.calls.map(([f]) => f as Record<string, unknown>);
    const start = calls.find((c) => c.mod === 'chat.tool' && c.msg === 'tool start');
    const ok = calls.find((c) => c.mod === 'chat.tool' && c.msg === 'tool ok');
    expect(start).toBeDefined();
    expect(ok).toBeDefined();
    expect(start?.tid).toBe(parent.tid);
    expect(start?.psid).toBe('turn');
    expect(start?.toolName).toBe('foo');
    expect(start?.sid).toEqual(ok?.sid);
    expect(typeof ok?.dur).toBe('number');
    expect(ok?.isError).toBe(false);
    expect(ok?.contentBytes).toBe('result-content'.length);
  });

  it('emits chat.tool failed (WARN) with errClass/isError on throw', async () => {
    mockedExecMcp.mockRejectedValue(new Error('boom'));
    const warnSpy = vi.spyOn(log, 'warn');

    const parent = Tracer.startWithSpan('turn');
    const call: ToolCallInput = { id: 'call_2', name: 'bar', arguments: {} };
    const result = await executeToolCall(call, makeCatalog(call.name), makeCtx(call, parent));

    expect(result.isError).toBe(true);
    const failed = warnSpy.mock.calls
      .map(([f]) => f as Record<string, unknown>)
      .find((c) => c.mod === 'chat.tool' && c.msg === 'tool failed');
    expect(failed).toBeDefined();
    expect(failed?.tid).toBe(parent.tid);
    expect(failed?.isError).toBe(true);
    expect(failed?.toolName).toBe('bar');
  });

  it('emits chat.tool logs without tid/sid when ctx tracer is noop', async () => {
    mockedExecMcp.mockResolvedValue('x');
    const infoSpy = vi.spyOn(log, 'info');

    // 模拟"调用方走 Tracer.noop"路径(命令行 / 测试 / 非 chat IPC):chat.tool
    // 日志仍要写,只是没有 tid/sid/psid/dur 字段。
    const call: ToolCallInput = { id: 'c', name: 'noop', arguments: {} };
    const noopCtx: ToolContext = {
      mode: 'agent',
      profileId: 'p',
      agentId: 'a',
      sessionId: 's',
      signal: new AbortController().signal,
      eventSender: null,
      tracer: Tracer.noop.derive().bind({
        mod: 'chat.tool',
        chatSessionId: 's',
        agentId: 'a',
        profileId: 'p',
        toolName: call.name,
        callId: call.id,
      }),
      callId: call.id,
      chunkStream: null,
    };
    await executeToolCall(call, makeCatalog(call.name), noopCtx);

    const chatToolLogs = infoSpy.mock.calls
      .map(([f]) => f as Record<string, unknown>)
      .filter((c) => c.mod === 'chat.tool');
    expect(chatToolLogs).toHaveLength(2);
    const [start, ok] = chatToolLogs;
    expect(start.msg).toBe('tool start');
    expect(ok.msg).toBe('tool ok');
    for (const entry of chatToolLogs) {
      expect(entry.tid).toBeUndefined();
      expect(entry.sid).toBeUndefined();
      expect(entry.psid).toBeUndefined();
      // 业务字段必须保留,否则后续 mod=chat.tool 过滤拿不到这些行。
      expect(entry.toolName).toBe('noop');
      expect(entry.profileId).toBe('p');
      expect(entry.agentId).toBe('a');
      expect(entry.chatSessionId).toBe('s');
    }
    expect(ok.dur).toBeUndefined();
  });
});
