# Internal URI Router & 统一 `read` 工具

<!-- Last verified: 2026-06-14 -->
## 1. 范围

本文档覆盖 DESKMATE **resource 寻址 + 统一读取**的总体设计 —— 把"在哪取数据"与"读什么子结构"两件事彻底正交,LLM 用 1 个工具 + 1 个 `path` 字符串 cover 所有读场景。

设计灵感来自 omp(`@oh-my-pi/pi-coding-agent`)的 `read` 工具 + Internal URL Router。范式同源,但 deskmate 在 multi-profile / multi-agent 维度做了必要的偏离。

代码位置:
- `src/main/pi/internal-urls/` —— Protocol router 基础设施(进程级单例,scheme → handler 注册表)
- `src/main/pi/tools/read.ts` —— `read` LocalTool spec(LLM 看到的入口)
- `src/main/pi/tools/read/` —— 子树:`path-utils`(selector 语法)+ `dispatch`(scheme/extension 路由)+ `backends/{filesystem,internal-url,office}`(具体实现)
- `src/main/pi/tools/read/impl/readOfficeFile.ts` —— office 重模块业务(被 office backend 通过 `await import()` 推迟到首调)

模块级深度文档:[src/main/pi/tools/ai.prompt.md](../src/main/pi/tools/ai.prompt.md)。

---

## 2. 起源:LLM 视角看"读"

OMP 的 `read` 工具只暴露 **1 个参数** `path: string`,覆盖文件 / URL / 内部资源 / 归档 / SQLite / 图片 / 文档全部场景。对照 deskmate Phase 9a 之前:

- `read_file(filePath, startLine, endLine, lineCount, description)` —— 5 字段
- `read_office_file(filePath, description, fileName, fileSize, fileType, mimeType, startLine, endLine, lineCount, startPage, endPage)` —— **11 字段**
- 总计 LLM 要在两个工具 + 16 个字段间做选择题

LLM 选择题不仅累 token,更累**正确率** —— prompt 越长、字段越多,LLM 选错的概率超线性上升。

**核心洞察**(omp 的原创):
- LLM 训练数据里 `read foo.txt:50-200` 这种 shell-style 形态见过亿万次;`read_file({ filePath: "foo.txt", startLine: 50, endLine: 200 })` 这种自定义 JSON schema **没见过**
- "去哪取数据"(scheme)和"读什么子结构"(行号/页码)是**两个正交维度**,应该用两套独立语法承载,不是一锅塞进字段集

---

## 3. 两层架构:**协议层 + 语法层完全正交**

```
   read({ path: "skill://my-skill:50-200" })
                  │
                  ▼ splitPathAndSel
   ┌──────────────────────────────────────┐
   │ path = "skill://my-skill"            │
   │ sel  = "50-200"                       │
   └──────────────┬───────────────────────┘
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
  ┌──────────┐         ┌──────────┐
  │ 协议层   │         │ 语法层   │
  │ (scheme) │         │(selector)│
  └────┬─────┘         └────┬─────┘
       │                    │
       ▼                    ▼
  InternalUrlRouter    parseSelector
  → SkillHandler       → {ranges, pages, raw}
  → AgentHandler ...   → 一段 / 多段 / raw 组合
```

**两层独立扩展**:
- 加新 scheme = 实现 `ProtocolHandler` + register → **不动 selector 语法**
- 加新 selector 形态 = 改 `path-utils` 白名单 → **不动 handler 注册表**
- 加新文件格式分发 = 在 dispatch 加扩展名 case → **不动以上任何一个**

---

## 4. 协议层:`InternalUrlRouter`

### 4.1 契约

```typescript
interface ProtocolHandler {
  readonly scheme: string;        // 'skill' / 'agent' / 'local' / ...
  readonly immutable: boolean;    // 决定能否被 write/edit 改
  resolve(url: ParsedInternalUrl, ctx: ResolveContext): Promise<InternalResource>;
  write?(url, content, ctx): Promise<void>;        // optional
  complete?(query: string): Promise<UrlCompletion[]>; // optional
}

interface ResolveContext {
  readonly profileId: string;     // deskmate multi-tenant 必需
  readonly agentId: string;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}
```

### 4.2 设计纪律(与 omp 同源,deskmate 自家纪律)

