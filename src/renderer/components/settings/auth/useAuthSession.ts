/**
 * OAuth 登录的 session 状态机（Step 8）。
 *
 * 一次 startLogin 拿到 sessionId 后，main 通过 pi-auth 通道流式推送
 * auth / deviceCode / prompt / select / progress / loginComplete 事件。
 * 这里把它收敛成一个 reducer-friendly 的 union state，让 dialog 组件
 * 按 stage 切换 UI（device-code / prompt / select / progress）。
 *
 * cleanup（hook unmount 或 cancel）必须显式调 cancelLogin，否则 main 端
 * 的 onPrompt promise 永远 pending，登录 timeout 才会回收（5 分钟）。
 */

import type { IpcRendererEvent } from 'electron';
import { useCallback, useEffect, useRef, useState } from 'react';
import { piApi, piEvents } from '@/ipc/pi';
import { log } from '@/log';

const logger = log.child({ mod: 'useAuthSession' });

export type AuthStage =
  | { type: 'idle' }
  | { type: 'starting' }
  | { type: 'auth'; url: string; instructions?: string }
  | {
      type: 'deviceCode';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: 'prompt'; message: string; placeholder?: string; allowEmpty?: boolean }
  | { type: 'select'; message: string; options: Array<{ id: string; label: string }> }
  | { type: 'progress'; message: string }
  | { type: 'done'; success: true }
  | { type: 'done'; success: false; error: string };

export interface AuthSession {
  stage: AuthStage;
  provider: string | null;
  /** 进度提示 footer（每条 progress 事件覆盖前值）；与 stage 解耦显示 */
  progressMessage: string | null;
  start: (provider: string) => Promise<void>;
  submitPrompt: (value: string | undefined) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export function useAuthSession(): AuthSession {
  const [stage, setStage] = useState<AuthStage>({ type: 'idle' });
  const [provider, setProvider] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cleanupsRef = useRef<Array<() => void>>([]);

  const clearListeners = useCallback(() => {
    for (const off of cleanupsRef.current) off();
    cleanupsRef.current = [];
  }, []);

  const reset = useCallback(() => {
    clearListeners();
    sessionIdRef.current = null;
    setStage({ type: 'idle' });
    setProvider(null);
    setProgressMessage(null);
  }, [clearListeners]);

  const cancel = useCallback(async () => {
    const id = sessionIdRef.current;
    if (id) {
      try {
        await piApi.cancelLogin(id);
      } catch (err) {
        logger.warn({ msg: 'cancelLogin failed', err: String(err) });
      }
    }
    reset();
  }, [reset]);

  // unmount 时强制 cancel（包含异常路径），避免 main 端孤儿 session
  useEffect(() => () => {
    const id = sessionIdRef.current;
    clearListeners();
    if (id) {
      // fire-and-forget；组件已卸载，不必 await
      piApi.cancelLogin(id).catch((err) => {
        logger.warn({ msg: 'cancelLogin on unmount failed', err: String(err) });
      });
    }
  }, [clearListeners]);

  const subscribeAll = useCallback((sessionId: string, providerId: string) => {
    // 只处理当前 session 的事件；其他 session 一律丢弃（main 也只会发当前的，这一层是双保险）
    const match = <T extends { sessionId: string }>(handler: (p: T) => void) =>
      (_event: IpcRendererEvent, p: T) => {
        if (p.sessionId !== sessionIdRef.current) return;
        handler(p);
      };

    cleanupsRef.current.push(
      piEvents.auth(
        match<{ sessionId: string; url: string; instructions?: string }>(({ url, instructions }) => {
          setStage({ type: 'auth', url, instructions });
        }),
      ),
    );
    cleanupsRef.current.push(
      piEvents.deviceCode(
        match<{
          sessionId: string;
          userCode: string;
          verificationUri: string;
          intervalSeconds?: number;
          expiresInSeconds?: number;
        }>((info) => {
          setStage({
            type: 'deviceCode',
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            intervalSeconds: info.intervalSeconds,
            expiresInSeconds: info.expiresInSeconds,
          });
        }),
      ),
    );
    cleanupsRef.current.push(
      piEvents.prompt(
        match<{ sessionId: string; message: string; placeholder?: string; allowEmpty?: boolean }>(
          ({ message, placeholder, allowEmpty }) => {
            setStage({ type: 'prompt', message, placeholder, allowEmpty });
          },
        ),
      ),
    );
    cleanupsRef.current.push(
      piEvents.select(
        match<{
          sessionId: string;
          message: string;
          options: Array<{ id: string; label: string }>;
        }>(({ message, options }) => {
          setStage({ type: 'select', message, options });
        }),
      ),
    );
    cleanupsRef.current.push(
      piEvents.progress(
        match<{ sessionId: string; message: string }>(({ message }) => {
          setProgressMessage(message);
        }),
      ),
    );
    cleanupsRef.current.push(
      piEvents.loginComplete(
        match<{ sessionId: string; success: boolean; provider: string; error?: string }>(
          ({ success, error }) => {
            // 不在这里 clearListeners：让 dialog 看到 done 后由 UI 决定关闭并 reset
            sessionIdRef.current = null;
            if (success) {
              setStage({ type: 'done', success: true });
            } else {
              setStage({ type: 'done', success: false, error: error ?? 'Login failed' });
            }
          },
        ),
      ),
    );

    // provider 传进闭包仅做日志关联，不参与匹配
    void providerId;
    void sessionId;
  }, []);

  const start = useCallback(
    async (providerId: string) => {
      // 进入新 session 前清旧的（同 hook 不应并发，但保险起见）
      await cancel();
      setProvider(providerId);
      setStage({ type: 'starting' });
      setProgressMessage(null);

      const res = await piApi.startLogin(providerId);
      if (!res.success) {
        setStage({ type: 'done', success: false, error: res.error });
        return;
      }
      sessionIdRef.current = res.data!.sessionId;
      subscribeAll(res.data!.sessionId, providerId);
    },
    [cancel, subscribeAll],
  );

  const submitPrompt = useCallback(async (value: string | undefined) => {
    const id = sessionIdRef.current;
    if (!id) {
      logger.warn({ msg: 'submitPrompt without active session' });
      return;
    }
    const res = await piApi.submitPrompt(id, value);
    if (!res.success) {
      logger.warn({ msg: 'submitPrompt failed', err: res.error });
    } else {
      // 让用户在等待后端推下一帧（progress / done）之前先看到“等待中”状态
      setStage({ type: 'progress', message: 'Processing...' });
    }
  }, []);

  return { stage, provider, progressMessage, start, submitPrompt, cancel, reset };
}
