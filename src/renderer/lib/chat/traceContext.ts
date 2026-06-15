// 主链路 trace 上下文 —— renderer 侧 send → recv 跨调用栈接力。
//
// 唯一用途：sendUserMessage 入口起 `chat.send` tracer 时塞进来；
// streaming chunk 到 status=idle 时由 session-manager.handleStatusChangedChunk
// 取走，derive 出 `chat.recv` 写收尾 INFO，并 delete。
//
// 为什么需要这个 Map：两个调用栈完全无引用通路 —— sendUserMessage 是用户点击
// 事件回调，run-to-completion 后退出；handleStatusChangedChunk 是 streaming
// chunk dispatcher 调用，两者不共享 closure / atom / component。把 tracer 暂存
// 到 chatSessionId 索引的 Map 是唯一干净的接力方式。
//
// retry / edit 路径**不**在 renderer 起 chat.send tracer —— main 端 IPC handler
// 入口自己 `Tracer.start()` 兜底，对应 turn 仍能形成 chat.ipc → chat.turn 链路，
// 只是少了 renderer 端 user-perceived dur 这一节。这是 design 文档定的契约
// （仅 sendUserMessage 报端到端时延）。
//
// 不写入 ChatSessionCache —— ChatSessionCache 会被持久化到 jsonl，trace 字段
// 是一次执行的运行时态，不该跨重启保留。
//
// key 取 chatSessionId：一个 session 同时只有一轮 turn 在进行（renderer 已经
// guardIdle），所以 Map 不会出现并发 entry。

import { Tracer } from '@shared/log/trace';

const inFlight = new Map<string, Tracer>();

export const traceContext = {
  /** sendUserMessage 入口调用，把 chat.send tracer 塞进 Map。 */
  start(chatSessionId: string, tracer: Tracer): void {
    inFlight.set(chatSessionId, tracer);
  },
  /**
   * session-manager 在 status=idle 终态时取走并删除。也用于 sendUserMessage
   * 自己 catch 路径上清理泄漏（chat.recv 不会被触发的失败 turn）。
   * 返回 null 表示无在飞 tracer（retry/edit 路径下正常返回 null）。
   */
  consume(chatSessionId: string): Tracer | null {
    const tracer = inFlight.get(chatSessionId) ?? null;
    if (tracer) inFlight.delete(chatSessionId);
    return tracer;
  },
  /** 只读访问。中间态调试需要看 tid 时用，不删除条目。 */
  peek(chatSessionId: string): Tracer | null {
    return inFlight.get(chatSessionId) ?? null;
  },
};
