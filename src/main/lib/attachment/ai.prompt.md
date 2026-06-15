# `src/main/lib/attachment/` — 用户附件 sandbox 落盘

<!-- Last verified: 2026-06-14 -->

> 本模块把所有用户附件(拖入 / 粘贴 / 剪贴板图片 / screenshot /
> Electron 文件选择)统一物化进当前 session 的 `files/uploads/` sandbox,返回
> LLM 可见的 `local://uploads/<name>` URI。

## Key Files

| 文件 | 职责 | 大小 |
|---|---|---|
| `index.ts` | `attachFromPath` / `attachFromBytes` 核心 API + `pickUniqueName` | ~4KB |
| `__tests__/attachment.test.ts` | 单元测试:roundtrip / 唯一名 / 边界 / 跨 session 隔离 | ~7KB |

## 架构要点

### Reflink 优先,自动 fallback
`fs.copyFile(src, dst, fs.constants.COPYFILE_FICLONE)` 一行覆盖三平台:
- macOS APFS / Linux btrfs|xfs: `clonefile` / `FICLONE` ioctl,**瞬时 + 0 额外空间**
- macOS HFS+ / Linux ext4: 自动降级到普通 copy(libuv 内部处理)
- Windows NTFS / ReFS: 普通 `CopyFileExW`

**不要**用 hardlink:hardlink 会让 session 里附件的副本与原文件后续编辑联动,
破坏 chat history 物证完整性。

### URI 不带 ULID
LLM 看见的 URI 是 `local://uploads/<name>` —— **没有 session/agent id**。
当前 session 由 IPC handler 的 `Profiles.get().active()` + 调用方传入的
`{ agentId, sessionId }` 注入,与 [internal-urls handlers](../../pi/internal-urls/handlers/local-protocol.ts) 的 `ResolveContext` 同形。

### 唯一名生成
同目录冲突 → `foo.png` / `foo_1.png` / `foo_2.png` ...(扩展名前追加),
计数器上限 10_000 是防御性的(实际不会触发)。
不用 hash / ULID —— renderer 展示 fileName 时保留人类可识别形态。

## 常见变更

### 新增 attach 来源(e.g. 拖入 URL,远程下载)
1. 在 `index.ts` 增 `attachFromUrl(url, ctx, profileId)` —— 先 fetch 到 Buffer,
   再走 `attachFromBytes`(或 stream 到临时文件再走 `attachFromPath` 拿 reflink 红利)
2. 加 IPC: `src/shared/ipc/attachment.ts` 加入新 input/handler,
   `src/main/startup/ipc/attachment.ts` 加 handler,`src/preload/attachment/invoke.ts` 加白名单

### 修改 uploads/ 路径形态(e.g. 按日期分桶)
- 改 `UPLOADS_DIR` 常量 或 `resolveUploadsDir` 内部 join。
- ⚠️ URI 形态(`local://uploads/<name>`)是 LLM-facing 契约,改 prefix 等于改
  LLM 看到的字符串模式;落盘的消息 schema 会带这些字符串,改动需要全文档同步。

## 注意事项

### 不做去重
两次拖入同源文件 → 两次拷贝 → renderer 的 `Attachments.tsx` 用 fileName+fileSize
fallback 抓 DUPLICATE → 抛错 → 沙盒里留下 `foo_1.png` 孤儿。**可接受**:per-session
sandbox 整目录随 session 删除时清理。要做强去重需在调用方(useFileHandling)pre-copy
check 已附加的 URI/源路径 —— 不在本模块范围内。

### 不做大小上限 / binary 检查
与 `local://` read handler 的 1MB 文本上限不同 —— 这里是物理拷贝,任意大小、任意
binary 都接受。LLM 后续怎么读那是 `local://` read 路径的事(超过 1MB 文本上限
抛错;office backend 通过 `read` 工具消费二进制文档)。

### 渲染层调用前提:必须有活跃 session
`useFileHandling` 在 `getAttachContext()` 返回 null 时直接 throw
("No active chat session")。"还没选 chat 就拖文件" 不被支持 —— renderer
必须先建立 / 选定 session,才能持有合法的 `{ agentId, sessionId }` 调用本模块。

## 相关文件

- [src/main/pi/internal-urls/handlers/local-protocol.ts](../../pi/internal-urls/handlers/local-protocol.ts) — `local://` read handler;消费本模块写入的文件
- [src/shared/ipc/attachment.ts](../../../shared/ipc/attachment.ts) — IPC 契约
- [src/main/startup/ipc/attachment.ts](../../startup/ipc/attachment.ts) — IPC handler
- [src/renderer/lib/attachment/copyToSandbox.ts](../../../renderer/lib/attachment/copyToSandbox.ts) — renderer 入口
- [src/renderer/components/chat/chat-input/shared/useFileHandling.ts](../../../renderer/components/chat/chat-input/shared/useFileHandling.ts) — 调用 site
