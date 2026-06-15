# Deskmate 开源 v1 准备清单

> 调研日期：2026-06-14。下面分 A/B/C 三档：A 必做（不做不能开源），B 强烈建议，C 一次性清理。
> 每条都给了**证据指针**（文件:行）和**Action**。做完一条打勾。

---

## 进度仪表板  <!-- 最后更新：2026-06-14 -->

| 编号 | 标题 | 状态 |
|---|---|---|
| A1 | License = Apache-2.0 + CLA | ✅ 文件完成（待 push 后接 cla-assistant.io）|
| A2 | 个人用户名泄露 | ✅ |
| A3 | Copilot ToS 披露 | ⚠️ README 已加 = 走 (a)，待正式拍板 |
| A4 | 个人基础设施硬编码 | ⏳ 需决策 |
| A5 | Python tarball 52MB | ⏳ 需决策 |
| B1 | README 完善 | ⚠️ URL 已填，hero / highlight / 英文待补 |
| B2 | OSS 卫生文件 | ✅ |
| B3 | AI 协作文档清洗 | ⏳ 待做（含 B5 文档残留）|
| B4 | AI symlink ignore | ✅ |
| B5 | 死代码清理 | ✅ 主体完成 |

**进度**：A 类 2 ✅ + 1 ⚠️ + 2 待决策；B 类 3 ✅ + 1 ⚠️ + 1 待做。

### 4 项待决策

- **A3** Copilot ToS：(a) 免责声明 / (b) 改自带 API key —— README 已预设 (a)
- **A4** CDN/relay/publish target：自托管 / 优雅降级 / 文档说明
- **A5** Python tarball 52MB：运行时下载 / Git LFS / 保持原状
- **C #10** git committer 邮箱：保留 `shang542361224@163.com` / 换公开邮箱

### 已交付文件

**新建 10 个**
`LICENSE` · `NOTICE` · `CLA.md` · `CONTRIBUTING.md` · `SECURITY.md` · `.github/ISSUE_TEMPLATE/{config.yml, bug_report.md, feature_request.md}` · `.github/PULL_REQUEST_TEMPLATE.md` · `.github/workflows/ci.yml`

**修改 6 个**
`package.json`（加 license 字段）· `README.md`（许可段 + 免责声明 + clone URL）· `src/main/lib/appCache/appCacheManager.ts`（删 JSDoc 死字段）· `src/main/lib/mcpRuntime/auth/__tests__/errors.test.ts`（删 stale mock，9/9 单测仍 pass）· `tsconfig.main.json`（删 archived exclude）· `CLAUDE.md`（删死链行）

### 下一步路径

1. 你拍板 A3 / A4 / A5（任一）→ 我把代码改完
2. 三个都拍完 → 我跑 `npm run typecheck && npm test && npm run build` 冒烟
3. 你 push 到 GitHub
4. 接 cla-assistant.io（5 分钟）
5. CI 自动跑起来 → 第一次绿勾
6. 发布 v0.1.0

---

## A. Blocker — 必做

### A1. License = Apache-2.0 + CLA  ✅ 已决，主体已完成

**决策（2026-06-14）**：选 **Apache-2.0**（专利保护、企业法务好过审、社区接受度高）+ **CLA**（保留未来改 license / 双授权的后门，不必挨个找贡献者）。

**已完成**
- [x] 根目录加 `LICENSE`（Apache-2.0 官方全文）
- [x] 根目录加 `NOTICE`（版权声明 + 第三方 vendored 代码归属：`argsTokenizer`）
- [x] 根目录加 `CLA.md`（Individual CLA，含 §4 Right to Re-License 条款）
- [x] `package.json` 加 `"license": "Apache-2.0"`（保留 `"private": true`，对齐 VS Code 等 Electron OSS 惯例，防止误推 npm registry）
- [x] `README.md` "许可与联系方式" 段重写：指向 LICENSE / NOTICE / CLA + Microsoft/GitHub/VS Code 免责声明

