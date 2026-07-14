<!-- Last verified: 2026-07-14 (SkillConfig / provenance schema 收敛至 shared/persist/types/) -->
# Skills System

> 管理以 `.zip`/`.skill` 归档形式交付的打包 AI prompt 模板的安装、版本控制和激活。

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `index.ts` | Barrel 入口 — 再导出下列各模块的函数与类型，并提供向后兼容的 `skillManager` 门面对象（`skillManager.foo()` 调用形态保留） | small |
| `types.ts` | Skill 子系统共享类型：`SkillMetadata` / `SkillValidationResult` / `VersionParseResult` / `MetadataParseResult` / `SkillOperationResult` | small |
| `skillVersion.ts` | `validateSkillName()` / `parseSkillFileName()` / `determineVersion()` — 名称校验、zip/skill 文件名解析、版本裁决 | small |
| `skillMetadata.ts` | `parseSkillMarkdown()` / `getSkillMetadata()` — SKILL.md YAML front-matter 解析与磁盘元数据读取 | small |
| `skillArchive.ts` | `extractZip()` — zip/skill 解压；拒绝 Windows/Unix traversal、超过 50MB 的压缩包、超过 1,000 个 entry、单 entry 超过 10MB 或总展开超过 100MB 的归档；流式顺序提取，避免解压炸弹并发占内存 | small |
| `skillInstall.ts` | `validateSkillPackage()` / `checkSkillExists()` / `installSkill()` / `linkSkill()` / `createTempDirectory()` / `cleanupTempDirectory()` — 包校验、安装更新到 active profile、外部目录 link 安装、临时目录管理；替换时旧目标先移入 app tmp backup，索引写失败会回滚磁盘目标 | medium |
| `installAndActivateSkill.ts` | `installAndActivateSkill()` — 统一入口：从设备路径安装，然后按激活模式（`current-agent`、`all-agents`、`install-only` 等）应用到 agents | medium |
| `skillDeviceImporter.ts` | `addSkillFromDevice()` / `updateSkillFromDevice()` — 从 `.zip`、`.skill` 或 skill 文件夹路径复制导入新 skill，或按包自身 `SKILL.md` name 自动匹配已装 skill 并覆盖更新 | small |
| `foreignAgentSkillScanner.ts` | `scanForeignAgentSkills()` — 扫描固定的其他 Agent 全局 skills 目录，只读一级子目录并解析 `SKILL.md` / `skill.md` front-matter | small |
| `importForeignAgentSkills.ts` | `importForeignAgentSkills()` — 批量导入外部 Agent skill，逐项 link/copy，main 端重读元数据并校验同名冲突 | medium |
| `skillAvailability.ts` | `getSkillAvailability()` — 检查某个 skill 是否已安装并可供指定 agent 调用 | small |
| `applySkillToAgents.ts` | 将已安装的 skill 应用到 `ProfileCacheManager` 中的一个或多个 agent 配置 | small |
| `deleteInstalledSkill.ts` | UI 和内置工具共用的删除路径：移除全局 skill 配置并从磁盘删除本地 skill 目录 | small |
| `removeSkillsFromAgents.ts` | 从一个或多个 agent 配置中移除一个或多个 skill 名称，而不卸载底层本地 skill 包 | small |

