import { connectRenderToMain, connectMainToRender } from './base';
import type { AppConfig } from '../types/appConfig';

// ──────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────

export interface PlatformInfo {
  platform: string;
  arch: string;
  isWindowsArm: boolean;
}

export interface CrashCaptureStatus {
  currentSessionId: string;
  crashRootDir: string;
  crashDumpsDir: string;
  hasRecoveredCrash: boolean;
  recoveredCrash: {
    eventType: 'recovered-unclean-exit';
    sessionId: string;
    previousSessionId: string;
    detectedAt: string;
    startedAt: string;
    pid: number;
    appVersion: string;
    bundlePath: string;
  } | null;
}

export interface RendererCrashReport {
  kind: 'error' | 'unhandledrejection' | 'react-error-boundary';
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  url?: string;
  componentStack?: string;
  metadata?: Record<string, unknown>;
}

export interface DebugInfoDownloadResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}

// ──────────────────────────────────────────────
// Render → Main
// ──────────────────────────────────────────────

type RenderToMain = {
  getVersion: { call: []; return: string };
  getName: { call: []; return: string };
  isDev: { call: []; return: boolean };
  isReady: { call: []; return: { success: boolean; data: boolean } };
  getPlatformInfo: { call: []; return: PlatformInfo };
  getUserDataPath: { call: []; return: string };
  getInstallationDeviceId: { call: []; return: string };
  getCrashCaptureStatus: { call: []; return: CrashCaptureStatus };
  recordCrashBreadcrumb: {
    call: [message: string, metadata?: Record<string, unknown>];
    return: void;
  };
  reportRendererError: { call: [report: RendererCrashReport]; return: void };
  getAppConfig: {
    call: [];
    return: { success: true; data: AppConfig } | { success: false; error: string };
  };
  updateAppConfig: {
    call: [updates: Partial<AppConfig>];
    return: { success: true } | { success: false; error: string };
  };
};

// ──────────────────────────────────────────────
// Main → Renderer
// ──────────────────────────────────────────────

export type MainToRender = {
  ready: boolean;
  configUpdated: { config: AppConfig; timestamp: number };
  debugInfoDownloaded: DebugInfoDownloadResult;
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('app');
export const mainToRender = connectMainToRender<MainToRender>('app');
