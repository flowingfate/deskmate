/**
 * `present_deliverables`:声明本次回复的最终交付物列表。
 *
 * 用于在工作流末尾正式向用户呈现生成的文件,把"最终输出"与"中间过程文件"
 * 区分开,给用户一个清晰的交付体验。
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { log } from '@main/log';

import { jsonSchema } from './schema';
import type { LocalTool, ToolResult } from './types';

export interface PresentDeliverablesArgs {
  description: string;
  fileUris: string[];
}

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'Brief description of what you are presenting to the user',
    },
    fileUris: {
      type: 'array',
      items: { type: 'string' },
      description: 'URIs (local://... | knowledge://... | absolute path) of the final deliverables to present',
    },
  },
  required: ['description', 'fileUris'],
});

const DESCRIPTION = `Present final deliverables to the user.

WHEN TO USE:
- After completing a task that produces files (reports, code, data, images)
- To highlight the final output and distinguish it from intermediate files
- At the END of a workflow, not during intermediate steps

WHEN NOT TO USE:
- For temporary or intermediate files (helper scripts, logs, drafts)
- When just reading or analyzing existing files
- When the task doesn't produce new files

IMPORTANT: Always call this tool as the LAST step after creating the final deliverable files.`;

export const presentDeliverables: LocalTool = {
  spec: {
    name: 'present_deliverables',
    description: DESCRIPTION,
    parameters: PARAMETERS,
  },
  async handler(args, _ctx): Promise<ToolResult> {
    // 校验文件是否存在(只 warn,不阻塞);返回空对象省 context token。
    // URI 形态(local:// / knowledge://)不走 fs.access —— 它们由 router 解析,
    // 这里只对绝对路径做 best-effort 存在性检查。
    const { description, fileUris } = args as PresentDeliverablesArgs;
    const startTime = Date.now();

    log.info({ msg: 'PresentTool execution', mod: 'PresentTool', fileUris, description });

    for (const uri of fileUris) {
      if (uri.includes('://')) continue; // internal URI — skip fs.access
      try {
        await fs.access(path.normalize(uri));
      } catch {
        log.warn({ msg: `File not found: ${uri}`, mod: 'PresentTool' });
      }
    }

    log.info({ msg: 'PresentTool completed', mod: 'PresentTool', dur: Date.now() - startTime });

    return { ok: true, content: '{}' };
  },
};