| 维度 | 形态 |
|---|---|
| **进程级单例 + 重名 throw** | 与 `tools.register` / `appcmd registry` 同纪律,模块加载期暴露冲突 |
| **handler 无状态** | 所有 per-session / per-profile 状态走 `ResolveContext` 注入 —— 不允许 handler 读全局/静态字段 |
| **scheme 表能力,不表存储位置** | `skill://foo` 在 LLM 视角是"找名为 foo 的 skill",handler 自己映射到 `${userData}/profiles/{pid}/skills/foo/SKILL.md`。**Profile / Agent 路径绝不进 LLM 可见字符串** |
| **保留 host 大小写 + 容许 host 内嵌 `:`** | 自研 `parseInternalUrl`(不走 `new URL()`)—— skill name / agent id 大小写敏感;`skill://plugin:name` 这种 namespace 形态合法 |
| **`immutable` 由 router 统一回填** | handler 自身字段定 `immutable: true/false`,router 在返回 `InternalResource` 时填上 —— handler 不必每次自己 set |
| **错误消息对 LLM 友好** | 不暴露绝对路径、不带 stack、列出 supported schemes |

### 4.3 与 omp 的偏离(必须 + 故意)

| 维度 | omp | deskmate | 理由 |
|---|---|---|---|
| `ResolveContext` 必有 `profileId/agentId/sessionId` | 无(单 agent) | 有 | multi-tenant 必需 |
| 重名 register | 静默覆盖 | throw | deskmate 全仓 registry 统一纪律 |
| `cwd` / `settings` / `localProtocolOptions` | 有 | 暂无 | 后续接入 `local://` 时再补 |
| `static instance()` / `resetForTests()` | omp 命名 | `static get()` / `resetForTesting()` | 与 `Profile.resetForTesting` 等 deskmate 命名对齐 |

### 4.4 已落地 handler

| Scheme | Handler | 用途 | Immutable | 可写 |
|---|---|---|---|---|
| `skill://<name>` | `SkillProtocolHandler` | 读当前 profile 下 skill 的 SKILL.md | ✅ | — |
| `local://<path>` | `LocalProtocolHandler` | 当前 session 私有文件 sandbox(`session.filesDir()`)。**跨 RegularSession + JobRun 形态**(经 `Agent.findSessionAcrossKinds`):调度任务 turn loop 注入的 `ctx.sessionId` 是 JobRun id 时,落到 `agents/{a}/schedules/{j}/runs/{ym}/{s}/files/`。 | ❌ | ✅ |
| `knowledge://<path>` | `KnowledgeProtocolHandler` | 当前 agent 的 Knowledge Base(占位符展开后路径,缺省 `${agentRoot}/knowledge`) | ❌ | ✅ |

**Phase 9c 新增**:
- `InternalUrlRouter.write(input, content, ctx)` —— 让 `write` 工具按 scheme dispatch
- `ResourceNotFoundError` —— handler ENOENT sentinel(替代字符串匹配)
- `local://` / `knowledge://` 都做 sandbox 边界检查(走 `parsed.rawPathname`,不依赖未来可能的 URL 规范化)
- 1MB 上限 + NUL byte 拒绝 —— InternalResource 文本-only 契约的硬边界

**留口未实现**(types.ts 已声明):
- `complete?(query)` —— renderer 自动补全 UI 接入

### 4.5 加新 handler 的代价

```typescript
// src/main/pi/internal-urls/handlers/agent-protocol.ts (示例,未实现)
export class AgentProtocolHandler implements ProtocolHandler {
  public readonly scheme = 'agent';
  public readonly immutable = true;
  public async resolve(url, ctx) {
    const profile = await Profile.getOrLoad(ctx.profileId);
    const agent = await profile.getAgent(url.host);
    if (!agent) throw new Error(`Agent "${url.host}" not found.`);
    return {
      url: url.href,
      content: agent.markdownBody,
      contentType: 'text/markdown',
      size: Buffer.byteLength(agent.markdownBody),
    };
  }
}

// src/main/pi/internal-urls/index.ts
router.register(new AgentProtocolHandler()); // 一行
```

**改 0 行** `read.ts` / `dispatch.ts` / 已有 handler / `types.ts`。这是协议层抽象的核心价值 —— 接口稳定,实现增量。

---

## 5. 语法层:selector

### 5.1 语法形态(`<path>:<sel>`)

```
src/foo.ts                   ← 全文(text: head 500 行 / 128KB)
src/foo.ts:50                ← 单行 anchor
src/foo.ts:50-200            ← 闭区间
src/foo.ts:50-               ← 开放结尾(到 EOF)
src/foo.ts:50+150            ← count 形态(150 行起于第 50)
src/foo.ts:raw               ← 关闭分页/智能 hint

report.pdf:p3                ← 单页(office 文档)
report.pdf:p3-7              ← 页区间
report.pdf:p3-7:50-100       ← 页 + 页内行号
report.pdf:p3-7:50-100:raw   ← 三件套,顺序无关

skill://my-skill             ← internal resource
skill://my-skill:50-100      ← internal resource + 行号(在 router 返回的文本上切片)
```

