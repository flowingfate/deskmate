# `src/main/lib/attachment/` — 用户附件 sandbox 落盘

<!-- Last verified: 2026-07-16 (附件 URI context 使用 agent mode) -->

> 本模块把所有用户附件(拖入 / 粘贴 / 剪贴板图片 / screenshot /
> Electron 文件选择)物化进当前 session 的 `files/uploads/` sandbox,返回
> LLM 可见的 `local://uploads/<name>` URI。**物化时机 = 发送**:renderer 在
> 用户点击发送(`createMessage`)时才调用,添加附件阶段只在内存暂存,不落盘。
> 图片的「内联 vs 落 sandbox」判别 + 物化由 IPC handler 的
> `processImageAttachment`([startup/ipc/attachment.ts](../../startup/ipc/attachment.ts))
> 在 **main** 用 sharp 按【解码后像素大小】(width×height×4,阈值 256KB ≈256×256)
> 算一次:**小图**回原始 base64,renderer 建 `image`+`dataUrl` 内联、根本不进本模块;
> **大图**经本模块 `attachFromBytes` 落 sandbox,renderer 建 `image`+`fileRef` 附件
> (source 指向 `local://uploads/<name>`),由模型按需 `read` 查看
> (read image backend 按 OpenAI vision 指南压缩后回 base64)。

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
`{ agentId, sessionId }` 注入；附件只服务当前普通会话，调用 internal URL router 时显式使用 `mode:'agent'`。

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

### 渲染层调用前提:发送时(而非添加时)必须有活跃 session;新会话自动补建
附件物化推迟到「发送」:renderer 在 `attachmentManager.createMessage(text, ctx)` 时
才调用本模块,`ctx` = `{ agentId, sessionId }`。添加附件阶段(拖入/截图/选择)只把
原始 `File` 暂存进 atom,不落盘、不需要 session。发送时若 `getAttachContext()` 返回
null(无活跃 session),输入侧弹 toast 并中止,不调用本模块。详见
[chat-input/shared/useFileHandling.ts](../../../renderer/components/chat/ai.prompt.md)。

新会话走 lazy-create:renderer 在 "New Chat" 时只本地生成 sessionId 并 navigate,直到
发送首条消息才落盘。带附件发送时附件物化先于 `streamMessage`,此刻 `data.json` 尚不
存在,`local://` handler 的 `resolveBaseDir` 会因 session 未命中抛 "Session not found"。
故 attachment IPC handler([startup/ipc/attachment.ts](../../startup/ipc/attachment.ts))
在物化前用同一 sessionId 补建 regular session(`findSessionAcrossKinds ?? createSession`),
与 pi 侧 `getOrCreateSession` 幂等。

### 图片判别在 main、只算一次(`processImageAttachment`)
图片附件的「内联 vs 落 sandbox」判别已从 renderer 搬到 main:renderer 在发送时
(`Attachments.finalize`)对每张草稿 image 调 `processImage` IPC,handler 的
`processImageAttachment` 用 sharp 读尺寸 → `w*h*4` vs `IMAGE_INLINE_MAX_BYTES`(256KB):
- `inline`:回原始 base64 + sharp 测得的 mime/尺寸,renderer 建 `image/dataUrl` 附件,
  **不进本模块、不写盘**。
- `sandbox`:复用 `ensureSandboxSession` + `attachFromBytes` 写原图,回 `local://uploads/<name>`
  + sharp 测得的 mime/尺寸,renderer 建 **`image`+`fileRef`** 附件(source 指向该 URI)。
- sharp 解析失败(损坏 / bmp 等不支持)→ 回落用编码字节判别,mime 从扩展名兜底,不抛。

两种持久化形态都是 `kind:'image'`,只是 source 不同(小图 `dataUrl` / 大图 `fileRef`)。
**egress 按 source 分流**(`messageBridge.userToPi`):
- `image+dataUrl` → 内联成 `PiImageContent`(`attachmentImageToPi`)。
- `image+fileRef` → **不内联**,经 `buildFileAnnotationText` 注入「🖼️ Image Files List」
  (URI + 尺寸),模型按需 `read`。`TokenCounter` 也只对 `dataUrl` 计视觉 token。

> 历史数据:更早版本把大图降级成 `kind:'opaque'`。renderer `AttachmentList` 对
> 图片 mime 的 opaque 保留缩略图兜底,旧会话仍可见图;新数据一律 `image+fileRef`。
>
> 渲染传输:`AttachmentList` **不读字节**展示 sandbox 大图,而是把 `local://uploads/<name>`
> 构造成 `media://local/...?agent&session&mime`(见 [renderer/lib/mediaUrl.ts](../../../renderer/lib/mediaUrl.ts)),
> 由 `<img src>` 经 [media:// protocol](../media/mediaProtocol.ts) 字节直供 —— 避免 base64
> 常驻 JS heap + IPC 往返。`image+dataUrl` 小图仍内联(无 sandbox 文件可服务)。

## 相关文件

- [src/main/pi/internal-urls/handlers/local-protocol.ts](../../pi/internal-urls/handlers/local-protocol.ts) — `local://` read handler;消费本模块写入的文件
- [src/shared/ipc/attachment.ts](../../../shared/ipc/attachment.ts) — IPC 契约
- [src/main/startup/ipc/attachment.ts](../../startup/ipc/attachment.ts) — IPC handler
- [src/renderer/lib/attachment/copyToSandbox.ts](../../../renderer/lib/attachment/copyToSandbox.ts) — renderer 入口
- [src/renderer/components/chat/chat-input/shared/useFileHandling.ts](../../../renderer/components/chat/chat-input/shared/useFileHandling.ts) — 调用 site
- [src/main/lib/media/mediaProtocol.ts](../media/mediaProtocol.ts) — `media://` 字节直供 protocol;渲染层展示 sandbox 图片的传输通道
