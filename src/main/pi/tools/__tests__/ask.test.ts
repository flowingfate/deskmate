/**
 * `ask` LocalTool 单测 —— 覆盖 human-loop 卡片派发内聚回工具本体后的可观察契约。
 *
 * 关键行为(以前散在 `pi/tool.ts` 的 name==='ask' 特判里,现已在 handler 内):
 *   - schema 校验失败 → 直接返回 `{ success: false, error: 'INVALID_INPUT' }`,
 *     **不**派发卡片。
 *   - `eventSender` 为空(JobRun / 测试路径)→ human-loop 退化为"用户跳过",
 *     返回 `status: 'skipped'` 而非挂起。
 *   - 已 abort 的 signal → 同样退化为跳过(不阻塞)。
 */

import { describe, it, expect } from 'vitest';

import { ask } from '../ask';
import type { AgentToolContext } from '../types';
import { Tracer } from '@shared/log/trace';
import { testProfile } from './profileFixture';

function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    profile: testProfile,
    profileId: 'p',
    agentId: 'a',
    sessionId: 's',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: Tracer.noop,
    callId: 'c',
    chunkStream: null,
    ...overrides,
    mode: 'agent',
  };
}

async function run(args: unknown, ctx: ToolContext = makeCtx()): Promise<Record<string, unknown>> {
  const r = await ask.handler(args as never, ctx);
  if (!r.ok) throw new Error(`ask handler unexpected ok=false: ${r.error}`);
  return JSON.parse(r.content);
}

describe('ask LocalTool — schema 校验', () => {
  it('缺 title → INVALID_INPUT,不派发卡片', async () => {
    const out = await run({ schema: { kind: 'choice', mode: 'single', options: [{ value: 'a', label: 'A' }] } });
    expect(out.success).toBe(false);
    expect(out.error).toBe('INVALID_INPUT');
  });

  it('choice minSelections > maxSelections → INVALID_INPUT', async () => {
    const out = await run({
      title: 'pick',
      schema: {
        kind: 'choice', mode: 'multi',
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
        minSelections: 2, maxSelections: 1,
      },
    });
    expect(out.success).toBe(false);
    expect(out.error).toBe('INVALID_INPUT');
  });

  it('form 重复 field key → INVALID_INPUT', async () => {
    const out = await run({
      title: 'form',
      schema: {
        kind: 'form',
        fields: [
          { key: 'dup', label: 'One', control: 'text' },
          { key: 'dup', label: 'Two', control: 'text' },
        ],
      },
    });
    expect(out.success).toBe(false);
    expect(out.error).toBe('INVALID_INPUT');
  });
});

describe('ask LocalTool — human-loop 降级', () => {
  it('eventSender=null → 校验通过的 choice 退化为跳过', async () => {
    const out = await run({
      title: 'pick one',
      schema: { kind: 'choice', mode: 'single', options: [{ value: 'a', label: 'A' }] },
    });
    expect(out).toMatchObject({ success: true, status: 'skipped', request_type: 'choice', skipped_by_user: true });
  });

  it('eventSender=null → 校验通过的 form 退化为跳过', async () => {
    const out = await run({
      title: 'fill',
      schema: { kind: 'form', fields: [{ key: 'name', label: 'Name', control: 'text' }] },
    });
    expect(out).toMatchObject({ success: true, status: 'skipped', request_type: 'form', form_values: null });
  });

  it('已 abort 的 signal → 同样退化为跳过', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await run(
      { title: 'pick', schema: { kind: 'choice', mode: 'single', options: [{ value: 'a', label: 'A' }] } },
      makeCtx({ signal: controller.signal }),
    );
    expect(out).toMatchObject({ success: true, status: 'skipped' });
  });
});
