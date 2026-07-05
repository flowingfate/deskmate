import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate, useNavigationType } from 'react-router-dom';

/**
 * 读取 react-router 写入 `window.history.state.idx` 的真实浏览器历史光标。
 *
 * react-router 的底层 history（`getUrlBasedHistory`）在每次 push/replace/pop 时把当前
 * 条目在真实历史栈中的位置写进 `history.state.idx`。**注意：这与是否使用 data router
 * 无关** —— 旧的 `<BrowserRouter>` 用的是同一个 `createBrowserHistory`，`idx` 与
 * `useNavigationType()` 的行为完全一致。缺省 0（首帧 / 非 react-router 写入的 state）。
 */
function readHistoryIndex(): number {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
}

/**
 * `popstate` 只在 POP（后退/前进，含 OS 手势）时触发；PUSH/REPLACE 不触发它，
 * 但那两类导航会走 react-router 的整树重渲染，`useSyncExternalStore` 会在重渲染时
 * 重新调用 `getSnapshot` 拿到新 `idx`。因此这里只需订阅 `popstate` 兜住“不经 React
 * 重渲染的 out-of-band POP”即可。
 */
function subscribeHistory(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export interface HistoryNavState {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

/**
 * TitleBar 后退/前进按钮的逻辑。
 *
 * ## 为什么这个 hook 存在
 * 浏览器 History API 提供“跳转”（`history.back()/forward()`），但**不提供**
 * “能否前进/后退”。要让按钮到头置灰，必须自己算：
 * - `canGoBack = idx > 0`（`idx` = 当前光标，读 `history.state.idx`）。
 * - `canGoForward = idx < maxIdx`，其中 `maxIdx` = 已知的“最大可达索引”。History API
 *   不暴露前进栈长度，只能自己跨导航累积记忆。
 *
 * ## `maxIdx` 为什么必须看 `navigationType`（本 hook 唯一不直观处）
 * **PUSH 会截断前进分支**。设历史 `[A,B,C,D]`、当前在 B（idx=1, maxIdx=3）。用户点链接
 * PUSH 到 E → 浏览器变成 `[A,B,E]`（idx=2），C/D 被丢弃，`maxIdx` 应降到 2。但“PUSH 到 E”
 * 和“点前进按钮到 C（POP）”**都让 idx 从 1 变 2**，仅凭 idx 无法区分。只有识别出
 * “这次是 PUSH”，才能把 `maxIdx` **向下收敛**到 idx；否则前进按钮会错误地保持可点
 * （指向已被截断、不存在的条目）。POP/REPLACE 不改变栈长度，`maxIdx` 只取 `max` 不下降。
 *
 * ## 实现取舍
 * `maxIdx` 用 state + effect 维护（导航后在 effect 里更新），而非渲染期直接改 ref——
 * 后者虽是 React 认可的“渲染期派生记忆”模式，但可读性差、容易被误读为有 bug。
 * 代价：PUSH 后有一帧 `canGoForward` 短暂偏真，对标题栏按钮不可感知，且 `goForward`
 * 有 guard、浏览器对无效前进 no-op，不影响正确性。
 */
export function useHistoryNav(): HistoryNavState {
  const navigate = useNavigate();
  const navigationType = useNavigationType(); // PUSH/POP/REPLACE：PUSH 收敛信号
  // useSyncExternalStore：以 React 官方方式读外部可变源 history.state.idx，concurrent-safe，
  // 且把“读 DOM history”从渲染体正规化出去。PUSH/REPLACE 经 react-router 整树重渲染重取快照，
  // 订阅只需兜住 out-of-band 的 POP（见 subscribeHistory）。
  const idx = useSyncExternalStore(subscribeHistory, readHistoryIndex);

  const [maxIdx, setMaxIdx] = useState(idx);

  useEffect(() => {
    setMaxIdx((prev) => (navigationType === 'PUSH' ? idx : Math.max(prev, idx)));
  }, [idx, navigationType]);

  const canGoBack = idx > 0;
  const canGoForward = idx < maxIdx;

  const goBack = useCallback(() => {
    if (readHistoryIndex() <= 0) return;
    navigate(-1);
  }, [navigate]);

  const goForward = useCallback(() => {
    navigate(1);
  }, [navigate]);

  return { canGoBack, canGoForward, goBack, goForward };
}
