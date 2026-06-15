// pi 子树的统一入口。
//
// 注意:**不要**在这里 `import './tools'` —— 那条路径会在测试 / scheduler /
// subAgentManager 等下游 import `@main/pi` 时,反过来把 `pi/tools/*.ts` 拖入
// init,而部分 wrapper(`createSchedule` / scheduler 系列)的 legacy class
// 又透过 SchedulerManager 回引 `@main/pi` —— 形成 Phase 1 不可调和的循环。
//
// 替代方案:`toolCatalog.ts::buildToolCatalogFor*` 在首次执行时调
// `await ensureToolsRegistered()`(动态 import `./tools/index.ts`),让
// `@main/pi` 顶层 init 不触发 tool registry,只有真正需要 catalog 时才
// 跨过去。
export { toPiContext, fromPiAssistantMessage } from './utils/messageBridge';
export { resolveModel, resolveApiKey, resolveCredentials } from './model';
export { Agent } from './agent';
export { RegularSession, JobRun, type PersistSessionLike } from './session';