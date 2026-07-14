// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useDirtyTracker,
  setEquals,
  setFingerprint,
  mapEquals,
  mapFingerprint,
} from '../useDirtyTracker'
import type { AgentConfig } from '../types'

describe('dirty 比较 helpers', () => {
  it('setEquals 顺序无关，基数不同即不等', () => {
    expect(setEquals(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
    expect(setEquals(new Set(['a']), new Set(['a', 'b']))).toBe(false)
    expect(setEquals(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false)
    expect(setEquals(new Set<string>(), new Set<string>())).toBe(true)
  })

  it('setFingerprint 对顺序不敏感（规范化排序）', () => {
    expect(setFingerprint(new Set(['b', 'a', 'c']))).toBe(setFingerprint(new Set(['c', 'a', 'b'])))
    expect(setFingerprint(new Set(['a']))).not.toBe(setFingerprint(new Set(['b'])))
  })

  it('mapEquals 按 missing 归一缺席键', () => {
    const a = new Map([['x', 'live']])
    const b = new Map([['x', 'live'], ['y', 'off']])
    // 缺席键 y 在 a 中按 'off' 归一 ⇒ 等价
    expect(mapEquals(a, b, 'off')).toBe(true)
    // 值不同 ⇒ 不等
    expect(mapEquals(new Map([['x', 'live']]), new Map([['x', 'lazy']]), 'off')).toBe(false)
    // 无 missing 时基数不同即不等
    expect(mapEquals(a, b)).toBe(false)
  })

  it('mapFingerprint 按键排序，规范化顺序', () => {
    const a = new Map([['b', 1], ['a', 2]])
    const b = new Map([['a', 2], ['b', 1]])
    expect(mapFingerprint(a)).toBe(mapFingerprint(b))
  })
})

// 驱动 hook 的最小 harness：模拟父组件持有 agentData + 上报回调。
type Model = Set<string>
function makeOptions(overrides: Partial<Parameters<typeof useDirtyTracker<Model>>[0]> = {}) {
  const onDataChange = vi.fn()
  const base = {
    tabName: 'tools' as const,
    ready: true,
    agentId: 'agent-1',
    baseline: new Set(['a', 'b']) as Model,
    cached: null as Model | null,
    equals: setEquals,
    fingerprint: setFingerprint,
    toPayload: (set: Model): Partial<AgentConfig> => ({ tools: Array.from(set) }),
    onDataChange,
    ...overrides,
  }
  return { base, onDataChange }
}

describe('useDirtyTracker 状态机', () => {
  it('首次 hydrate：clean，value == baseline，上报 hasChanges=false', () => {
    const { base, onDataChange } = makeOptions()
    const { result } = renderHook(() => useDirtyTracker(base))

    expect(result.current.hasChanges).toBe(false)
    expect(Array.from(result.current.value).sort()).toEqual(['a', 'b'])
    // 首帧上报一次，hasChanges=false
    const last = onDataChange.mock.calls.at(-1)
    expect(last?.[2]).toBe(false)
  })

  it('cachedData 优先填充 value，且相对基线视为脏', () => {
    const { base } = makeOptions({ cached: new Set(['a']) })
    const { result } = renderHook(() => useDirtyTracker(base))

    expect(Array.from(result.current.value)).toEqual(['a'])
    expect(result.current.hasChanges).toBe(true)
  })

  it('本地编辑 → 脏；改回基线 → 干净', () => {
    const { base } = makeOptions()
    const { result } = renderHook(() => useDirtyTracker(base))

    act(() => result.current.setValue(new Set(['a'])))
    expect(result.current.hasChanges).toBe(true)

    act(() => result.current.setValue(new Set(['a', 'b'])))
    expect(result.current.hasChanges).toBe(false)
  })

  it('保存路径：value 落盘后新基线到达 → 脏态就地归零（无需 remount）', () => {
    const { base } = makeOptions()
    const { result, rerender } = renderHook((props: typeof base) => useDirtyTracker(props), {
      initialProps: base,
    })

    // 用户编辑
    act(() => result.current.setValue(new Set(['a'])))
    expect(result.current.hasChanges).toBe(true)

    // 父组件保存成功：agentData 更新，新基线 == 已保存的 value
    rerender({ ...base, baseline: new Set(['a']), cached: null })

    expect(result.current.hasChanges).toBe(false)
    expect(Array.from(result.current.value)).toEqual(['a'])
  })

  it('无本地编辑时外部更新 → value 静默跟随新基线', () => {
    const { base } = makeOptions()
    const { result, rerender } = renderHook((props: typeof base) => useDirtyTracker(props), {
      initialProps: base,
    })

    expect(result.current.hasChanges).toBe(false)
    // 外部改动（如另一窗口保存），无本地编辑
    rerender({ ...base, baseline: new Set(['a', 'b', 'c']) })

    expect(Array.from(result.current.value).sort()).toEqual(['a', 'b', 'c'])
    expect(result.current.hasChanges).toBe(false)
  })

  it('有本地编辑时外部并发改动 → 保留本地 value，脏态相对最新真值', () => {
    const { base } = makeOptions()
    const { result, rerender } = renderHook((props: typeof base) => useDirtyTracker(props), {
      initialProps: base,
    })

    act(() => result.current.setValue(new Set(['a'])))
    // 外部把基线改成完全不同的东西；本地编辑不应被吞
    rerender({ ...base, baseline: new Set(['x', 'y']) })

    expect(Array.from(result.current.value)).toEqual(['a'])
    expect(result.current.hasChanges).toBe(true)
  })

  it('切换 agentId → 重新 hydrate 到新基线，脏态清零', () => {
    const { base } = makeOptions()
    const { result, rerender } = renderHook((props: typeof base) => useDirtyTracker(props), {
      initialProps: base,
    })

    act(() => result.current.setValue(new Set(['a'])))
    expect(result.current.hasChanges).toBe(true)

    rerender({ ...base, agentId: 'agent-2', baseline: new Set(['p', 'q']) })

    expect(Array.from(result.current.value).sort()).toEqual(['p', 'q'])
    expect(result.current.hasChanges).toBe(false)
  })

  it('未 ready 时不 hydrate、不上报', () => {
    const { base, onDataChange } = makeOptions({ ready: false })
    const { result } = renderHook(() => useDirtyTracker(base))

    expect(result.current.hasChanges).toBe(false)
    expect(onDataChange).not.toHaveBeenCalled()
  })
})
