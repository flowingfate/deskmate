# DESKMATE Skills 系统

<!-- Last verified: 2026-07-13 -->

## 1. 范围

Skill 是 profile 级安装、agent 级授权的目录资产：根目录包含 `SKILL.md`，可附带脚本和参考文件。模型只在需要时通过 `skill://<name>` 读取内容或引用其中脚本；不会在 prompt 中预展开完整文档。

本文描述跨模块的安装、绑定和消费边界。安装实现见 [skill 模块文档](../src/main/lib/skill/ai.prompt.md)；内部 URI 与 `read` 的通用路由见 [Internal URI Router](internal-uri-and-unified-read.md)。

## 2. 核心模型

| 层级 | 真值 | 职责 |
| --- | --- | --- |
| Profile skill 库 | `profiles/{profileId}/skills/skills.json` + `{name}/` 目录 | 已安装包及其元数据 |
| Agent bindings | `agent.config.skills: Record<string, SkillTier>` | 当前 agent 的可见性和 `skill://` 授权 |
| 消费协议 | `skill://<name>[/path]` | 对 LLM 屏蔽 profile 和绝对磁盘路径 |

```ts
interface SkillConfig {
  name: string;
  description: string;
  version: string;
  foreign?: ForeignSkillSource;
}

type SkillTier = 'live' | 'lazy';
type SkillBindings = Record<string, SkillTier>; // 缺席 = off
```

安装与绑定刻意分离：安装只把包加入 profile 库；绑定只修改 agent 配置。卸载不会自动解绑，因而 bindings 中允许出现已不存在的 stale 名称；prompt 构建会跳过它们并记录日志。

## 3. 生命周期与入口

```mermaid
flowchart LR
  Source[设备包 / 外部 Agent 目录] --> Install[安装或链接到 Profile skill 库]
  Install --> Bind[按需绑定到 Agent]
  Bind --> Prompt[稳定的 system prompt 元数据]
  Bind --> URI[skill:// 授权]
  Prompt --> LLM
  LLM -->|read 或 shell| URI
```

### 安装

- 输入可以是 `.zip`、`.skill` 或已解压目录；解析 `SKILL.md` front-matter 后，以 `name` 作为目录名和稳定 id。
- 安装替换先保留旧目标，索引持久化失败时恢复原目录和索引。
- 外部 Agent 导入可选 **link** 或 **copy**；link 读取外部目录的实时内容，删除时只能 unlink，不能删除来源目录。
- 更新按所选包的 metadata name 匹配已安装项；不比较版本号，语义是“同名重装”。

### 绑定

- `live`：`name`、`description`、`version` 和 `skill://<name>` 进入稳定 system prompt。
- `lazy`：不枚举 metadata；用户通过 `@skill://<name>` 显式提示后，模型按固定说明自行 `read skill://<name>`。
- `off`：bindings map 中没有该 key；不出现在 UI 候选中，也不能读取或执行。

CLI `app skill ...`、内置 MCP 的设备导入，以及 renderer Skills 页面都复用 main-process 安装和绑定内核；不要在入口层重复实现业务规则。

## 4. LLM 消费路径

1. `buildBoundSkills()` 仅收集 `live` skill 的 metadata；有任一 `lazy` skill 时保留通用按需读取指引。
2. 模型调用 `read skill://<name>`，裸 URI 指向 `SKILL.md`；子文件用 `skill://<name>/scripts/run.py`。
3. `SkillProtocolHandler` 校验当前 agent 已绑定该 skill，读取文本内容。
4. `shell` 在执行前把命令、参数和工作目录中的已授权 `skill://` URI 解析为绝对路径，因此模型可以直接执行 `python skill://pdf/scripts/run.py`。

`SKILL.md` 中的相对路径以 skill 根为基准：`scripts/run.py` 对应 `skill://<name>/scripts/run.py`。模型不需要也不应看到 profile 目录或绝对路径。

### KV cache 不变量

system prompt 必须只由 agent 配置驱动。不得根据当前或历史 user message 将 lazy metadata、`SKILL.md` 正文或 mention 结果注入 system prompt；这会改变 provider 的 prompt 前缀并失去 KV cache。`@skill://...` 只是用户消息中的触发信号，不是持久化或 prompt 拼装状态。

## 5. 安全边界

`skill://` 是只读协议。`SkillProtocolHandler` 同时保护 `read` 和 shell 的 URI→路径解析：

- 必须在当前 agent 的 bindings 中，否则拒绝。
- skill name 必须是 skills 根下的单层目录；子路径不得以 `..` 离开该目录。
- 对 link 或嵌套 symlink，再做真实路径 containment，避免子文件跳出 skill 根。
- 仅暴露文件，拒绝目录、二进制内容和超过 1 MiB 的资源。
- 对模型的错误不泄露绝对路径或堆栈。

skills 目录是 workspace 安全校验器的显式白名单。更改其布局时必须同步更新 `fileSecurityValidator.ts` 的规则。

## 6. 关键代码与协变修改

| 变更 | 主文件 | 必须同步检查 |
| --- | --- | --- |
| 包解析、安装、导入、绑定 | `src/main/lib/skill/` | [模块文档](../src/main/lib/skill/ai.prompt.md)、profile 持久化 |
| 绑定类型或档位 | `src/shared/types/profileTypes.ts` | Agent 配置、renderer 绑定 UI、CLI/MCP 入口 |
| prompt 中的 metadata 或使用说明 | `src/main/pi/prompt.ts`、`src/main/pi/utils/promptTemplates.ts` | 保持 KV cache 不变量；检查 `read`/`shell` tool 描述 |
| `skill://` 读取或执行路径 | `src/main/pi/internal-urls/handlers/skill-protocol.ts`、`src/main/pi/tools/util/resolveUriTokens.ts` | `..`、内部 symlink、未绑定 skill、目录/二进制/超限测试 |
| skills 存储路径 | 安装与 persist 路径代码 | `fileSecurityValidator.ts` 白名单和 reconcile 行为 |

## 7. 维护要点

- 安装成功不等于当前 agent 可调用；需要绑定。
- skill 名称既是稳定 id 又是目录名，保持小写连字符约束。
- link 是外部可变信任边界；来源更新、删除或包含内层 symlink 都可能影响运行时行为。
- 任何可写 skill 需求都应设计新的受控入口，不能把 `skill://` 改为可写协议。
- 修改后更新本文件与 [skill 模块文档](../src/main/lib/skill/ai.prompt.md) 中受影响的事实，并运行对应安全和安装测试。
