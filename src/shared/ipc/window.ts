import { connectRenderToMain, connectMainToRender } from './base';

// ──────────────────────────────────────────────
// Render → Main
// ──────────────────────────────────────────────

type RenderToMain = {
  minimize: { call: []; return: void };
  maximize: { call: []; return: void };
  unmaximize: { call: []; return: void };
  close: { call: []; return: void };
  openProfile: { call: [profileId: string]; return: void };
  isMaximized: { call: []; return: boolean };
  isFullScreen: { call: []; return: boolean };
  zoomIn: { call: []; return: number };
  zoomOut: { call: []; return: number };
  resetZoom: { call: []; return: number };
  getZoomLevel: { call: []; return: number };
  showAppMenu: { call: [x: number, y: number]; return: boolean };
  setAlwaysOnTop: { call: [flag: boolean]; return: boolean };
  isAlwaysOnTop: { call: []; return: boolean };
  setSize: { call: [width: number, height: number]; return: boolean };
  getSize: { call: []; return: { width: number; height: number } };
  setMinSize: { call: [width: number, height: number]; return: boolean };
  setMaxSize: { call: [width: number, height: number]; return: boolean };
  getMinSize: { call: []; return: { width: number; height: number } };
  getMaxSize: { call: []; return: { width: number; height: number } };
};

// ──────────────────────────────────────────────
// Main → Renderer
// ──────────────────────────────────────────────

export type MainToRender = {
  stateChanged: string;
  fullScreenChanged: boolean;
  zoomChanged: number;
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('window');
export const mainToRender = connectMainToRender<MainToRender>('window');
