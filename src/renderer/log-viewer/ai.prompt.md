<!-- Last verified: 2026-06-08 (revised: LifePicker + IPC lives() + TracesView 改 span 树视图 + spanTree 纯函数模块) -->

# Log Viewer 渲染层（`src/renderer/log-viewer/`）

> dev-only Log Viewer 窗口的 React 树。独立 HTML/entry，独立 preload，独立 view 路由。
> 通过 `logViewer` IPC 命名空间读 sqlite；自身**不写日志**（防成环）。

## 关键文件

| 文件 | 职责 |
|------|------|
| `App.tsx` | 三栏根（SideNav + view 容器）；view 切换状态 + 一次性 `traceFocus` 跨视图跳转契约 |
| `api.ts` | `viewerApi` / `viewerEvents` —— 用 shared `logViewer` 契约 `bindRender` 出强类型 proxy；lazy 取 `window.electronLogViewer` |
| `views.ts` | view 路由表（Logs / Errors / Traces / Stats / Saved），placeholder 标记 |
| `filter.ts` | toolbar 表单 → `LogQueryFilter` 转换；`FilterForm.lifeId` 是 `number\|null`（IPC 直传整数，不存在解析失败路径）|
| `levels.ts` | level 数值 / 标签 / 颜色映射 |
| `spanTree.ts` | `buildSpanForest(rows)` —— 把 trace 内 `LogRow[]` 折叠成 `SpanForest`（roots / DFS flat / orphans / 时间窗）；同 sid 的"始/终"行合并、psid 拼父子、读 `fields.dur` 推 endTs |
| `styles.css` | 入口 css，`@import "../styles/globals.css"` 复用 tailwind + shadcn token；叠 `--color-lvl-*` / `--color-vw-*` 专属语义；**light only** |
| `views/LogsView.tsx` | toolbar + 虚拟滚动表 + 详情抽屉 + Live 开关（订阅 `appended` 增量拉新行） |
| `views/TracesView.tsx` | 左 span tree + 右时间条带（buildSpanForest 重建）；hover 全宽游标 + DetailDrawer 复用；孤儿 row 单独分节 |
| `views/PlaceholderView.tsx` | 占位卡片（Errors / Stats / Saved），保持 toolbar 高度一致 |
| `components/SideNav.tsx` | 60px icon-only nav + Tooltip + brand mark + 底部 db 连接状态绿点 |
| `components/LogsToolbar.tsx` | 双 strip：title row（行数 + Live 角标 + Refresh）+ filter row（LifePicker · TimeRangePicker · Level · component · grep · traceId）|
| `components/LogTable.tsx` | `@tanstack/react-virtual` 虚拟滚动；Live 模式下 ref 解耦 + 单飞防抖；表头 Time 列可切换 desc/asc 排序 |
| `components/DetailDrawer.tsx` | 行详情；`Esc` 关；`onPickTraceId` 可选（Logs 渲染按钮；Traces 复用同组件但不渲染） |
| `components/LifePicker.tsx` | life_id 锚点选择器：popover 列出最近 N 个 life（IPC `lives()` 拉取）；选定时清空 since/until，让 life 维度独立于时间维度 |
| `components/LevelBadge.tsx` | 圆点 + 大写文字 pill |

## 架构

**入口隔离**：
- `src/renderer/log-viewer.tsx` + `src/renderer/log-viewer.html` 是独立 Vite entry，**不**走主窗口的 provider 栈 / 路由 / atom store。
- preload `src/preload/log-viewer.ts` 仅暴露 `window.electronLogViewer = { invoke, on, off }`（三件套）。**故意不**包含 `log.write` —— viewer 自身异常只走 `console.warn`，防止 viewer error → log → IPC → sqlite → `appended` → viewer 刷新 → viewer error 死循环。
- main 端 `src/main/log/viewer-window.ts` 注册 `logViewer.{getDbPath,query,stats,lives}` handler（`!app.isPackaged` 才注册）+ viewer 打开期间 250ms poll `max(id)` 通过 `logViewer.appended` 广播。

**强类型 IPC**：`api.ts` 用 `renderToMain.bindRender(...)` / `mainToRender.bindRender(...)` 把 preload 三件套包成 contract proxy；方法名 / 参数 / 返回由 `src/shared/ipc/logViewer.ts` 单一真相源派生。删 preload 白名单项编译期就会报错。

**view 路由**：`views.ts` 是数组+map，加新 view 只改这里 + 加组件。view 局部状态自治（form / rows / selected 等），切走丢弃 = 简洁；真要做持久化滚动 / filter 再上 atom。

**跨视图跳转**：App 持 `traceFocus: string | null` 一次性 focus。LogsView 详情抽屉点 `traceId` → `openTrace(id)` 切到 Traces + setTraceFocus；TracesView 通过 `initialTraceId + onConsumeInitial` 消费一次后即清空——避免用户重输 / 再切回时旧 traceId 自动复读。

