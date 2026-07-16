<!-- Last verified: 2026-07-16 (Step 10：委派改为稳定 Agent 设置，旧功能开关已删除) -->
# Feature Flags

> 主进程单例，负责定义、解析并向主进程和渲染进程（通过 IPC）提供 feature flag 值。

## Key Files
| 文件 | 职责 | 大小 |
|------|------|------|
| `types.ts` | `FeatureFlagName` 联合类型、`FeatureFlagConfig`、`FeatureFlagState`、`FeatureFlagsMap`、`FeatureFlagsValues`、`FeatureFlagContext` | 小 |
| `featureFlagDefinitions.ts` | `FEATURE_FLAG_DEFINITIONS` 数组 — 所有 flag 配置（含静态或上下文派生的默认值）；辅助函数 `resolveDefaultValue`、`getFeatureFlagConfig`、`getAllFeatureFlagNames` | 中 |
| `featureFlagManager.ts` | `FeatureFlagManager` 单例 — 初始化上下文（`isDev`、`brandName`、`platform`、`arch`），解析默认值，解析 `--enable-features`/`--disable-features` CLI 参数；导出 `featureFlagManager`、`isFeatureEnabled`、`getAllFeatureFlags` | 中 |
| `index.ts` | 重新导出所有公开类型、配置和管理器辅助函数 | 小 |

## 架构

**主进程为唯一数据源。** 启动时，`featureFlagManager.initialize()` 在 `main.ts` 中被调用一次。它会：
1. 通过 `NODE_ENV === 'development'` 或 `--dev` argv 检测 `isDev`。
2. 解析每个 flag 的 `defaultValue` — 可以是静态 `boolean` 或 `(ctx: FeatureFlagContext) => boolean`。
3. 使用 `--enable-features=a,b` / `--disable-features=c` CLI 参数覆盖已解析的值（`source: 'cli'`）。

**IPC 桥接。** `preload.ts` 暴露 `window.electronAPI.featureFlags.getAllFlags()` 和 `featureFlags.isEnabled(name)` — 由 `main.ts` 中注册的 `featureFlags:getAllFlags` / `featureFlags:isEnabled` IPC 通道提供支持。

**渲染进程缓存。** `src/renderer/lib/featureFlags/featureFlagCacheManager.ts` 在渲染进程初始化时获取所有 flag（从 `src/renderer/index.tsx` 调用），将它们以版本控制的方式存储在 `localStorage` 中作为回退，并提供同步的 `isFeatureEnabled(name)` + `useFeatureFlag(name)` React hook 供组件使用。

**Flag 生命周期：** 定义 → 启动时解析 → 通过 IPC 提供 → 在渲染进程缓存 → 同步消费。Flag 在运行时是只读的；不支持实时重载。

## Common Changes
| 场景 | 需修改的文件 | 注意事项 |
|------|-------------|---------|
| 添加新 flag | 1. `types.ts`（`FeatureFlagName` 联合类型） → 2. `featureFlagDefinitions.ts`（添加 `FeatureFlagConfig` 条目） | 命名约定：`deskmateFeatureXXXXX` |
| 修改 flag 的默认逻辑 | `featureFlagDefinitions.ts` — 编辑 `defaultValue` | 使用 `(ctx) => ...` 来处理环境/品牌/平台条件 |
| 为测试启用 flag | 启动时添加 `--enable-features=flagName`；无需修改代码 | CLI 来源会覆盖任何 `defaultValue` |
| 在主进程中消费 flag | `import { isFeatureEnabled } from './lib/featureFlags'` | Manager 必须先初始化 |
| 在渲染进程中消费 flag | `import { useFeatureFlag } from '../../lib/featureFlags'`（React hook）或 `isFeatureEnabled(name)`（非 hook） | 两者都从 `featureFlagCacheManager` 读取 |

## Co-Change Map
| 当你修改 | 同时检查/更新 |
|----------|-------------|
| `types.ts` 中的 `FeatureFlagName` | `featureFlagDefinitions.ts` — 添加对应的 `FeatureFlagConfig` 条目 |
| `featureFlagDefinitions.ts` | 渲染进程缓存会自动失效（版本键 `1.0` 是静态的）；除非更改了 `FeatureFlagsValues` 的结构，否则无需手动更新缓存 |
| `main.ts` 中的 IPC 通道名称 | `preload.ts` 中的 `featureFlags` API 接口 |

## 反模式
- 不要在 feature-gated 代码中直接读取 `process.env.NODE_ENV` — 使用 `isFeatureEnabled()`，这样 flag 可以通过 CLI 覆盖。
- 不要向渲染进程侧的 `featureFlagCacheManager` 类型中添加 flag — 它故意使用 `string` 键以与主进程的 `FeatureFlagName` 类型解耦。
- 不要多次调用 `featureFlagManager.initialize()` — 虽然它是幂等的，但重复调用会记录警告。
- 不要在初始化后修改 flag — 没有 setter；不支持运行时切换。

## 验证步骤
1. 在 `types.ts` 的 `FeatureFlagName` 中添加 flag 名称，在 `featureFlagDefinitions.ts` 的 `FEATURE_FLAG_DEFINITIONS` 中添加条目。
2. 运行 `npm test` — `featureFlagDefinitions.test.ts` 会验证每个 `FeatureFlagName` 都有对应的定义，以及 `resolveDefaultValue` 对静态和动态默认值都能正常工作。
3. 在开发模式下启动；检查控制台中 `[FeatureFlags] Current state:` 日志输出，确认新 flag 出现。
4. 验证渲染进程消费：打开 DevTools → Application → Local Storage → 查找 `deskmate_feature_flags_cache` 键，确认新 flag 存在。

## 注意事项
- ⚠️ `isDev` 在 `initialize()` 时解析一次。如果 `--dev` 不在 `process.argv` 中且 `NODE_ENV` 不是 `'development'`，则所有 `(ctx) => ctx.isDev` flag 在生产构建中默认为 `false`。
- ⚠️ 如果渲染进程的 IPC 调用失败（例如冷启动期间），`featureFlagCacheManager` 会静默回退到 `localStorage`。过期的缓存可能在下次成功同步之前提供过时的值。
- ⚠️ 渲染进程缓存管理器中的 `CURRENT_CACHE_VERSION` 硬编码为 `'1.0'`。如果你添加的 flag 改变了 `FeatureFlagsValues` 的结构，请提升此常量以强制刷新缓存。

## 相关模块
- 依赖：`@shared/constants/branding`（`BRAND_NAME`）、`src/main/log`（日志记录）
- 被依赖：`src/main/main.ts`（初始化 + IPC 处理程序）、`src/preload/main.ts`（IPC 桥接）、`src/renderer/lib/featureFlags/`（渲染进程缓存 + hooks）、几乎所有通过 flag 控制 UI 或工具的功能模块
