# 贡献指南

感谢你考虑为 **Deskmate AI Studio** 贡献！本文档梳理了从环境搭建到 PR 合并的完整流程，请在动手前通读一遍。

---

## 0. 在你写第一行代码前

- **必须签署 CLA**：本项目使用 [CLA Assistant](https://cla-assistant.io/) 自动化签署。提交 PR 后 bot 会留链接，点进去用 GitHub 账号签一次即可（之后所有 PR 都覆盖）。**未签 CLA 的 PR 无法合并**。详见 [CLA.md](CLA.md)。
- **重大改动先开 Issue**：超过 ~100 行、跨多个模块、或修改公共契约（IPC channel / 持久化 schema / 工具协议）的改动，请**先开 Issue 讨论方案**，避免方向偏离后返工。
- **小改动可以直接 PR**：bug 修复、文档勘误、单文件重构等不需要预先开 Issue。

---

## 1. 开发环境

### 前置依赖

| 工具 | 版本 |
|---|---|
| Node.js | ≥ 20.19 |
| npm | 跟随 Node |
| 平台编译工具 | macOS：`xcode-select --install` / Windows：VS Build Tools + "Desktop development with C++" / Linux：`build-essential` |

### 启动

```bash
git clone https://github.com/flowingfate/deskmate.git
cd deskmate
npm install                    # postinstall 自动 rebuild 原生模块 + 安装 AI 文档软链
npm run dev                    # 开发模式（HMR + main/preload watch）
```

> 注意：测试**必须**用 `npm test`（脚本里有 `ELECTRON_RUN_AS_NODE=1`），匹配 `better-sqlite3` 的 ABI。直接 `vitest run` 会因 NODE_MODULE_VERSION 不一致全部失败。

---

## 2. 项目约定

### Git 约定

- **分支命名**：`user/<alias>/<feature-name>`（如 `user/alice/add-tool-execution-logs`）
- **提交规范**：[Conventional Commits](https://www.conventionalcommits.org/zh-hans/)
  - 类型：`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf`
  - `type(scope)` 部分英文，描述可中文
  - 例：`feat(chat): 支持流式渲染中断`
- **PR 标题**：中文，≤ 70 字符；细节放正文

### 代码风格

- **代码标识符英文**：变量名、函数名、IPC 通道名、JSON 字段名等代码层面的标识符必须用英文。
- **文档与注释推荐中文**：`ai.prompt.md`、模块内注释可中文，便于团队协作。日志消息 / 错误字符串建议英文以兼容国际社区。
- **类型严格**：避免 `any` / `unknown`；不能强行 `as XXX`。需要 narrowing 用 discriminated union 而不是 optional field 拼盘。
- **渲染器组件文件 ≤ 500 行**：超出请拆分组件、提取 Hook，或提升状态到 atom。
- **新增 npm 依赖前必须搜现有 `package.json`**，优先复用。新依赖按"是否被 main 进程运行时使用"分类到 `dependencies` / `devDependencies`，可用 `bun scripts/check-deps.ts` 验证。

### AI 协作文档

- 修改任何模块前，先读模块目录下的 `ai.prompt.md`（如存在）。
- 修改后**必须**同步更新对应 `ai.prompt.md` 顶部的 `<!-- Last verified: YYYY-MM-DD -->` 注释及内容。
- 跨模块改动前跑 `npm run check:impact -- <你计划修改的文件>`，列出协变映射。
- 详细规约见 [CLAUDE.md](CLAUDE.md)。

---

## 3. 提交 PR 前的验证清单

```bash
npm run typecheck    # tsc 三段编译 + mixed-import 守卫
npm test             # vitest 单测（如改动了带 __tests__/ 的模块）
npm run build        # electron-vite 完整构建
```

**这三个命令对机器有压力，不要频繁跑**；通常只在收尾时一次过。CI 会再跑一遍。

只跑相关单测：
```bash
npx --no-install cross-env ELECTRON_RUN_AS_NODE=1 \
  electron node_modules/vitest/vitest.mjs run <path-to-test>
```

---

## 4. PR 流程

1. Fork 仓库 → 创建分支 `user/<alias>/<feature>`
2. 编码 + 验证 + 同步 `ai.prompt.md`
3. 推到自己的 fork → 开 PR 到 `flowingfate/deskmate` 的 `main` 分支
4. 第一次提交 PR 时 CLA Assistant bot 会评论，点链接签 CLA
5. CI 通过 + 至少一位 maintainer review approve → 合并
6. 若 PR 需要修改，rebase 而非 merge；保持 commit 历史干净

### 不接受的 PR

- 没签 CLA
- 没跑 typecheck / test
- 大幅风格调整不改逻辑（除非项目已显式接纳 formatter）
- 引入未在 Issue 讨论过的重大架构变更
- 引入新 license 不兼容的依赖（GPL/AGPL 系不兼容 Apache-2.0 主体）

---

## 5. 报告 Bug / 提需求

- **Bug**：用 [Bug Report 模板](.github/ISSUE_TEMPLATE/bug_report.md)
- **新功能**：用 [Feature Request 模板](.github/ISSUE_TEMPLATE/feature_request.md)
- **安全漏洞**：**不要**开 public Issue —— 走 [SECURITY.md](SECURITY.md) 描述的私有渠道

---

## 6. 行为准则

请保持友善、专业、对事不对人的沟通风格。对所有贡献者一视同仁。Maintainer 保留对违反此原则的 Issue/PR/评论删除或锁定的权利。

---

## 7. 法律

提交 Contribution 即代表你同意：

- 你的 Contribution 在 [Apache License 2.0](LICENSE) 下授权
- 你已签署 [CLA](CLA.md)，授予项目方未来用任何 OSI license 重新分发的权利
- 你保证 Contribution 是你的原创或你已合规处理第三方内容

不清楚的随时开 Issue 问。
