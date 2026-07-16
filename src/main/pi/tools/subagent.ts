import { makeCommandFacade } from '../appcmd/_facade';
import {
  createSubAgentCommand,
  type SubAgentCommandRunner,
} from '../subagent/commands';
import type { LocalTool } from './types';

/**
 * 构造顶层 `subagent` 工具。runner 是必需依赖，因此 Step 9 在 manager 就绪前
 * 无法创建或注册一个不可执行的空壳工具。
 */
export function createSubagentTool(runner: SubAgentCommandRunner): LocalTool {
  return makeCommandFacade(createSubAgentCommand(runner));
}