**剩余子任务**
- [ ] **接入 CLA Assistant**（GitHub App，5 分钟）：
   1. 访问 <https://cla-assistant.io/>，用 GitHub 账号登录授权
   2. "Configure CLA" → 选 `flowingfate/deskmate` 仓库
   3. CLA 文档源：选 "Link to gist or repo file" → 填 `https://github.com/flowingfate/deskmate/blob/main/CLA.md`
   4. 保存后，新 PR 会自动出现 CLA bot 评论；不签 CLA 的 PR 状态检查 fail
- [ ] (可选) 给源文件加 Apache 2.0 license header。Apache 推荐但非强制；1235 个 tracked 文件全加工作量大，可只在主进程入口、shared 类型、scripts/ 的关键文件上加。建议**v1 不做**，等 v0.2 再补。
- [ ] (可选) 在 README "贡献" 段加一个一句话提醒：PR 会被 CLA bot 拦截，必须先签

---

### A2. 个人用户名泄露在 LLM system prompt 里  ✅ 已完成

**已完成**（2026-06-14 复核确认）
- [x] `globalSystemPrompt.ts:198` 已改成 `/Users/someone/...`；line 203 同样改成 `someone`
- [x] 全仓 sweep `pumpedgechina|flyknife|/Users/(flowingfate|shang)` 无任何 match

---

### A3. GitHub Copilot / VS Code 协议指纹 — ToS 风险披露

**证据**
- `src/main/pi/providers/ghc/config.ts`：
  - `CLIENT_ID: 'Iv1.b507a08c87ecfe98'` （GitHub 官方 VS Code Copilot OAuth client_id）
  - `USER_AGENT: 'GitHubCopilotChat/0.26.7'`
  - `EDITOR_VERSION: 'vscode/1.99.3'`
  - `INTEGRATION_ID: 'vscode-chat'`
- `src/main/lib/mcpRuntime/auth/McpAuthService.ts:28`：
  - `BUILTIN_MICROSOFT_PUBLIC_CLIENT_ID = 'aebc6443-996d-45c2-90f0-388ff96faa56'` （VS Code 内置 MS public client）
- `src/main/pi/providers/ghc/config.ts:24-32` `STANDARD_HEADERS` 把 app 在网络层伪装成 VS Code Copilot Chat。

**风险**
开源后所有 fork 都打着 `vscode-chat` 旗号访问 Copilot 后端，更易被官方注意 → client_id 被吊销 / 法律追责风险扩散。

**决策（二选一，需要你拍板）**
- [ ] (a) 接受风险继续，**README 顶部加显式免责声明**："本项目非 Microsoft / GitHub / VS Code 官方关联；使用 GitHub Copilot 须遵守其 Terms of Service。"
- [ ] (b) 长期方案：去掉 Copilot Chat 协议，改让用户自带 OpenAI / Claude / Gemini API key — 工作量大，产品定位变化

> 推荐先 (a)，作为 v1 发布。(b) 留给 v2。

---

### A4. 个人基础设施硬编码，fork 用户用不了

**证据**

| 位置 | 内容 |
|---|---|
| `src/shared/constants/endpoints.ts:14-28` | `cdn.deskmate.top` / `relay.deskmate.top` / `relay-test.deskmate.top` |
| `electron-builder.config.js:113-122` | `publish.github { owner: 'flowingfate', repo: 'deskmate' }` |
| `brands/deskmate/config.json:15` | `homepage: https://www.deskmate.top` |
| `src/renderer/components/settings/about/AboutAppContentView.tsx:25` | `https://www.deskmate.top` 兜底 |

fork 后 auto-update / relay 访问 404；`npm run dist:publish` 推不到自己仓库。

**Action**
- [ ] `endpoints.ts`：把 CDN / relay URL 改成可配置（环境变量 / brand config 注入），未配置时优雅降级（auto-update 关闭，relay 关闭）
- [ ] `electron-builder.config.js`：`publish.owner` / `publish.repo` 改成读环境变量（`GH_OWNER` / `GH_REPO`），缺省不发布
- [ ] README 加 "Self-hosting / Forking" 章节，列清需要替换的 endpoint

---

