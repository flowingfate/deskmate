import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AgentConfig, AgentEditorTabName } from './types'

/**
 * useDirtyTracker —— agent 编辑器各 Tab 共用的「脏值追踪」状态机。
 *
 * 把此前 6 个 Tab 各自手抄的样板收敛到一处：
 *  1. value（可编辑副本）+ baseline（原始基线）双 state；
 *  2. 首次挂载 hydrate（cachedData 优先，用于跨 Tab 切换保留未存编辑）；
 *  3. hasChanges = `!equals(value, baseline)`（比较逻辑由调用方按数据形状注入）；
 *  4. 向父组件 onDataChange 上报时用 fingerprint 去重，避免每次 render 重复通知触发循环；
 *  5. **基线随外部内容 re-sync**，取代旧的「保存后 bump key 强制 remount」反模式——
 *     保存 / 外部改动后 agentData 变化即就地刷新基线，保留组件本地 UI state。
 *
 * 泛型 M 是 Tab 的领域模型（string / Set / Map / 普通对象），三个纯函数由调用方注入：
 *  - equals：判定两个模型是否等价（脏比较），需与数据形状匹配（顺序无关等语义）。
 *  - fingerprint：模型 → 稳定字符串指纹，用于上报去重与基线变化检测。SHOULD 规范化（如集合排序）。
 *  - toPayload：模型 → 上报给父组件的 `Partial<AgentConfig>` 补丁。
 *
 * baseline re-sync 语义（agentData 内容变化触发）：
 *  - 若变化前 value 与旧 baseline 一致（用户无本地编辑）⇒ value 跟随新 baseline（静默采纳外部/保存结果）。
 *  - 若 value 已偏离旧 baseline（有未存编辑）⇒ 只更新 baseline，保留 value，hasChanges 重新对齐到最新真值
 *    （保存成功时新 baseline == value ⇒ 脏态自动归零；并发外部改动时 ⇒ 脏态如实反映差异）。
 */
export interface DirtyTrackerOptions<M> {
  /** 此 Tab 的名字，上报 onDataChange 时透传。 */
  tabName: AgentEditorTabName
  /** 依赖数据是否就绪（如工具/技能列表已加载、agentData.id 存在）。未就绪时不 hydrate、不上报。 */
  ready: boolean
  /** agent 身份；变化时视为切换编辑对象，重跑 hydrate。 */
  agentId: string | undefined
  /** 由 agentData（+外部数据）派生的原始基线模型。 */
  baseline: M
  /** 由 cachedData 派生的编辑缓存模型；无缓存传 null。仅首次 hydrate 时消费。 */
  cached: M | null
  /** 脏比较：两个模型是否等价。 */
  equals: (a: M, b: M) => boolean
  /** 模型 → 稳定字符串指纹（规范化，用于上报去重与基线变化检测）。 */
  fingerprint: (value: M) => string
  /** 模型 → 上报给父组件的补丁。 */
  toPayload: (value: M) => Partial<AgentConfig>
  /** 父组件的变更回调。 */
  onDataChange?: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void
}

export interface DirtyTracker<M> {
  /** 当前编辑中的模型。 */
  value: M
  /** 更新模型（与 useState setter 语义一致，支持函数式更新）。 */
  setValue: Dispatch<SetStateAction<M>>
  /** value 是否偏离基线。 */
  hasChanges: boolean
  /** 是否已完成首次 hydrate（未就绪前渲染可据此显示空态/加载态）。 */
  initialized: boolean
}

export function useDirtyTracker<M>(opts: DirtyTrackerOptions<M>): DirtyTracker<M> {
  const { tabName, ready, agentId, baseline, cached, equals, fingerprint, toPayload, onDataChange } = opts

  const [value, setValue] = useState<M>(baseline)
  const [baselineState, setBaselineState] = useState<M>(baseline)
  const [initialized, setInitialized] = useState(false)

  // 最新值/纯函数放进 ref，让副作用只依赖原始指纹（primitive）而非每帧变身的闭包/引用。
  const valueRef = useRef(value)
  valueRef.current = value
  const baselineRef = useRef(baselineState)
  baselineRef.current = baselineState
  const equalsRef = useRef(equals)
  equalsRef.current = equals
  const toPayloadRef = useRef(toPayload)
  toPayloadRef.current = toPayload
  const onDataChangeRef = useRef(onDataChange)
  onDataChangeRef.current = onDataChange
  const loadedAgentIdRef = useRef<string | undefined>(undefined)

  const hasChanges = ready && initialized ? !equals(value, baselineState) : false

  // hydrate / 基线 re-sync：仅依赖 primitive 指纹，避免模型引用抖动导致的重复触发。
  const baselineFp = ready ? fingerprint(baseline) : null
  const cachedFp = cached != null ? fingerprint(cached) : null
  useEffect(() => {
    if (!ready) return

    const isFreshMount = !initialized || loadedAgentIdRef.current !== agentId
    if (isFreshMount) {
      loadedAgentIdRef.current = agentId
      setBaselineState(baseline)
      setValue(cached != null ? cached : baseline)
      setInitialized(true)
      return
    }

    // 已初始化，agentData 内容变了：区分「我们的编辑落盘」与「外部并发改动」。
    const wasDirty = !equalsRef.current(valueRef.current, baselineRef.current)
    setBaselineState(baseline)
    if (!wasDirty) {
      // 用户无本地编辑 ⇒ 静默采纳新基线（保存结果 / 外部更新）。
      setValue(baseline)
    }
    // 有本地编辑 ⇒ 保留 value；hasChanges 对齐到新 baseline
    // （保存成功时新 baseline == value，脏态自动归零）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, agentId, baselineFp, cachedFp])

  // 上报父组件：以 `hasChanges|指纹` 为去重键，脏态翻转或内容变化时才通知。
  const notifyKey = ready && initialized ? `${hasChanges ? '1' : '0'}|${fingerprint(value)}` : null
  useEffect(() => {
    if (notifyKey == null) return
    const cb = onDataChangeRef.current
    if (!cb) return
    cb(tabName, toPayloadRef.current(valueRef.current), hasChanges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyKey, tabName])

  return { value, setValue, hasChanges, initialized }
}

/**
 * 集合脏比较 —— 顺序无关：先比基数（O(1) 早退），再逐成员 `has`。
 */
export function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/** 集合指纹：成员排序后 join，规范化顺序。 */
export function setFingerprint<T>(set: Set<T>): string {
  return JSON.stringify(Array.from(set).map(String).sort())
}

/**
 * Map 脏比较 —— 键集合 + 每键值相等；缺席键按 `missing` 归一（如 skill 的 'off'）。
 */
export function mapEquals<K, V>(a: Map<K, V>, b: Map<K, V>, missing?: V): boolean {
  if (missing === undefined && a.size !== b.size) return false
  const keys = new Set<K>([...a.keys(), ...b.keys()])
  for (const k of keys) {
    const av = a.has(k) ? a.get(k) : missing
    const bv = b.has(k) ? b.get(k) : missing
    if (av !== bv) return false
  }
  return true
}

/** Map 指纹：按键排序后序列化，规范化顺序。 */
export function mapFingerprint<K, V>(map: Map<K, V>): string {
  return JSON.stringify(
    Array.from(map.entries())
      .map(([k, v]) => [String(k), v] as const)
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)),
  )
}
