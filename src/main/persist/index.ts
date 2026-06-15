/**
 * src/main/persist 门面 —— 统一对外导出。
 *
 * 典型用法:
 *
 *   import { Profiles } from 'src/main/persist';
 *
 *   await Profiles.get().bootstrap();
 *   const profile = await Profiles.get().active();
 *   const agent   = await profile.getAgent(agentId);
 *   const session = await agent.getSession(sessionId);
 *   session.appendDomainMessage(userMessage);             // user / assistant
 *   session.appendToolResponse(toolCallId, toolResult);   // tool 结果
 *   await session.flushMessages();
 */

export { Profiles } from './profiles';
export { Profile } from './profile';
export { Agent } from './agent';
export { Session, RegularSession, JobRun } from './session';
export { ScheduleJob, ScheduleRegistry } from './schedule';
export { LegacyAuth, PiAuth } from './auth';
export { AgentKnowledge } from './knowledge';
export { Mcp } from './mcp';
export { Skills } from './skills';
export { SubAgents } from './subAgents';
export { Models } from './models';
// Starred 类已删除（Step 9）—— starred 真值是 `regular_sessions.starred_at` 列，
// 入口走 `RegularSession.setStar(star)`（写 data.json → onChange → `SessionIdx.upsert` 同步本列）
// + `Profile.sessionIdx.listStarred(agentId?)` 读列表，无需独立 class。
export { Archive } from './archive';
export { registerPersistIpc } from './ipc';