### A5. `resources/python/` 52MB Python 二进制 tarball 占满仓库

**证据**
```
resources/python/20230726/cpython-3.10.12+...-aarch64-apple-darwin-install_only.tar.gz   16.8 MB
resources/python/20230726/cpython-3.10.12+...-x86_64-pc-windows-msvc-shared-install_only.tar.gz   36.0 MB
resources/dll/vec.dll                                                                    230 KB
```

**Action（任选）**
- [ ] (推荐) 改运行时下载，对齐已有 `resources/scripts/install-bun.js` / `install-uv.js` 模板：postinstall 时按平台从 GitHub Releases / 你的 CDN 拉到 `~/.deskmate/bin/`
- [ ] 备选：Git LFS
- [ ] 备选：保持原状但 README 标注仓库大小（不推荐）
- [ ] `resources/dll/vec.dll`（sqlite-vec Windows DLL）同样改运行时下载或换成 npm 包 `sqlite-vec-windows-x64`

---

## B. 强烈建议 — 不做显得不专业

### B1. README 完善  ⚠️ 部分完成

**已完成**（2026-06-14）
- [x] `README.md:65` 替换 `<repo-url>` → `https://github.com/flowingfate/deskmate.git`

**剩余（不阻塞 v1，但建议发布前补）**
- [ ] 顶部加 hero 截图或 demo gif（screenshot / agent 对话演示 / MCP 工具调用片段）
- [ ] 功能 highlight bullet（chat / Agent / MCP / appcmd 伪 shell / scheduler / sub-agent）
- [ ] (可选) 英文版 README，或英文功能段（Chinese-only 会限制海外可发现性）

---

### B2. 标准 OSS 卫生文件  ✅ 已完成

**已完成**（2026-06-14）
- [x] `LICENSE`（A1 阶段已写）
- [x] `NOTICE`（A1 阶段已写）
- [x] `CLA.md`（A1 阶段已写）
- [x] `CONTRIBUTING.md`：开发流程 + Git 约定 + 代码风格 + PR 流程 + CLA 提示
- [x] `SECURITY.md`：GitHub Security Advisory 私有报告流程 + 攻击面清单 + 响应承诺
- [x] `.github/ISSUE_TEMPLATE/config.yml`：禁用 blank issue + 链接 Security Advisory + Discussions
- [x] `.github/ISSUE_TEMPLATE/bug_report.md`：含日志诊断步骤
- [x] `.github/ISSUE_TEMPLATE/feature_request.md`
- [x] `.github/PULL_REQUEST_TEMPLATE.md`：含 `npm run check:impact` 协变 / CLA / typecheck-test-build 三件套 checkbox
- [x] `.github/workflows/ci.yml`：ubuntu + macos + windows 矩阵跑 install → typecheck → test → build smoke；带 concurrency 防止重复跑

**未做（可选，不阻塞 v1）**
- [ ] `CODE_OF_CONDUCT.md`（Contributor Covenant 模板，可后补）
- [ ] `CHANGELOG.md`（从 v0.1.0 开始记，发版时再写）

---

### B3. AI 协作文档清洗

**证据**
- `CLAUDE.md` 是 single source of truth，里面有 "v2.7.10 登录挂起" 等 postmortem、内部约定、`tmp/job.md` 引用
- `ai.prompt/*.md` 11 份、各模块 `ai.prompt.md` 大量内部语境
- `CLAUDE.md` 第 1 行 `作为我的合作伙伴...` 这种私人对话残留（如有）

**Action**
- [ ] 通读 `CLAUDE.md` + `ai.prompt/*.md`，删私人语境、不存在的文件引用、postmortem 时间线
- [ ] 保留：架构图、模块表、约定、co-change map
- [ ] 把 README 的"开发协作"段抽到 `CONTRIBUTING.md`

---

### B4. AI symlink 文件 .gitignore  ✅ 已完成（误报修正）

**复核结果**（2026-06-14）：原本"未忽略"的判断是错的——上次只读了 `.gitignore` 前 300 行就停了，没看到 line 299-303 已经存在以下条目：
```
# AI doc symlinks (generated by scripts/setup-ai-docs.js via postinstall)
AGENTS.md
GEMINI.md
.cursorrules
.github/copilot-instructions.md
```
- [x] 4 个 symlink 全部已 ignore，无需修改

