/**
 * Local tools IPC handler。renderer 调它来:
 *   - 列举注册中的本地工具(settings 页 / agent editor)
 *   - 检查某个名字是否已注册
 *   - (rare)直接 invoke 一个工具(debug / e2e)
 *
 * chat 主链路**不走本 IPC** —— pi/tool.ts 直接在主进程内调
 * `localTools.execute(name, args, ctx)`,IPC 仅服务 UI / 测试。
 */

import { ipcMain } from 'electron';

import { renderToMain } from '@shared/ipc/tools';
import type { LocalToolInfo } from '@shared/types/toolsTypes';
import { Tracer } from '@shared/log/trace';

// `tools/registry` 是纯模块级单例,不会触发 cycle —— 真正注册副作用在
// `tools/index`,由每个 handler 入口 `await ensureToolsRegistered()` 懒拉。
// **不要**在本文件顶层 static-import `../../pi/tools`:那会与
// `pi/tools/registry.ts` 对 `./index` 的 dynamic import 形成 mixed-import,被 repo lint 拒。
import { tools, ensureToolsRegistered } from '@main/pi';

import type { Context } from './shared';
export default function setUpToolsIPC(_ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  handle.execute(async (_event, name, args) => {
    try {
      await ensureToolsRegistered();
      const tool = tools.get(name);
      if (!tool) return { success: false, error: `Tool not found: ${name}` };
      // 这条 IPC 入口不接 chat session 上下文;只暴露 dev/debug 用最小 ctx
      // (signal/eventSender 等都不可用),非 chat 工具(无 ctx 依赖)才能跑通,
      // chat 工具(executeCommand / spawn / 等)会因 ctx 不全在 handler 内抛错。
      const controller = new AbortController();
      const result = await tool.handler(args as never, {
        profileId: '',
        agentId: '',
        sessionId: '',
        signal: controller.signal,
        eventSender: null,
        tracer: Tracer.noop,
        isSubAgent: false,
        callId: `ipc_${Date.now()}`,
        chunkStream: null,
      });
      if (!result.ok) return { success: false, error: result.error };
      return { success: true, data: result.content };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  handle.getAll(async () => {
    try {
      await ensureToolsRegistered();
      const infos: LocalToolInfo[] = tools.list().map((t) => ({
        name: t.spec.name,
        description: t.spec.description,
        inputSchema: t.spec.parameters as unknown as Record<string, unknown>,
      }));
      return { success: true, data: infos };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  handle.has(async (_event, name) => {
    await ensureToolsRegistered();
    return { success: true, data: tools.has(name) };
  });
}