### 5.2 解析规则

| 规则 | 形态 |
|---|---|
| **严格白名单** | `SELECTOR_CHUNK_RE = /^(?:raw\|p\d+(?:[-+]\d+)?\|p\d+-\|\d+(?:[-+]\d+)?\|\d+-)$/i`。不匹配 = 不是 selector |
| **贪心向前合并** | `splitPathAndSel` 从尾部 `:` 开始,只要符合白名单就继续向前剥 —— 支持任意长度合法链 |
| **失败模式安全** | 文件名 `foo:bar.txt` 中 `bar.txt` 不匹配 → 整段当 path,不被误吞 |
| **多段同类型禁用** | `:5-10:20-30`(两段 line range) / `:p1-3:p5-7`(两段 page range)抛错 —— 防"以为是多段范围"的歧义。**单段 line + 单段 page + raw** 是合法上限 |
| **`raw` 与 deskmate 现状** | 字段已解析,backend 暂不消费(`filesystem` 不影响行为,`office` 不影响行为)。预留给"绕开 minified 截断 / 跳过结构化"未来开 |

### 5.3 行号 vs 页码:借同一 `LineRange` shape

```typescript
interface LineRange {
  readonly startLine: number;       // page 时复用此字段表 "start page"
  readonly endLine?: number;         // open-ended 时 undefined
}

interface ReadSelector {
  readonly ranges: readonly LineRange[];  // 行号(当前最多一段)
  readonly pages: readonly LineRange[];   // 页码(当前最多一段)
  readonly raw: boolean;
}
```

字段名不重命名是为**复用 parser 函数**(`parseLineRangeChunk` 与 `parsePageRangeChunk` 语法完全同构,仅前缀差 `p`)+ 避免接口爆炸。**调用方知道这里是 page 语义**(office backend 把它转译成 `startPage`/`endPage`)。

---

## 6. `read` 工具:1 个参数,3 条 backend

### 6.1 LLM 看到的形态

```typescript
const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    path: { type: 'string', description: '...' },
  },
  required: ['path'],
});
```

**1 个字段。** description 详尽列举形态示例 + selector 语法 + `<critical>` 禁止 bash 读文件 ——~1.5KB 的 prompt,~30% of omp 同维度。

### 6.2 内部 dispatch

```typescript
// src/main/pi/tools/read/dispatch.ts
const { path, sel } = splitPathAndSel(args.path);
const selector = sel ? parseSelector(sel) : { ranges: [], pages: [], raw: false };

if (isInternalUrlInput(path)) return readInternalUrl({ path, selector }, ctx);
const ext = nodePath.extname(path);
if (isOfficeExtension(ext)) return readOffice({ path, selector }, ctx);
return readFilesystem({ path, selector, signal: ctx.signal });
```

**两级判断:scheme 优先,扩展名次之,fallback filesystem。** 失败模式安全 —— 任何不识别的输入退化为本地 path,让 fs 自己抛 ENOENT(消息更具体)。

### 6.3 三条 backend

| Backend | 业务 | dependencies |
|---|---|---|
| `filesystem.ts` | 流式分页读 + 三重安全限制(line / byte / line-length)+ probe(fileTypeHint, minified detection)+ 二进制拒绝。从旧 `readFile.ts` 整段内化,业务等价 | 仅 node `fs` / `readline` |
| `internal-url.ts` | dispatch 到 `InternalUrlRouter.resolve()`,再按 selector 在内存里按行切片 | InternalUrlRouter |
| `office.ts` | dispatch 到 `impl/readOfficeFile`(PDF/DOCX/PPTX/XLSX 文本提取);**backend 内部 lazy import**(`cachedImpl` + `inflight` promise 防双重 evaluate) | mammoth / jszip / pdfreader(~1MB,独立 lazy chunk) |

### 6.4 lazy 加载范式

**两种**:

```typescript
// (1) 旧 lazy(spec, loader) —— 适合"一个工具一个 impl"的 LLM-visible 入口
tools.register(lazy(
  { name: 'some_heavy', description: '...', parameters: PARAMS },
  () => import('./impl/<name>').then((m) => m.handler),
));

// (2) backend 内部 await import() —— 适合 multi-backend 工具的子分支(read.office)
let cachedImpl, inflight;
async function loadImpl() {
  if (cachedImpl) return cachedImpl;
  if (!inflight) {
    inflight = import('../impl/readOfficeFile').then((m) => (cachedImpl = m.ReadOfficeFileTool));
  }
  return inflight;
}
```

