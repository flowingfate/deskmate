import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * AsyncLocalStorage 只补充本次运行实际执行任务的普通 Agent 身份。
 * parent Agent 与 parent session 仍由 ToolContext / ResolveContext 显式传递，
 * 不能在这里复制，避免形成第二个 identity 来源。
 */
export interface DelegateExecutionContext {
  readonly delegateId: string;
}

const delegateExecutionScope = new AsyncLocalStorage<DelegateExecutionContext>();

export function runWithDelegateExecution<T>(
  context: DelegateExecutionContext,
  action: () => Promise<T>,
): Promise<T> {
  return delegateExecutionScope.run(context, action);
}

export function getDelegateExecution(): DelegateExecutionContext | undefined {
  return delegateExecutionScope.getStore();
}

export function isDelegatedExecution(): boolean {
  return getDelegateExecution() !== undefined;
}
