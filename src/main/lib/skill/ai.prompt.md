<!-- Last verified: 2026-06-12 -->
# Skills System

> 管理以 `.zip`/`.skill` 归档形式交付的打包 AI prompt 模板的安装、版本控制和激活。

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `skillManager.ts` | `SkillManager` 单例 — 验证归档、解析 SKILL.md YAML front-matter、提取到 profile skills 目录、版本比较、CRUD | medium |
| `installAndActivateSkill.ts` | `installAndActivateSkill()` — 统一入口：从设备路径安装，然后按激活模式（`current-agent`、`all-agents`、`install-only` 等）应用到 agents | medium |
| `skillDeviceImporter.ts` | `addSkillFromDevice()` / `updateSkillFromDevice()` — 从 `.zip`、`.skill` 或 skill 文件夹路径导入或更新 skill | small |
| `skillAvailability.ts` | `getSkillAvailability()` — 检查某个 skill 是否已安装并可供指定 agent 调用 | small |
| `applySkillToAgents.ts` | 将已安装的 skill 应用到 `ProfileCacheManager` 中的一个或多个 agent 配置 | small |
| `deleteInstalledSkill.ts` | UI 和内置工具共用的删除路径：移除全局 skill 配置并从磁盘删除本地 skill 目录 | small |
| `removeSkillsFromAgents.ts` | 从一个或多个 agent 配置中移除一个或多个 skill 名称，而不卸载底层本地 skill 包 | small |

## Architecture
- **Skill 包格式**：一个 `.zip` 或 `.skill` 归档，或一个解压的 skill 文件夹，至少包含一个带有 YAML front-matter 字段的 `SKILL.md` 文件：`name`、`description`、`version`。其他资产（prompt 文件、图片）与归档/文件夹共存。
- 存储路径：`{userData}/profiles/{userAlias}/skills/{skill-name}/`。目录名等于 YAML 中的 skill `name` 字段。
- `installAndActivateSkill.ts` 是所有安装路径的**唯一权威流程** — 内置 MCP 工具与设备导入器都汇入此流程。不要为新安装流程绕过它。
- 渲染进程安装入口可能请求显式的设备选择模式（`artifact` 用于 `.zip/.skill`，`folder` 用于目录），这样菜单操作可以在 Windows 上跳过额外的原生模式选择器，同时保持文件选择器硬限制为 `.zip/.skill`。
- 本地卸载和 agent 级别解绑是有意分离的流程：卸载移除全局 skill 配置加本地包文件，但不触及 `chat.agent.skills`；从 agents 移除仅编辑 agent 配置而不卸载本地包。
- **内置 skills**（`docx`、`frontend-design`、`pptx`、`skill-creator`）在 FRE 期间通过 `src/shared/constants/builtinSkills.ts` 中的 `BUILTIN_SKILL_NAMES` 自动安装。用户不可删除。
- 安装路径仅支持设备来源（`.zip`/`.skill` 归档或解压目录）。
- `js-yaml` 用于 YAML 解析（与 `subAgentMarkdown` 一致）。

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| 添加新的内置 skill | `src/shared/constants/builtinSkills.ts` + `main.ts` 中的 FRE 安装逻辑 | 名称需与归档文件名匹配 |
| 更改 SKILL.md 必填字段 | `skillManager.ts`（`SkillMetadata` 接口 + 验证） | 相应更新内置 skill 包 |
| 添加新的激活模式 | `installAndActivateSkill.ts`（`ActivationMode` 类型 + switch） | 渲染进程也必须通过 IPC 传递新模式 |
| 更改 skill 存储目录布局 | `skillManager.ts` + `SecurityValidator` skills 路径白名单 | 路径在 `securityValidator.ts` 中被白名单 |

## Gotchas
- ⚠️ skills 目录无论 workspace 范围如何都**始终被 `SecurityValidator` 批准**。更改其路径需要更新 `securityValidator.ts` 中的白名单。
- ⚠️ Skill 名称用作目录名；含空格或大写字母的名称会导致跨平台路径不一致。FRE 始终使用小写连字符名称。
- ⚠️ `InstallAndActivateSkillArgs` 中的 `overwrite` 标志控制是否替换已存在的 skill 目录。可选的 `confirmOverwrite` 异步回调允许 UI 在继续前提示用户。

## Related
- 依赖：`@main/persist`（profile / agent skill 配置读取）
- 被依赖：MCP 内置 `add_skill_from_device` 工具、渲染进程 Skills 设置 UI、FRE 流程
