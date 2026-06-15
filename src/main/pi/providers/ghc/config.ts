/**
 * GitHub Copilot 协议常量 —— 端点 URL、标识 header、OAuth Client ID。
 *
 * 这些 header 是 Copilot 后端识别合法 chat client 的协议必填字段，按
 * GitHub Copilot proxy 期望的值发送，**任何字符串值改动都会触发后端拒绝**。
 */
export const GHC_CONFIG = {
  // OAuth Device Flow client identity
  CLIENT_ID: 'Iv1.b507a08c87ecfe98',
  CLIENT_SECRET: undefined,

  // API endpoints
  API_ENDPOINT: 'https://api.githubcopilot.com',
  DEVICE_CODE_URL: 'https://github.com/login/device/code',
  ACCESS_TOKEN_URL: 'https://github.com/login/oauth/access_token',
  COPILOT_TOKEN_URL: 'https://api.github.com/copilot_internal/v2/token',

  // Editor identification headers required by the GitHub Copilot proxy.
  USER_AGENT: 'GitHubCopilotChat/0.26.7',
  EDITOR_VERSION: 'vscode/1.99.3',
  EDITOR_PLUGIN_VERSION: 'copilot-chat/0.26.7',
  INTEGRATION_ID: 'vscode-chat',

  // Standard headers bundle (kept verbatim for callers that wanted a single object)
  STANDARD_HEADERS: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'GitHubCopilotChat/0.26.7',
    'Editor-Version': 'vscode/1.99.3',
    'Editor-Plugin-Version': 'copilot-chat/0.26.7',
    'Copilot-Integration-Id': 'vscode-chat',
    'X-Request-Id': () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  },
};