## Architecture
- **Skill 包格式**：一个 `.zip` 或 `.skill` 归档，或一个解压的 skill 文件夹，至少包含一个带有 YAML front-matter 字段的 `SKILL.md` 文件：`name`、`description`、`version`。其他资产（prompt 文件、图片）与归档/文件夹共存。
- 存储路径：`{userData}/profiles/{userAlias}/skills/{skill-name}/`。目录名等于 YAML 中的 skill `name` 字段。
- **Barrel 约束**：`index.ts` 是本模块唯一对外入口。外部一律 `import { … } from '@main/lib/skill'`，**禁止深链子文件**（`@main/lib/skill/skillInstall` 等）。模块内部文件之间可直连兄弟文件（如 `installAndActivateSkill.ts` → `./applySkillToAgents`），但**不得**反向从 barrel `'.'` 导入，否则形成循环依赖。`skillManager` 为向后兼容的门面对象（`skillManager.foo()` == 具名函数 `foo()`）。
- `installAndActivateSkill.ts` 是设备安装 + 绑定的权威流程 — 内置 MCP 工具与设备导入器都汇入此流程。外部 Agent 导入是例外：它不是设备选择器入口，且必须支持 symlink/junction，因此走 `importForeignAgentSkills()`，但仍保持“安装 ≠ 绑定”。
- 渲染进程安装入口可能请求显式的设备选择模式（`artifact` 用于 `.zip/.skill`，`folder` 用于目录），这样菜单操作可以在 Windows 上跳过额外的原生模式选择器，同时保持文件选择器硬限制为 `.zip/.skill`。
- 本地卸载和 agent 级别解绑是有意分离的流程：卸载移除全局 skill 配置加本地包文件，但不触及 `chat.agent.skills`；从 agents 移除仅编辑 agent 配置而不卸载本地包。
- 外部 Agent 导入只扫描固定 registry（`~/.claude/skills`、`~/.codex/skills`、`~/.cursor/skills`、`~/.agents/skills`、`~/.config/agents/skills`、`~/.config/opencode/skills`、`~/.gemini/skills`、`~/.copilot/skills`），不递归、不执行脚本、不静默安装。默认 link；copy 复用设备 folder import。导入后给 `SkillConfig.foreign` 写 provenance（本地绝对路径只用于 UI / 管理，不进入 LLM prompt）。
- `js-yaml` 用于 YAML 解析（与 `subAgentMarkdown` 一致）。
- **读取/消费侧**（与本目录的安装侧解耦）：只有当前 agent bindings map 中存在的 skill 可经 `skill://<name>` 读取或执行；`resolve` 与 `resolveToPath` 都在 `pi/internal-urls/handlers/skill-protocol.ts` 校验绑定、词法路径、realpath containment、目录/二进制/1MB 限制。`shell` 工具会把命令/args/cwd 里的已授权 `skill://` URI 自动解析成绝对路径，故 LLM 可直接 `python skill://pdf/scripts/run.py` 执行 skill 脚本；裸 `skill://pdf` 在 `cwd` 位置特例映射 skill 根目录，在 read / command / args 中仍指向 `SKILL.md`。SKILL.md 里的相对路径（`scripts/run.py`）1:1 映射成 `skill://<name>/scripts/run.py`。

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| 更改 SKILL.md 必填字段 | `types.ts`（`SkillMetadata`） + `skillMetadata.ts`（`parseSkillMarkdown` 验证） | 无内置包，直接改验证即可 |
| 添加新的激活模式 | `installAndActivateSkill.ts`（`ActivationMode` 类型 + switch） | 渲染进程也必须通过 IPC 传递新模式 |
| 更改 skill 存储目录布局 | `skillInstall.ts`（`installSkill`） + `SecurityValidator` skills 路径白名单 | 路径在 `securityValidator.ts` 中被白名单 |
| 新增外部 Agent skill 来源 | `foreignAgentSkillScanner.ts`（registry） + `ImportForeignAgentSkillsDialog.tsx`（UI 文案如需展示） | 只加固定 skills 根路径；不要扫描任意 home 目录 |
| 更改 skill provenance | `shared/persist/types/resource.ts`（`ForeignSkillSource` / `SkillConfig.foreign`，经 `types/index.ts` 导出）+ `importForeignAgentSkills.ts` | 新增字段向后兼容；不要重命名/删除旧字段 |