**实时增量**：LogsView Live 开关订阅 `viewerEvents.appended(cb)`；`pending` 标志单飞防止 250ms 周期内多次推送同时发 query；`maxSeenIdRef / followRef / sortDirRef` 用 ref 避免 rows / follow / sortDir 变动重建订阅。buildQuery 返回 DESC：**desc 模式**下 LogTable 直接使用并 prepend 新行（若用户已离开顶部，按 `batch.length * ROW_HEIGHT` 补偿 `scrollTop`，避免视野中老日志被挤走）；**asc 模式**下 reverse 后 append 并滚到底（终端 tail 风格）。

**排序切换**：LogTable 内部 `sortDir` 局部 state，默认 `desc`。表头 Time 列点击切换；切换不重查 DB，原地 `reverse()` 当前 rows 并把 scroll 滚到对应端点（desc→top, asc→bottom）。选中行通过 id 匹配，切换不丢。

**Life 过滤**：LogsView 把 `lifeId: number | null` 放在 toolbar 最左（LifePicker），选 life 时自动清空 since/until —— life_id 已经隐含完整的"一次启动"时间窗口，再叠 since 会把本应同视角的日志切碎。`LogQueryFilter.lifeId` 走 `idx_logs_life` 索引；IPC `lives({limit})` 返回 LifeInfo[] 给下拉，按 `life_id DESC`、`max(life_id)` 标记 current。

**Trace 视图（span 树）**：TracesView 不再按 process_type 分通道，而是基于 `spanTree.buildSpanForest(rows)` 重建 span 森林。一个 span = 同 `(trace_id, span_id)` 的所有行合并（始 + 终复用 sid，终行带 `fields.dur`）；`psid → sid` 拼父子，DFS 展平后填 depth。左侧 320px tree-table（缩进 depth × 12px，显示 mod / sid / dur），右侧 SVG 时间条带按 `(startTs - minTs) / (maxTs - minTs)` 算 x，`dur` 决定条带宽度（hasError 红描边、孤儿 span 退化为圆点）。点击行 → DetailDrawer 显示该 span 的"始"行。无 `span_id` 的孤儿 row 单列一节，按 ts 排。

## 常见变更

- **加新 view**：往 `views.ts` `VIEWS` 加一项（id / label / icon / `placeholder?`）+ 在 `views/` 加组件 + `App.tsx` 的 renderView 加分支。占位 view 直接用 `PlaceholderView`。
- **加新 IPC 方法**：单一真相源 `src/shared/ipc/logViewer.ts` 加 method type → main `viewer-window.ts` 的 `handle.<method>(...)` 加注册 → preload `src/preload/log-viewer.ts` 白名单加 key（缺会编译报错）→ renderer 自动通过 `viewerApi.<method>` 可用。
- **改样式**：light 主题已校准（选中行蓝左条 + 淡蓝底；hover slate-50；level pill 用 `color-mix` 12% 透明）。改色请用 `--color-vw-*` / `--color-lvl-*` 变量，不要新增独立 token。

## 注意事项

- **shadcn 复用**：viewer 共享 `@/shadcn/*` 与 `@/lib/utilities/utils` 的 `cn()`；隐式带 `@radix-ui/react-tooltip / select / switch` 等（已在主应用 devDependencies 内，不新增）。
- **light only**：当前主题用户明确决定不加 dark 模式。改时记得不要 import `.dark` class。
- **不写日志**：viewer 内任何异常路径用 `console.warn / error`，**严禁** `import { log } from '@/log'`（成环风险）。
- **5000 row clamp**：main `handle.query` 把 `limit` clamp 到 `[1, 5000]`。极端 trace 5k+ 行场景需要分页 / 折叠，留作后续。
- **快捷键**：`Esc` 关 detail、`Cmd/Ctrl+R` 刷新（不依赖 menu）。

## 相关文件

- [src/main/log/ai.prompt.md](../../main/log/ai.prompt.md) — viewer-window 主进程侧、poll 实现
- [src/shared/log/ai.prompt.md](../../shared/log/ai.prompt.md) — 查询库 / types
- [src/shared/ipc/ai.prompt.md](../../shared/ipc/ai.prompt.md) — IPC 框架；`logViewer` 是标准命名空间
- [ai.prompt/log-analysis.md](../../../ai.prompt/log-analysis.md) — viewer 与 CLI 用法

## 协变映射

| 修改 | 同步检查 |
|------|---------|
| `src/shared/ipc/logViewer.ts` 契约 | `src/main/log/viewer-window.ts` handler；`src/preload/log-viewer.ts` 白名单；本目录 `api.ts` 不需要改（proxy 自动派生） |
| 新 view | `views.ts` + `views/` 加组件 + `App.tsx` renderView 分支 |
| 入口结构 | `src/renderer/log-viewer.html / .tsx`；`scripts/vite/ejs-template-plugin.ts` 入口注册；`vite` 多入口配置 |
| `LogQueryFilter` 新增过滤维度 | `src/shared/log/types.ts` + `src/shared/log/query/filter.ts` `buildWhere` 加分支 + `src/shared/log/query/__tests__/query.test.ts` 单测；viewer 端：`filter.ts` `FilterForm` + `buildFilterFromForm` + toolbar 控件 |
| `spanTree.ts` 改逻辑 | `src/renderer/log-viewer/__tests__/spanTree.test.ts` 单测同步；TracesView 渲染端依赖 `SpanForest.flat / roots / orphans / minTs / maxTs` 结构稳定 |
