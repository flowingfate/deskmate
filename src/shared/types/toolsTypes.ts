/**
 * 本地工具元数据(renderer 端展示用)。与 pi-ai 的 `Tool<TSchema>` 同形态,
 * 但 `parameters` 在 IPC 边界拍平成 plain JSON Schema 对象 —— renderer 不
 * 依赖 typebox 运行时。
 */
export interface LocalToolInfo {
  name: string;
  description: string;
  /** JSON Schema(plain object),与 `Tool.parameters` 等价但脱 typebox 类型。 */
  inputSchema: Record<string, unknown>;
}
