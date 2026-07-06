import * as path from 'path';

/**
 * 在 `baseEnv` 之上叠加内置运行时的 PATH 与编码变量，返回新对象（不改动入参）。
 *
 * 职责收窄：只管「让 shim/内置 bun/uv 被命中」与编码，不再写 VIRTUAL_ENV / UV_PYTHON——
 * 那些连同各 managed dir 由 {@link applyManagedRuntimeDirs} 单一 owner 负责，避免多处双写。
 *
 * 关键处理：
 * - PATH 前插 binPath，让 shims / 内置 bun、uv 优先命中（大小写不敏感地找 PATH 键）。
 * - PYTHONUTF8 / PYTHONIOENCODING 强制 UTF-8，规避子进程（尤其 Windows）编码问题。
 * - 删除 npm_config_prefix，避免 Homebrew node 注入的值与 nvm 冲突。
 */
export function buildInternalEnv(baseEnv: NodeJS.ProcessEnv, binPath: string): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${binPath}${path.delimiter}${env[pathKey] ?? ''}`;

  env['PYTHONUTF8'] = '1';
  env['PYTHONIOENCODING'] = 'utf-8';

  // Homebrew node 设置的 npm_config_prefix 与 nvm 不兼容，对内置运行时也无用。
  delete env['npm_config_prefix'];

  return env;
}

/**
 * 自带运行时的「装机落点」目录集。全部由调用方从 `path.ts` 取值后显式传入，
 * 保持本模块纯度可测。喂给工具的环境变量，把 bun/uv 的安装行为关进 env/ 院子里。
 */
export interface ManagedRuntimeDirs {
  /** {userData}/env/uv-cache/ —— UV_CACHE_DIR。 */
  uvCacheDir: string;
  /** {userData}/env/uv-tools/ —— UV_TOOL_DIR。 */
  uvToolDir: string;
  /** {userData}/env/python/ —— UV_PYTHON_INSTALL_DIR，同时是设置页列表扫描目录。 */
  uvPythonInstallDir: string;
  /** {userData}/env/bun/ —— BUN_INSTALL（全局包 + 缓存根）。 */
  bunInstallDir: string;
  /** {userData}/env/runtime-bin/ —— 全局 CLI 入口统一收口（uv/bun 工具入口 + python3.x 入口）。 */
  runtimeBinDir: string;
  /** {userData}/env/python-venv/ —— VIRTUAL_ENV。 */
  venvPath: string;
  /** 用户锁定的 Python 版本；非空时写入 UV_PYTHON。 */
  pinnedPythonVersion?: string | null;
}

/**
 * 把自带运行时的目录环境变量原地叠加到 `env`（就地改，不返回新对象）。
 *
 * 这是「喂目录变量」的唯一实现，A（设置页按钮 → getEnvWithInternalPath）与
 * B（LLM 干活 → terminalBridge.applyRuntimeEnv）两条独立 env 构建路都调它，
 * 杜绝只改一边导致泄漏。同时收编 UV_PYTHON / VIRTUAL_ENV，避免多处手写重复。
 *
 * 已核对 uv / bun 官方文档：这些变量只改「装到哪」，不改工具行为。BUN_INSTALL 不影响
 * 托管 bun 二进制（它在 env/bin，按绝对路径/PATH 调用）。
 */
export function applyManagedRuntimeDirs(env: NodeJS.ProcessEnv, dirs: ManagedRuntimeDirs): void {
  // uv：缓存 / 工具环境 / Python 本体 / 工具入口 / python3.x 入口。
  env['UV_CACHE_DIR'] = dirs.uvCacheDir;
  env['UV_TOOL_DIR'] = dirs.uvToolDir;
  env['UV_PYTHON_INSTALL_DIR'] = dirs.uvPythonInstallDir;
  env['UV_TOOL_BIN_DIR'] = dirs.runtimeBinDir;
  env['UV_PYTHON_BIN_DIR'] = dirs.runtimeBinDir;

  // bun：全局包 + 缓存根（BUN_INSTALL），全局 CLI 入口（BUN_INSTALL_BIN，仅 BUN_INSTALL 不改默认 bin）。
  env['BUN_INSTALL'] = dirs.bunInstallDir;
  env['BUN_INSTALL_BIN'] = dirs.runtimeBinDir;

  // VIRTUAL_ENV：令 uv/python 及子进程无视 cwd 都能发现该 venv（打包后 cwd 不可写）。
  env['VIRTUAL_ENV'] = dirs.venvPath;

  // UV_PYTHON：用户锁定的解释器（版本号或完整路径），仅在非空时写入。
  if (dirs.pinnedPythonVersion && dirs.pinnedPythonVersion.trim().length > 0) {
    env['UV_PYTHON'] = dirs.pinnedPythonVersion;
  }
}
