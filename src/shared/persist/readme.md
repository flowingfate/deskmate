
这里定义持久化存储的数据结构和相关操作。核心概念包括 Profile、Agent、Session 等，具体实现细节请参见各个类的定义和方法。
这里就算有工具方法，也是存内存操作，不依赖额外的环境 api。

## 模块清单

| 文件 | 内容 |
|---|---|
| `types.ts` | 全部磁盘 schema 类型（ProfilesIndexFile、ProfileFile、AgentRecord、SessionDataFile、ScheduleJobFile、...）|
| `id.ts` | UUIDv7 包装，生成带前缀的实体 id（`p_/a_/s_/j_`）|
| `markdown.ts` | AGENT.md 解析 / 序列化 / front-matter 局部 patch |
| `path.ts` | 持久化布局的纯路径拼接（不创建目录） |

## 约束

- **0 fs / 0 electron / 0 Node 环境 api**：所有 io 在 `src/main/persist/` 下完成。
- 这里的代码可以在 renderer / main / worker / 测试 中任意复用。
