/**
 * 在不引入 typebox / pi-ai 运行时值的前提下,把 JSON Schema 字面量当作
 * `TSchema` 喂给 pi-ai。
 *
 * 为什么不直接 `import { Type } from '@earendil-works/pi-ai'`?
 *   - pi-ai 是 ESM-only,主进程是 CJS bundle,整仓库统一动态 import
 *     (见 `pi/ai.prompt.md`)。
 *   - 工具 spec 在模块加载期构建,要 sync;dynamic import 不可用。
 *
 * pi-ai provider 全部按 plain JSON Schema 读 `tool.parameters`
 * (`openai-completions.js`:`// TypeBox already generates JSON Schema`),
 * 不依赖 typebox 的 symbol-key 元数据。`validation.js::validateToolCall`
 * 在 `!hasTypeBoxMetadata && isJsonSchemaObject` 路径下显式接受普通
 * JSON Schema。所以裸 JSON Schema 字面量 + cast 是合法路径。
 *
 * 代价:`Static<typeof Params>` 在裸 JSON Schema 上推不出强类型 args ——
 * handler 内拿到的 args 是 `unknown`,由 caller 在入口处一次性 cast 成
 * 工具自己声明的 args interface。这把"运行期由 pi-ai 验证"和"开发期由
 * TS 编辑"的边界画清楚:验证在 pi-ai;编辑契约由 args interface 担当。
 *
 * --------------------------------------------------------------------------
 * 类型边界 (这一节决定 typing 收紧到哪里)
 *
 *   ✅ 我们 typed 的: schema literal 本身的结构。`type`/`properties`/
 *      `required`/`enum`/`items`/`additionalProperties`/各 leaf 的约束
 *      关键字 (`minimum`/`pattern`/`minItems` 等) 必须长成 JSON Schema 应有
 *      的形状,`required` 元素必须是 `keyof properties`。
 *
 *   ❌ 我们不 typed 的: 让 schema 反推 args 类型。那等于在仓库里重造半个
 *      typebox/zod。handler 入口 `as ArgsInterface` 的契约保持不变 ——
 *      这是 schema.ts 顶部注释亲口承诺的责任划分。
 *
 *   保留 `as unknown as TSchema`: typebox 的 `TSchema` 带 brand 字段
 *      (Static<T> 推导依赖),plain literal 在 TS 看来不是 `TSchema`。
 *      这层断言是 schema.ts 存在的根本理由,不能去掉。
 */

import type { TSchema } from '@earendil-works/pi-ai';

/* ---------------------------------------------------------------------- */
/* Schema 节点定义 (discriminated union by `type`)                         */
/* ---------------------------------------------------------------------- */

interface JsonSchemaCommon {
  readonly description?: string;
  readonly default?: unknown;
}

export interface JsonStringSchema extends JsonSchemaCommon {
  readonly type: 'string';
  readonly enum?: readonly string[];
  /** JSON Schema `format`: 'uri' / 'email' / 'date-time' 等 */
  readonly format?: string;
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface JsonNumberSchema extends JsonSchemaCommon {
  readonly type: 'number' | 'integer';
  readonly enum?: readonly number[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface JsonBooleanSchema extends JsonSchemaCommon {
  readonly type: 'boolean';
}

export interface JsonNullSchema extends JsonSchemaCommon {
  readonly type: 'null';
}

export interface JsonArraySchema extends JsonSchemaCommon {
  readonly type: 'array';
  readonly items: JsonSchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
}

/**
 * 嵌套对象节点 —— 顶层入口走 `JsonObjectSchema`,嵌套时也复用这条。
 *
 * `properties` 必填:JSON Schema 标准里 `type: 'object'` 不带 `properties`
 * 与 `properties: {}` 完全等价(都是"无固定字段")。把字段做成 required 的
 * 好处是 `const T` 能稳定推断到 literal 形状,`required` 数组的元素才能
 * 真正走 `keyof P` 校验。dict 形态(`additionalProperties: { type: 'string' }`)
 * 显式写 `properties: {}` 让"无固定字段"成为可见声明,不依赖默认。
 */
export interface JsonObjectSchema<
  P extends Record<string, JsonSchemaNode> = Record<string, JsonSchemaNode>,
> extends JsonSchemaCommon {
  readonly type: 'object';
  readonly properties: P;
  readonly required?: readonly (keyof P & string)[];
  /**
   * `false` = 禁止额外字段;`true` = 允许任意;给定 schema = 额外字段必须
   * 满足该子 schema (现有 codebase 里 dict 形态用法: `additionalProperties: { type: 'string' }`)。
   */
  readonly additionalProperties?: boolean | JsonSchemaNode;
}

export type JsonSchemaNode =
  | JsonStringSchema
  | JsonNumberSchema
  | JsonBooleanSchema
  | JsonNullSchema
  | JsonArraySchema
  | JsonObjectSchema;

/* ---------------------------------------------------------------------- */
/* Helper                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * 把一个 plain JSON Schema 字面量装成 pi-ai 期望的 `TSchema`。
 *
 * 显式 generic over `P`(properties 形状):光写 `T extends JsonObjectSchema`
 * 会让 TS 走 `JsonObjectSchema` 的默认 `P = Record<string, JsonSchemaNode>`
 * 分支,`required` 的 `keyof P` 检查直接退化成 `string`,拦不住拼写错。
 * 把 `P` 提到外层显式推断,literal 形状才会被锁住,`required` 才真的会
 * 走 `keyof P` 校验。
 *
 * 用法:
 *   ```
 *   const PARAMS = jsonSchema({
 *     type: 'object',
 *     properties: { filePath: { type: 'string' } },
 *     required: ['filePath'],
 *   });
 *   ```
 */
export function jsonSchema<
  const P extends Record<string, JsonSchemaNode>,
  const T extends JsonObjectSchema<P>,
>(literal: T): TSchema {
  return literal as unknown as TSchema;
}
