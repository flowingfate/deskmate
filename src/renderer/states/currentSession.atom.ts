// 渲染端"当前活跃 session"的 source of truth。
// 由顶层路由（ChatView）依据 useParams 写入，其他组件读。
// 主进程不再 echo current；本 store 与主进程完全解耦。

import { unit } from '@/atom/unit';

export type CurrentSession = {
  agentId: null;
  jobId: null;
  sessionId: null;
} | {
  agentId: string;
  jobId: string | null;
  sessionId: string | null;
}

const EMPTY: CurrentSession = { agentId: null, jobId: null, sessionId: null };

function equal(a: CurrentSession, b: CurrentSession) {
  return a.agentId === b.agentId && a.jobId === b.jobId && a.sessionId === b.sessionId;
}

export const CurrentSession = unit<CurrentSession>(EMPTY, equal);
