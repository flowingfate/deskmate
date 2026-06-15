export type SuccessResult<T = void> = T extends void
  ? { success: true }
  : { success: true; data: T };

export interface ErrorResult {
  success: false;
  error?: string;
}

export type IpcResult<T = void> = SuccessResult<T> | ErrorResult;