**bundle 行为完全等价** —— `impl/<name>` 是独立 lazy chunk,首调时才解析,不进 startup main bundle。

---

## 7. 历史 session:不兼容,接受 UI 退化

用户的历史 session jsonl 里仍含 `toolName === 'read_file'` 的 tool result message
和 `{ filePath, content, startLine, endLine, ... }` 形态的 payload(legacy schema)。

**设计决策(Phase 9b 后期 cleanup)**:**不**在 `fullModeCompressor` 加双名 /
双字段兼容代码。理由:

- 兼容代码会让"`read_file` / `filePath` 字面量是否仍在用"长期模糊,误导未来
  维护者 —— 看到代码以为还在产生,实际只在历史 session 出现一次
- compressor 的"结构化预压缩"只是优化路径 —— 不命中只会走 default 文本 slice
  preview,**功能不损失**,只是历史 session 压缩效果略弱
- renderer 历史 session UI 同样不兼容 —— `toolName === 'read_file'` 显示为
  `Used read_file`(default fallback),不再有专用图标和文案

**纪律**:**唯一接受 legacy 名字 / 字段的代码点是 0 个**。任何"接受 `read_file`"
或"接受 `filePath`"的判断 = bug。

---

## 8. Phase 历史

| Phase | 内容 | 顶层工具数 |
|---|---|---|
| **9a** | 建立 `InternalUrlRouter` + `SkillProtocolHandler` + 新 `read` 工具骨架(filesystem + internal-url + office backend);与旧 `read_file` / `read_office_file` 并存作 fallback | 10 → 11(并存) |
| **9b** | 补 `:pN` page selector(office 文档不再因 page selection 退化);物理删旧 `read_file` / `read_office_file`;office backend 改为直接 lazy-import impl;`fullModeCompressor.buildReadFilePreview` 改名为 `buildReadPreview` 并改为只认新 `read` toolName + 新 schema 字段(`url` / `fileName`)—— **0 legacy 兼容**;67 个新/改测试 | 11 → **9** |
| **9c** | URI 三层统一第一阶段(详见 `unifed-uri.md` Phase A):新增 `LocalProtocolHandler` / `KnowledgeProtocolHandler`(都可写,sandbox 边界走 `rawPathname` + `path.resolve` 检查;1MB 上限 + NUL byte 拒绝);`InternalUrlRouter.write()` + `ResourceNotFoundError` sentinel;`write` 工具按 scheme 分发到 router(支持 4 种 mode,overwrite 跳过 read-original 让 read-only scheme 错误能正确传出);LocalTool handler 把 `ToolContext` 透传到 `writeInternal`。31 个新增 / 10 个 write-tool 集成测试 | 9 |

详见 [tool-system.md §10 Phase 表](tool-system.md) Phase 9a / 9b / 9c 行。

---

## 9. 已立的基础设施(后续可复用)

| 模块 | 价值 |
|---|---|
| `internal-urls/types.ts` | 完整契约(`ProtocolHandler` + `InternalResource` + `ResolveContext` + 可选 `write?` / `complete?` / `WriteContext` / `UrlCompletion`)+ `ResourceNotFoundError` sentinel —— 加新 scheme 0 行 types 改动 |
| `internal-urls/parse.ts` | `parseInternalUrl(input)` 处理 host 大小写 + host 内嵌 `:` + path 规范化前的 `rawPathname`(`local://` / `knowledge://` 防 `..` 遍历的入口) |
| `internal-urls/router.ts` | 单例 + register / canHandle / resolve / **write** / unregister / schemes;`InternalUrlRouter.resetForTesting()` 测试入口 |
| `tools/read/path-utils.ts` | `splitPathAndSel` + `parseSelector` + `parseLineRangeChunk` + `parsePageRangeChunk`;加新 chunk 类型(如 `c<col>` 列选择)只改一个文件 |
| `tools/read/dispatch.ts` | 两级 dispatch 路由表(scheme → router / extension → office backend / default → filesystem)|
| `tools/read/backends/internal-url.ts` | "router 返回的文本上按行切片"的通用模板 —— 加新协议时不动它 |
| `tools/read/__tests__/office-backend.test.ts` | `vi.mock` 拦截重模块 + 断言 selector → impl args 翻译的范式(测试不真跑 mammoth/pdfreader)|

---

## 10. 注意事项