## Gotchas
- ⚠️ skills 目录无论 workspace 范围如何都**始终被 `SecurityValidator` 批准**。更改其路径需要更新 `securityValidator.ts` 中的白名单。
- ⚠️ Skill 名称用作目录名；含空格或大写字母的名称会导致跨平台路径不一致。FRE 始终使用小写连字符名称。
- ⚠️ `InstallAndActivateSkillArgs` 中的 `overwrite` 标志控制是否替换已存在的 skill 目录。可选的 `confirmOverwrite` 异步回调允许 UI 在继续前提示用户。
- ⚠️ **`updateSkillFromDevice(inputPath)` 唯一入口是 `SkillsAddButton`（"Update from Device..."）**，不再逐 skill 行提供入口——目标 skill 名不由调用方传入，而是从所选包自身 `SKILL.md` 的 `name` 字段自动判定，`checkSkillExists` 查不到就整体拒绝（提示改走 Add from Device）。渲染进程侧先弹一次性 `AlertDialog` 说明这条规则，再唤起原生文件选择器；不要再假设 IPC 通道带 `targetSkillName` 参数（`shared/ipc/skill.ts` 里 `call: []`）。
- ⚠️ 外部 Agent 导入的 link 模式会让 `{profile}/skills/{name}` 指向外部目录。删除已安装 skill 时 `deleteInstalledSkill` / `Skills.remove` 必须只 unlink，不删除外部源目录；读取侧仍只暴露 `skill://{name}`。
- ⚠️ 外部源可能只有小写 `skill.md`。扫描和导入兼容小写；persist `readMarkdown` 与 `skill://` 裸 name resolve 也做了兼容。不要把小写文件改名到外部源目录。
- ⚠️ linked skill 是 symlink，`Skills.reconcile()` 通过 `listDirs(dir, true)`（`persist/lib/atomic.ts` 的 `followSymlinks`）才能把它算作"磁盘存在"。若给 skills 新增 startup reconcile 或复用 `listDirs` 列 skill 目录，务必传 `followSymlinks=true`，否则 linked skill 会被当成已删除从 `skills.json` 剔除。
- ⚠️ **linked skill = 逃逸攻击面**。linked skill 的根是指向外部第三方目录的 symlink，内容 live 可变。外部目录里可藏内层 symlink（`skill://foo/evil -> ~/.ssh/id_rsa`），词法 `..` 检查看不出来（`evil` 逻辑在 skill 目录内）。防线在 `skill-protocol.ts::toAbsPath` 的**真实路径 containment**：把 skill 根 realpath 出来（跟随根链接是预期的），要求目标 realpath 落在该根内，deepest-existing 前缀解析挡住内层文件/目录逃逸链接。`resolve`（读）与 `resolveToPath`（shell 执行）共用此咽喉，两条路都受保护。renderer IPC 的 `getSkillDirectoryContents` / `getSkillFileContent` 走 `resolveSkillSubPath` 做同样校验。**改这些函数前务必保留 realpath 校验**——去掉即重开机密读取洞。copy 模式的内层 symlink 也靠它挡。
- ⚠️ **agent 绑定是三档映射，不是布尔/数组（2026-07-12 起）**。真值是 `agent.config.skills: Record<string, SkillTier>`（`SkillTier = 'live' | 'lazy'`）：`'live'` = 第一档，元数据无条件进入 system prompt；`'lazy'` = 第二档，不列元数据，用户仅能通过 `@skill://<name>` 引用它；缺席 = 第三档禁用。档位派生用 `liveSkillNames()` / `lazySkillNames()`。`buildBoundSkills(agentCfg, profile)` **只列 live 的 metadata**；lazy-only agent 只获得稳定的「用户可显式引用 `@skill://<name>`，随后 `read skill://<name>`」指引。此规则不可改成按 turn 把 lazy metadata 拼进 system prompt：system prompt 是 provider KV cache 前缀，任何 mention 驱动的变化都会使整段对话缓存失效。bind 写 `'live'`，unbind 删除 key。
- ⚠️ **lazy skill 不自动读、不自动注入 SKILL.md**。用户消息中的 `@skill://<name>` 是唯一触发信号；LLM 自行决定是否调用 `read skill://<name>` 读取 `SKILL.md`。不要恢复 `buildLazySkillInjection`、`toPiContext(lastUserInjection)`、`UserMessage.skills` 或从消息解析 mention 的持久化链路——它们要么增加复杂度，要么将 turn-varying 数据污染 system prompt cache。

- 全链路架构：[ai.prompt/skill-system.md](../../../../ai.prompt/skill-system.md)（安装、绑定、prompt 与 `skill://` 消费边界）。
- 依赖：`@main/persist`（profile / agent skill 配置读取）
- 被依赖：MCP 内置 `add_skill_from_device` 工具、渲染进程 Skills 设置 UI
- 读取侧：`pi/internal-urls/handlers/skill-protocol.ts`（`skill://` 读取 + `resolveToPath`）、`pi/tools/util/resolveUriTokens.ts`（`shell` 里 URI→绝对路径,用于执行脚本）、`pi/utils/promptTemplates.ts::boundSkillsBlock`（能力注入 + 使用指南）
