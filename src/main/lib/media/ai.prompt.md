<!-- Last verified: 2026-06-28 -->
# Media Protocol 模块

> `media://` —— renderer `<img>` / `<video>` 的「字节直供」前置层。把 session sandbox /
> knowledge 里的二进制资源(主要是图片附件)直接交给 Chromium fetch + lazy decode,
> 取代「`fsApi.readFile` 读成 base64 dataURL 注入 DOM」的旧路径,消除 base64 常驻 JS
> heap + IPC 往返 + 解码位图无法被浏览器淘汰三重代价。

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `mediaProtocol.ts` | authority 注册表 + `resolveMediaRequest(url)` 解析核心 + `registerMediaProtocol()` 注册入口 | small |
| `__tests__/mediaProtocol.test.ts` | 端到端:local/knowledge 字节直供 + 错误矩阵(真盘 + 真 router) | medium |

## Architecture

### URL 文法
```
media://<authority>/<path…>?agent=&session=&mime=
```
- **`<authority>` = 现有 internal-url scheme 名**(`local` / `knowledge`),做 1:1 对齐。
  路径解析**完全委托** `InternalUrlRouter.resolveToPath` —— 沙盒 `..` 越界检查、
  agent/session 校验、`local://uploads/<name>` → 绝对路径全部复用,本模块不重复实现。
- `<path…>`:renderer 每段 `encodeURIComponent`;handler 每段 `decodeURIComponent`
  还原(逐段,避免文件名里被编码的 `%2F` 被误当目录分隔符),拼回内层 URI
  `<authority>://<path>`。
- `<query>`:`agent`(ULID)、`session`(ULID)、`mime`(URL-encoded → Content-Type)。

### per-authority 必填 query(`MEDIA_AUTHORITIES` 注册表)
| authority | 内层 scheme | 必填(除 mime 外) | 说明 |
|---|---|---|---|
| `local` | `local` | `agent` + `session` | session 级 sandbox |
| `knowledge` | `knowledge` | `agent` | agent 级 KB,`resolveToPath` 不消费 session |

`mime` 对所有 authority 必填 —— 主进程**不读字节嗅探**,由 renderer 持久化的
attachment(已知 mimeType)权威给出。加新「可字节直供的内部资源域」往
`MEDIA_AUTHORITIES` 塞一条即可,handler 主体零改动。

### 解析流程(`resolveMediaRequest`)
1. `new URL(rawUrl)` → host=authority、pathname=内层路径、searchParams=ctx。
2. authority 不在注册表 → 404;必填 query 缺 → 400。
3. 重建内层 URI;`profileId` 取 **active profile**(不进 query,防跨 profile 越权)。
4. `InternalUrlRouter.resolveToPath(innerUri, ctx)` → 绝对路径(沙盒边界检查在此)。
5. `fs.createReadStream` → `Readable.toWeb` → `Response`(主进程不驻留整文件)。
6. 失败 → 404/400/500 纯文本 → renderer `<img onError>` 走图标兜底。

### 注册
- scheme 的 **privileged 声明**在 `main.ts` 的 `registerSchemesAsPrivileged`
  (**MUST 在 app ready 前**),与 `screenshot` 并列:`secure/standard/supportFetchAPI/
  corsEnabled/stream`。
- **handler 注册** `registerMediaProtocol()` 在 `main.ts` `onReady` 内调用
  (`protocol.handle` 的前置条件 = app ready 后)。
- renderer **CSP**(`src/renderer/index.html`)的 `img-src` / `media-src` 必须含 `media:`。

### 扩展点(设计预留,未实现)
- `?download=1` → 回 `Content-Disposition: attachment`。
- `Range` header → 视频分段(stream 已就位,补 206 分支)。
- 新 authority → 注册表加一条 + 声明必填 ctx。

## 常见变更
- **新增可字节直供的内部资源域**:在 `MEDIA_AUTHORITIES` 加 `{ authority, innerScheme,
  requiredContext, buildContext }`;内层 scheme 必须已在 `InternalUrlRouter` 实现
  `resolveToPath`。renderer 侧同步在 `lib/mediaUrl.ts` 的
  `MEDIA_AUTHORITY_REQUIRES_SESSION` 加映射。
- **改 query 契约**:main `mediaProtocol.ts` 与 renderer `lib/mediaUrl.ts` 是一对镜像,
  必须同步改(协变)。

## 注意事项
- **profileId 绝不进 URL** —— 走 active profile,防 renderer 越权读其它 profile。
- **mime 不在 main 嗅探**:故必填;缺失直接 400,不做扩展名兜底(可后续放宽)。
- `resolveMediaRequest` 入参是 raw URL 字符串(非 `Request`)—— 既匹配
  `protocol.handle` 回调的 `request.url`,又让单测无需构造受 scheme 限制的 `Request`
  (undici `Request` 对非 http(s) scheme 会抛)。
- 测试经 `npm run test`(Electron node,ABI 145)跑;`npx vitest` 走系统 node 会因
  `better-sqlite3` ABI 不匹配全挂(见 CLAUDE.md)。

## 相关文件
- [src/main/main.ts](../../main.ts) — privileged scheme 声明 + `registerMediaProtocol()` 调用
- [src/main/pi/internal-urls/router.ts](../../pi/internal-urls/router.ts) — `resolveToPath` 委托目标
- [src/main/lib/attachment/ai.prompt.md](../attachment/ai.prompt.md) — 写入被服务的图片字节
- [src/renderer/lib/mediaUrl.ts](../../../renderer/lib/mediaUrl.ts) — renderer 端镜像:`toMediaUrl`(精确 mime)+ `toImageDisplaySrc`(文件引用统一入口:internal uri→media://、绝对路径→file://、远程→原样)+ `imageMimeFromPath`
- renderer 消费方(展示 sandbox/knowledge 图片,均经上述 helper):
  - [message/AttachmentList.tsx](../../../renderer/components/chat/message/AttachmentList.tsx) — 用户消息图片附件
  - [message/GeneratedFileCards.tsx](../../../renderer/components/chat/message/GeneratedFileCards.tsx) — assistant 产出文件图片预览
  - [tool/renderers/write/index.tsx](../../../renderer/components/chat/tool/renderers/write/index.tsx) — write 工具结果图片预览
  - [chat-input/Attachments.tsx](../../../renderer/components/chat/chat-input/Attachments.tsx) — 编辑态(载入既有消息)图片预览;草稿态走 objectURL
  - [message/ImageGallery.tsx](../../../renderer/components/chat/message/ImageGallery.tsx) — `<IMAGE_REGISTRY>` 图库(tool/搜索图):internal uri→media://、远程 http(s) 原样,同步解析无 base64