- **scheme 是"屏蔽数据源"的抽象层** —— `skill://` / `agent://` 这种"LLM 没法靠路径猜出在哪"的资源才该有;`text://` / `office://` 没屏蔽任何东西,只是给 LLM 母语强加方言,**禁止**这类工具方言 scheme
- **handler 错误消息绝不暴露绝对路径** —— `Skill "foo" not found in current profile.` 而不是 `ENOENT: /Users/.../profiles/p_abc/skills/foo/SKILL.md`。LLM 看到的就是这条消息
- **selector 解析失败抛 Error,被 registry 收成 `{ ok: false }`** —— 不要自己 try/catch + 返回 ToolResult
- **office backend 不绕开 lazy import** —— 直接顶层 `import` impl 会把 mammoth/jszip/pdfreader 灌进 startup main bundle(~1MB 体积膨胀)。改这文件前先看注释里的 "Dynamic import exception:" 标记 —— 这是项目规则 `ts-no-dynamic-import` 的合规标记
- **零 legacy 兼容** —— 任何"接受 `read_file` toolName"或"接受 `filePath` 字段"的判断都是 bug。历史 session 在 compressor / renderer 下走 default 回退,接受这种 UI 退化,**不**为它写代码
- **不要复活 `lineCount` 参数** —— 已被 `:N+K` selector 等价表达;复活会出现两种语法表达同一件事的歧义
- **`splitPathAndSel` 的白名单是唯一边界** —— 改 `SELECTOR_CHUNK_RE` 时必须配套改 `parseSelector` 的 chunk 分类逻辑,**两者必须同步**;不一致会导致"切下来但 parser 不认"的死路
- **`:` 后缀 ≠ `?query=`,两者各管各的语义类型** —— `:` 后缀承载"已确定的单一资源内,再向下定位一个子结构"(行 / 页 / raw / archive entry / SQLite table:key),对齐 vim / grep / git permalink / Python traceback 等 LLM 训练语料里高频的"路径锚点"习惯,token 短、形态可猜、description 几乎不用教;`?query=` 留给"对一组同质资源按属性过滤 / 分页"(未来场景:`agent://?type=task&enabled=true` 列表过滤、`log://?level=warn&since=10m` 日志查询、`session://?label=bug` session 搜索),对齐 HTTP / web API 的 query 习惯。**绝不**把行号 / 页码这种锚点语义改写成 `?range=` / `?page=` —— `?range=` 这个 token 在 LLM 语料里几乎不存在(HTTP 里行号是 `Range:` header 不是 query),换过去 LLM 会按"过滤参数"的味道乱填,token 数还涨 3 倍。两套语法在 path 的不同位置(`?` 之前 vs `:` 之后)互不冲突,共存即可
- **绝对路径在 LLM 视角是边缘 case,不是主路径** —— URI(`local://` / `knowledge://` / `skill://`)走精确高亮 + 关联视图、是工具 args/result 的 first-class 形态;绝对路径只在 LLM 显式 `read /etc/hosts` 这种**外部 fs** 场景出现,renderer `extractFilePathsFromText` 的 abs path 正则**仅作兜底分支**保留(URI 主匹配 + abs 降级)。新增 LLM-facing 字段时默认要求 URI,绝对路径分支需要单独论证
- **不在 system prompt 里"请求"LLM 用 URI** —— 弱约束,LLM 会偶发破坏。真正有效的强约束是工具 args / result schema 全 URI(LLM 看见的样本驱动它的输出形态)。如果某工具字段叫 `fileUri` 却承载绝对路径,那是**字段名漂移 = 反训练样本**(LLM 学到"fileUri 可以是 abs",反过来污染其它工具的 args),按必修缺陷对待:让默认值落 sandbox(`download.saveDirectory` 默认 `local://` 是范本),URI 入则 URI 出 / abs 入则 abs 出

---

## 11. 相关模块

- 同级:[Tool System](tool-system.md) —— LocalTool registry / `app` shell facade / `read` 工具的所属生态
- 同级:[Agent Loop](agent-loop.md) —— turn loop 调 `read.handler(args, ctx)` 的上下文
- 上游:[src/main/pi/tools/ai.prompt.md](../src/main/pi/tools/ai.prompt.md) —— 模块级深度文档(LocalTool 契约 / lazy 范式 / 注册顺序)
- 上游:[tool-system.md §10 Phase 表](tool-system.md) —— Phase 9a / 9b 行简述变更要点
- 被依赖:[Compression](../src/main/lib/compression/README.md) —— `fullModeCompressor.buildReadPreview` 消费 `read` 工具的 result schema
- 设计来源:omp `read` 工具(`@oh-my-pi/pi-coding-agent`)+ omp `InternalUrlRouter` —— 范式同源,deskmate 在 multi-tenant 维度做必要偏离
