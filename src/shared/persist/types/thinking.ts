/**
 * Reasoning / thinking 等级的跨进程常量定义。
 *
 * 与 pi-ai `ThinkingLevel` 完全等价（去掉了 `'off'` —— 我们用 `undefined`
 * 表示"使用 provider 默认"，不持久化任何字段；用 `'off'` 来表示"显式关闭"会
 * 与默认语义冲突，UI 端也没有这一档）。
 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** 枚举值列表，用于 runtime 校验 / dropdown 顺序展示。 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

/** 类型守卫：把 string | undefined 收敛到 ThinkingLevel | undefined。 */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === 'string'
    && (THINKING_LEVELS as readonly string[]).includes(value)
  );
}
