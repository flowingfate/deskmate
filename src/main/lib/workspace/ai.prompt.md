<!-- Last verified: 2026-07-13 -->
# 工作区系统

> 为当前活动工作区目录提供高性能文件树枚举、内容搜索和实时文件变更监听。

## 关键文件
| 文件 | 职责 | 规模 |
|------|------|------|
| `FileTreeService.ts` | 使用 `ripgrep --files` 枚举文件树；流式处理输出以避免大型工作区的内存溢出；包含元数据（size, mtime） | 大 |
| `RipgrepSearchEngine.ts` | 基于 `@vscode/ripgrep` 二进制文件的内容搜索引擎；带模糊评分和排名；主搜索路径 | 大 |
| `SearchService.ts` | 统一的 `ISearchEngine` 接口；将查询路由到 `RipgrepSearchEngine`，以 `NodeFSSearchEngine` 作为回退 | 中 |
| `NodeFSSearchEngine.ts` | 纯 Node.js 回退搜索（递归 `fs.readdir`）；在 ripgrep 二进制文件不可用时使用 | 中 |
| `WorkspaceWatcher.ts` | 基于 Chokidar 的文件系统监听器；发出类型化的 `IFileChange` 事件（`ADDED`、`UPDATED`、`DELETED`） | 小 |
| `FileSystemWatcher.ts` | 基于 WorkspaceWatcher 的更底层监听抽象 | 小 |
| `fuzzyScorer.ts` | 模糊匹配算法（`prepareQuery`、`compareItemsByFuzzyScore`、`FuzzyScorerCache`）；由 `RipgrepSearchEngine` 用于结果排名 | 大 |
| `FileIndexCache.ts` | **已废弃** — 源码中带有 `@deprecated` 标签；请勿使用；已被 ripgrep 搜索替代 | — |

## 架构
- `FileTreeService` 和 `RipgrepSearchEngine` 都通过先调用 `require('@vscode/ripgrep').rgPath` 来定位 `rg` 二进制文件，然后在候选路径列表中回退（dev `node_modules`、`app.asar.unpacked`、`process.resourcesPath`）。两个文件重复了这个解析逻辑 — 这是已知的不一致。
- **ripgrep 从 asar 中解包**（`electron-builder.config.js` 中配置了 `asarUnpack: ['**/node_modules/@vscode/ripgrep/**']`）。如果此配置被移除，工作区搜索会静默降级到 Node.js 回退方案。
- `IFileSearchQuery.signal` 是搜索生命周期的一部分；`RipgrepSearchEngine` 收到 abort 后必须杀掉 `rg`。文件和目录搜索均最多保留 200 个结果；目录由 `rg --files` 输出流式提取，禁止先累积完整路径列表，也不跟随符号链接。
- 当配置文件中没有配置工作区时，工作区根目录默认为用户主目录（`os.homedir()`）。文件操作通过 `SecurityValidator` 限制在此根目录的安全范围内。
- `FileIndexCache` 目前没有被任何有意义的地方导入；保持原样（已废弃）。

## 常见变更
| 场景 | 需要修改的文件 | 备注 |
|------|---------------|------|
| 更改默认工作区根目录 | `ProfileCacheManager` 或解析工作区路径的 IPC handler | `FileTreeService`/`SearchService` 在调用时传入根目录 |
| 添加新的文件搜索过滤器 | `RipgrepSearchEngine.ts` | 在 `spawn` 参数数组中追加 ripgrep 标志 |
| 在新环境中处理 ripgrep 二进制文件 | `FileTreeService.ts` 和 `RipgrepSearchEngine.ts` | 两者都有各自的 `getRipgrepPath()` — 需保持同步 |
| 监听额外的事件类型 | `WorkspaceWatcher.ts` | 扩展 `FileChangeType` 枚举和 chokidar 事件绑定 |
| 改进模糊排名 | `fuzzyScorer.ts` | 调整评分函数即可；接口稳定 |

## 注意事项
- ⚠️ `FileIndexCache.ts` 标记为 `@deprecated`，但仍存在于目录中 — 它没有被任何活跃代码路径使用。请勿接入使用。
- ⚠️ `getRipgrepPath()` 在 `FileTreeService.ts` 和 `RipgrepSearchEngine.ts` 之间是复制粘贴的。对二进制路径解析的修改必须在两个文件中同步应用。
- ⚠️ 工作区搜索结果流向 LLM 看到的 `find` 与 `search` 工具(LLM-visible names;源文件 `pi/tools/searchFiles.ts` 和 `searchFileContents.ts`);这些工具也通过 `SecurityValidator` 进行自己的路径验证。需保持两个系统之间的工作区根目录一致。
- ⚠️ `chokidar` 是 devDependency — 在发布工作区监听功能之前，请验证它已包含在生产构建中。

## 相关模块
- 依赖于：`@vscode/ripgrep`（必须在 `dependencies` 中，而非 `devDependencies`）、`chokidar`、`fs/promises`
- 被依赖于：[Chat Engine](../chat/ai.prompt.md)（上下文引用、工作区文件浏览）、内置工具(`find`、`search`、`read`)、渲染进程 `FileTreeExplorer` 组件
