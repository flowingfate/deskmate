# 安全策略 / Security Policy

## 报告漏洞

**请勿在公共 Issue 中报告安全漏洞。** 公开报告可能在补丁发布前让所有用户暴露在风险下。

请通过以下任一私有渠道：

### 1. GitHub Security Advisory（推荐）

打开 <https://github.com/flowingfate/deskmate/security/advisories/new> 提交私有 advisory。GitHub 会自动通知 maintainer，并在修复前对外不可见。

### 2. 邮件

如果你不便用 GitHub Advisory，可以发邮件到 maintainer（暂定 GitHub 平台联系：通过 [@flowingfate](https://github.com/flowingfate) profile 上公开的联系方式）。

报告内容请尽量包含：

- **影响范围**：哪个版本、哪个组件受影响
- **触发条件**：复现步骤 / PoC（最小可复现样例最好）
- **危害评估**：是否需要本地访问 / 网络可达 / 用户交互；是否能造成 RCE / 数据泄露 / 权限提升 / DoS
- **建议修复方向**（如果你有想法）

---

## 攻击面（请重点关注）

Deskmate 是桌面 Electron 应用，下面这些子系统是高敏感区，欢迎重点审查：

| 子系统 | 风险点 |
|---|---|
| **Shell 工具 / appcmd 伪 shell** | 命令注入；`SecurityValidator` 旁路；越权访问工作区外文件 |
| **MCP 运行时** | 第三方 MCP server 提权；OAuth callback / DCR 流程被劫持；token 缓存泄露 |
| **浏览器自动化（Playwright）** | 通过 controlled browser 跨站脚本 / 凭据窃取 |
| **持久化层** | 路径遍历突破 `~/.deskmate/` 沙箱；`messages.jsonl` 注入；SQLite 索引污染 |
| **Auto-updater** | CDN 通道被劫持；签名校验被绕过；下载文件路径遍历 |
| **IPC 桥接** | 渲染进程通过 preload 调用主进程时的输入校验缺失 |
| **Renderer 流式渲染** | Markdown / Mermaid / 代码块的 XSS；OSC 转义注入终端 |

---

## 不在攻击面内（不视为漏洞）

- 用户主动配置不信任的 MCP server / 不信任的 skill 后被该 server 攻击 —— 这是用户授权范围内的风险，请以 Issue 提改进建议而非 advisory
- 用户主动运行恶意 shell 命令 / `app` 伪 shell 命令 —— 同上
- 自动更新失败 / Apple notarization 异常等不涉及安全的工程缺陷 —— 走普通 Bug Report

---

## 响应时间承诺

| 阶段 | 目标时间 |
|---|---|
| 首次响应（confirm 收到）| 5 个工作日内 |
| 漏洞确认 / 复现 | 14 个工作日内 |
| 补丁发布 | 视严重程度，Critical 优先 |
| Public disclosure | 与报告者协商，通常补丁发布后 30 天内 |

> 当前为开源 v1 早期阶段，仅个人维护，响应可能比上述目标慢。请耐心，并先尝试 GitHub Security Advisory 跟进。

---

## 致谢

我们会在 release notes 中公开致谢报告者（除非你要求匿名）。暂未设立赏金计划。
