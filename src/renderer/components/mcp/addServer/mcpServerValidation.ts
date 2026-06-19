// MCP server 表单校验：名称查重 + 配置 JSON 结构校验。纯函数，无副作用。

import { cleanInvisibleCharacters, TRANSPORT_LABELS, type McpTransport } from './mcpServerConfig'

/** Stdio 配置示例（同时用作 textarea placeholder 与"禁止直接提交示例"判定） */
export const STDIO_EXAMPLE = `{
  "command": "python",
  "args": [
    "main.py"
  ],
  "env": {
    "API_KEY": "value"
  }
}`

/** SSE / StreamableHttp 配置示例 */
export const HTTP_EXAMPLE = `{
  "url": "http://localhost:8000/sse",
  "env": {
    "API_KEY": "value"
  }
}`

/** 校验 server 名称：非空且不与现有重名 */
export function validateServerName(name: string, existingNames: string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Server name cannot be empty'
  if (existingNames.includes(trimmed)) {
    return 'Server name already exists, please use a different name'
  }
  return null
}

/** env 字段必须是 string -> string 的对象（缺省合法） */
function validateEnv(env: unknown): string | null {
  if (env === undefined) return null
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    return 'env field must be an object with string key-value pairs'
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      return 'All env entries must be string key-value pairs'
    }
  }
  return null
}

/** 把空白折叠后比较，判断是否原样照抄了示例 */
function isUnmodifiedExample(config: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
  const normalized = squash(config)
  return normalized === squash(STDIO_EXAMPLE) || normalized === squash(HTTP_EXAMPLE)
}

/** 校验 MCP 配置 JSON：格式、必填/非法字段、字段类型 */
export function validateServerConfig(config: string, transport: McpTransport): string | null {
  if (!config.trim()) return 'MCP configuration cannot be empty'
  if (isUnmodifiedExample(config)) {
    return 'Please modify the example configuration, cannot use default examples'
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleanInvisibleCharacters(config))
  } catch (e) {
    return `Configuration must be valid JSON format. Error: ${e instanceof Error ? e.message : 'Unknown error'}`
  }

  const errors: string[] = []
  const keys = Object.keys(parsed)
  const label = TRANSPORT_LABELS[transport]
  const requiredKeys = transport === 'stdio' ? ['command', 'args'] : ['url']
  const allowedKeys = [...requiredKeys, 'env']

  const missing = requiredKeys.filter((k) => !keys.includes(k))
  if (missing.length) {
    errors.push(`${label} configuration must contain required fields: ${missing.join(', ')}`)
  }

  const invalid = keys.filter((k) => !allowedKeys.includes(k))
  if (invalid.length) {
    errors.push(
      `${label} configuration contains invalid fields: ${invalid.join(', ')}. Only allowed: ${allowedKeys.join(', ')}`,
    )
  }

  if (transport === 'stdio') {
    if (typeof parsed.command !== 'string' || !parsed.command.trim()) {
      errors.push('command field must be a non-empty string')
    }
    if (!Array.isArray(parsed.args)) {
      errors.push('args field must be an array')
    } else if (parsed.args.length === 0) {
      errors.push('args array cannot be empty')
    } else if (!parsed.args.every((arg) => typeof arg === 'string')) {
      errors.push('All elements in args array must be strings')
    }
  } else if (typeof parsed.url !== 'string' || !parsed.url.trim()) {
    errors.push('url field must be a non-empty string')
  }

  const envError = validateEnv(parsed.env)
  if (envError) errors.push(envError)

  return errors.length > 0 ? errors.join('; ') : null
}
