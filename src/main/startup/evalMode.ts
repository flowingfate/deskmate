import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Profiles } from '../persist/profiles';
import { getPiAuthManager } from '@main/pi';
import { mcpClientManager } from "../lib/mcpRuntime"

/**
 * Load .env.local synchronously for eval mode.
 * In normal GUI mode, env is loaded async via setImmediate and gated on
 * NODE_ENV=development. Eval mode needs EVAL_AUTH_TOKEN available before
 * the HTTP server starts, so we load it eagerly here regardless of NODE_ENV.
 */
function loadDotenvSync(): void {
  const possiblePaths = [
    path.join(__dirname, '../../.env.local'),
    path.join(process.cwd(), '.env.local'),
  ];
  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
      console.error(`[EvalMode] Loaded .env.local from: ${envPath}`);
      return;
    }
  }
}

/**
 * Start the AgenticEval HTTP harness in headless mode.
 *
 * 启动序列：
 *   1. bootstrap profiles
 *   2. 读 active profile 的 `auth.pi.json`，检查 `github-copilot` 凭据
 *      （pi.RegularSession 是 EvalAgentRunner 唯一 LLM 路径，必须有 GHC token）
 *   3. 无凭据 → fatal exit；提示走 GUI 登录后再跑
 *
 * 只初始化必要的单例（profile + pi auth check + MCP），然后起 HTTP 服务
 * 供外部评估系统访问。
 */
export async function startEvalMode(): Promise<void> {
  console.error('[EvalMode] Starting in eval mode (headless)');

  // Load .env.local before anything else — EVAL_AUTH_TOKEN may live there
  loadDotenvSync();

  try {
    // 1. Initialize persist layer (bootstrap is idempotent)
    await Profiles.get().bootstrap();

    const profileId = Profiles.get().activeProfileId;
    if (!profileId) {
      console.error('[EvalMode] FATAL: No active profile after bootstrap.');
      app.quit();
      return;
    }

    // 2. Verify github-copilot credentials in active profile's auth.pi.json.
    //    getApiKey 内部已处理过期 refresh + 回写；未登录返回 null。
    let token: string | null = null;
    try {
      token = await getPiAuthManager(profileId).getApiKey('github-copilot');
    } catch (err) {
      console.error(`[EvalMode] FATAL: pi auth lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      app.quit();
      return;
    }

    if (!token) {
      console.error(`[EvalMode] FATAL: No github-copilot credentials in active profile auth.pi.json (profileId=${profileId}).`);
      console.error('[EvalMode] Please launch DESKMATE normally and sign in via Settings → Providers first.');
      app.quit();
      return;
    }

    console.error(`[EvalMode] Active profile: ${profileId} (github-copilot ready)`);

    // 3. chat engine 已退役（PR5e）；EvalAgentRunner 直接走 pi.Agent + persist，
    //    不再需要 AgentChatManager initialize。

    // 4. Initialize MCPClientManager (for tool execution)
    try {
      await mcpClientManager.initialize();
      console.error('[EvalMode] MCPClientManager initialized');
    } catch (error) {
      console.error('[EvalMode] WARNING: MCPClientManager init failed, tools may not work:', error);
    }

    // 5. Start the eval HTTP server
    const { EvalHttpServer } = await import('../lib/evalHarness/evalHttpServer');
    const server = new EvalHttpServer(profileId);
    await server.start();

    console.error(`[EvalMode] HTTP server listening on http://127.0.0.1:${server.getPort()}/eval/`);
    console.error('[EvalMode] Endpoints: GET /eval/health, POST /eval/run, POST /eval/judge');

  } catch (error) {
    console.error('[EvalMode] FATAL: Failed to start eval mode:', error);
    app.quit();
    return;
  }
}