---

### B5. 历史死代码 / 残留  ✅ 主体完成（B3 阶段还有文档清理收尾）

**复核**：`src/main/archived/` 目录本身已不存在，但代码 / 配置 / 文档里有一堆悬空引用。

**已完成**（2026-06-14）
- [x] `src/main/lib/appCache/appCacheManager.ts:14-19` 删除 `microsoft.graphClientId` JSDoc 死字段（AppConfig interface 和 DEFAULT_APP_CONFIG 里从未有过对应字段，纯文档幽灵）
- [x] `src/main/lib/mcpRuntime/auth/__tests__/errors.test.ts:53-60` 删除指向已删路径 `userDataADO/appCacheManager` 的 stale `vi.mock`（验证：单测 9/9 仍 pass）
- [x] `tsconfig.main.json:8` 删除排除项 `"src/main/archived"`（路径不存在，排除毫无意义）
- [x] `CLAUDE.md:39` 删除任务表中指向 `src/main/archived/chat/LEGACY.md` 的死链行

**剩余（归到 B3 文档清洗一并做）**
- [ ] `ai.prompt/persist.md:17,180,321,425` `arch-main.md:48-49` 多处 `archived/` 历史描述
- [ ] `src/main/persist/ai.prompt.md:102,180`、`evalHarness/ai.prompt.md:52`、`screenshot/ai.prompt.md:70`、`skill/ai.prompt.md:41`、`mcpRuntime/ai.prompt.md:58-59,124-127` 等 `userDataADO/` 死链 / 描述 `microsoft.graphClientId` 不存在的字段
- [ ] `src/renderer/components/settings/README.md:615,641` 指向 `userDataADO/README.md` 的死链
- [ ] `src/main/lib/subAgent/types.ts:7`、`src/main/persist/ipc.ts:8-9`、`src/main/persist/lib/subAgentMarkdown.ts:17`、`src/main/pi/utils/config.ts:4-5`、`src/shared/types/profileTypes.ts:3-7,608-610` 注释里残留的 `userDataADO` 旧路径引用

**用户手动**
- [ ] 本地 `rm -rf tmp/`（已 gitignore，仅清个人电脑残留 — 不影响仓库）

---

## C. 一次性清理 — 推荐顺序

按下面顺序做，每步都能独立提交：

1. **法律 / 披露**（A1 + A3 README 段）
2. **隐私清洗**（A2）
3. **fork-ability**（A4 endpoints + electron-builder）
4. **瘦身**（A5 python tarball + vec.dll）
5. **OSS 卫生**（B2 全部 + B4 .gitignore）
6. **README 完善**（B1）
7. **AI 文档清洗**（B3）
8. **死代码清理**（B5）
9. **冒烟测试**：
   - [ ] `npm run typecheck && npm test && npm run build`
   - [ ] 干净机器上 `git clone` + `npm install` + `npm run dev` 走一遍
10. **git committer 决策**：当前 squash 后只有 1 个 commit，作者邮箱 `shang542361224@163.com` 会公开。想换就 `git commit --amend --reset-author` 后再 push。

---

## 时间预算

| 范围 | 预估 |
|---|---|
| 只做 A1 + A2 + A5 + B4 + README 占位（先挂出去看反应）| 1-2 天 |
| v1.0 完整发布（A 全做 + B2 CI + B3 文档清洗）| 3-5 天 |

---

## 决策项汇总

- [x] **License 类型**：Apache-2.0 + CLA（2026-06-14 已决，详见 A1）
- [ ] A3 Copilot ToS 路线：(a) 免责声明（README 已加占位）/ (b) 改自带 API key
- [ ] A4 CDN/relay：自托管开源 / 优雅降级 / 文档说明
- [ ] A5 Python tarball：运行时下载 / Git LFS
- [ ] git committer 邮箱：保留 `shang542361224@163.com` / 换公开邮箱
