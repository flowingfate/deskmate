// MCP server 表单的纯逻辑：transport 类型、配置文本互转与版本号工具。
// 不含任何 React / DOM 依赖，方便单测与复用。

import type { MCPServerExtended } from '@/lib/mcp/mcpClientCacheManager'

/** MCP 支持的传输类型 */
export type McpTransport = 'stdio' | 'sse' | 'StreamableHttp'

/** 下拉里可选的 transport 顺序 */
export const MCP_TRANSPORTS: readonly McpTransport[] = ['stdio', 'sse', 'StreamableHttp']

/** 各 transport 的展示名 */
export const TRANSPORT_LABELS: Record<McpTransport, string> = {
  stdio: 'Stdio',
  sse: 'SSE',
  StreamableHttp: 'StreamableHttp',
}

/** 清理会导致 JSON 解析失败的不可见字符 */
export function cleanInvisibleCharacters(text: string): string {
  return text
    .replace(/\u00A0/g, ' ') // NBSP
    .replace(/\u202F/g, ' ') // narrow no-break space
    .replace(/\u2060/g, '') // word joiner
    .replace(/\uFEFF/g, '') // BOM
    .replace(/\u180E/g, ' ') // Mongolian vowel separator
    .replace(/\u200B/g, '') // zero-width space
    .replace(/\u200C/g, '') // zero-width non-joiner
    .replace(/\u200D/g, '') // zero-width joiner
}

/** 基于时间戳生成默认 server 名 */
export function generateTimestampServerName(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `mcp-server-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/** patch 版本号自增（"1.0.0" -> "1.0.1"），格式异常时原样返回 */
export function incrementPatchVersion(version: string): string {
  const parts = version.split('.')
  if (parts.length === 3) {
    const patch = parseInt(parts[2], 10)
    if (!Number.isNaN(patch)) {
      return `${parts[0]}.${parts[1]}.${patch + 1}`
    }
  }
  return version
}

/** 把既有 server 转成编辑器里展示的 JSON 文本 */
export function serverToConfigJson(server: MCPServerExtended): string {
  const config: Record<string, unknown> = {}
  if (server.transport === 'stdio') {
    config.command = server.command || ''
    config.args = server.args || []
  } else {
    config.url = server.url || ''
  }
  if (server.env && Object.keys(server.env).length > 0) {
    config.env = server.env
  }
  return JSON.stringify(config, null, 2)
}
