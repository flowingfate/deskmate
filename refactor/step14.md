# Step 14 — 统一 Review、编写并运行新单元测试

> 状态：待执行
> 前置：Steps 1–13 complete，用户确认业务结构稳定；`unit-test.md` 已冻结候选
> 本步只做单元/模块测试和必要的真实bug修复，不做端到端测试。

## 1. 为什么最后统一做

用户会逐step review并可能改变方案。提前写大量测试会把尚未稳定的内部接口固化，产生反复重写。本步在全部业务逻辑稳定后一次性筛选真正保护contract的测试。

## 2. 开始前 review（必须与用户确认）

1. 逐条review `unit-test.md`；
2. 用户决定P0/P1/P2保留范围；
3. 删除已被实现证明无价值、过度依赖内部结构或属于E2E的候选；
4. 确认Step 12 implemented/deferred；
5. 确认不测试旧 `src/main/lib/subAgent`、旧persist store、旧app command和独立CRUD UI；
6. 读取各目标模块现有测试约定，避免第二套fixture/mocking风格；
7. impact计划新增测试文件。

用户未确认测试清单前，不开始写测试。

## 3. 测试分层与顺序

### Phase A — 纯函数/数据不变量

优先：

- `SubrunId` helpers、`normalizeSubAgentRunRequest`；
- Agent delegates graph normalization/resolution；
- capability policy matrix；
- result reducer/submit controller；
- cmdline parser。

这些测试快、稳定、定位精确。

### Phase B — Persist store

- allocator并发/reservation/exhaustion；
- subrun state/messages round-trip；
- stale running收敛；
- no SQL/files sandbox side effects。

沿用persist真盘/tmp和Electron Node ABI约定，不手写脆弱mock fs。

### Phase C — Session/Manager

- executor/owner resources；
- formal submit/stop；
- timeout actual abort；
- max parallel/total和finally cleanup；
- single/parent cancel；
- 多个独立 tool calls 并发 admission，单个失败不取消 siblings；
- persisted terminal result。

LLM provider使用仓库既有deterministic mock/stream fixture，不访问真实网络。

### Phase D — Command/IPC/Renderer data

- list/describe/run解析、manager adapter、安全投影与并行多调用usage；
- IPC ownership/cancel；
- renderer result/state reducer、reload final JSON；
- Agent editor patch/dangling logic；
- Dialog仅在Step12 implemented时测试lazy fetch state。

不做截图、Playwright、Electron E2E。

## 4. 测试质量标准

每条新测试必须：

- 保护observable contract或真实不变量；
- 对至少一个合理bug会失败；
- deterministic、isolated、全套可并行/顺序稳定；
- 不断言源码字符串、私有方法名称、日志完整文本或偶然排序；
- 不使用any/unknown/as Xxx规避项目类型规则；
- 不访问网络/真实用户目录；
- 不测试legacy reference代码。

## 5. 发现bug时的处理

- 测试暴露生产bug：修源头，更新对应业务step的执行记录和context（如果contract改变）；
- 测试与实现contract不一致：先判断规划还是实现错，不为了绿灯扭曲测试；
- 需要用户产品决定：停止并询问，不自行选更容易测试的语义；
- 禁止为通过测试添加compat shim或fake fallback。

## 6. 执行命令

按仓库规则：

1. 先运行新增测试的最小相关集合；
2. 再运行 `npm test`（Electron Node ABI脚本，不直接 vitest）；
3. `npm run build`；
4. `npm run check:impact -- <全部测试期实际修改文件>`；
5. 不运行任何E2E命令。

控制命令频率，每类接近完成时一次，不反复压机器。

## 7. 文档与收尾

- `unit-test.md`将候选标记为 implemented/dropped及原因；
- progress记录命令、通过/失败数量和修复；
- 测试导致contract变化时更新所有相关 ai.prompt日期；
- 不创建额外总结README；
- 本步完成后等待用户最终review。

## 8. 完成条件

- 用户批准的P0/P1测试已实现；
- 全部测试/build通过，或明确记录由用户决定不执行的项；
- 无E2E；
- 无legacy reference测试投入；
- progress显示14/14完成；
- 生产行为和文档没有因测试阶段偷偷改变。

## 9. 最终交付与 Review 门禁

本 step 没有后续实现步骤。完成后向用户交付最终测试与构建证据、被删除的候选测试及原因、仍未执行的 E2E/人工验证范围，然后停止等待最终 review。任何测试阶段暴露的产品决策仍须回写对应业务 step、`context.md` 和 `progress.md`，不能只改测试预期。
