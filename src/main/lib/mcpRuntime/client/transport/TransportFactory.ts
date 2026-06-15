/**
 * Transport factory for MCP servers
 */

import { StdioTransport, StdioTransportConfig } from './StdioTransport';
import { HttpTransport, HttpTransportConfig } from './HttpTransport';

export type TransportType = 'stdio' | 'http' | 'sse';

export interface BaseTransportConfig {
  type?: TransportType;
  timeout?: number;
}

export type TransportConfig =
  | (StdioTransportConfig & { type: 'stdio' })
  | (HttpTransportConfig & { type: 'http' | 'sse' });

export interface McpTransport {
  readonly state: { state: 'stopped' | 'starting' | 'running' | 'error'; message?: string };
  start(): Promise<void>;
  send(message: string): Promise<void> | void;
  stop(): Promise<void>;
  on(event: 'message', listener: (message: string) => void): this;
  on(event: 'stateChange', listener: (state: any) => void): this;
  on(event: 'log', listener: (level: string, message: string) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

/**
 * Factory for creating MCP transports
 */
export class TransportFactory {
  /**
   * Create a transport from an MCP server configuration
   */
  static createFromConfig(serverName: string, config: any): McpTransport {
    const transportConfig = this.normalizeConfig(serverName, config);
    return this.createTransport(transportConfig);
  }

  /**
   * Create transport instance
   */
  static createTransport(config: TransportConfig): McpTransport {
    switch (config.type) {
      case 'stdio':
        return new StdioTransport(config);

      case 'http':
      case 'sse':
        return new HttpTransport(config);

      default:
        throw new Error(`Unsupported transport type: ${(config as any).type}`);
    }
  }

  /**
   * Normalize an MCP server configuration to transport config
   */
  static normalizeConfig(serverName: string, rawConfig: any): TransportConfig {
    // Detect transport type
    const transportType = this.detectTransportType(rawConfig);

    const baseConfig = {
      timeout: rawConfig.timeout || 60000,
    };

    switch (transportType) {
      case 'stdio': {
        if (!rawConfig.command) {
          throw new Error(`Stdio transport requires 'command' field for server ${serverName}`);
        }

        return {
          type: 'stdio',
          command: rawConfig.command,
          args: rawConfig.args || [],
          cwd: rawConfig.cwd,
          env: rawConfig.env || {},
          envFile: rawConfig.envFile,
          ...baseConfig,
        };
      }

      case 'http':
      case 'sse': {
        if (!rawConfig.url) {
          throw new Error(`HTTP/SSE transport requires 'url' field for server ${serverName}`);
        }

        return {
          type: transportType,
          serverName,
          url: rawConfig.url,
          headers: {
            'Content-Type': 'application/json',
            'Accept': transportType === 'sse' ? 'text/event-stream' : 'application/json',
            'User-Agent': 'Deskmate-MCP-Client/1.0.0',
            ...rawConfig.headers,
          },
          method: rawConfig.method || 'POST',
          mcpServerConfig: rawConfig.mcpServerConfig,
          ...baseConfig,
        };
      }

      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }

  /**
   * Detect transport type from configuration
   */
  static detectTransportType(config: any): TransportType {
    // Check explicit type field
    if (config.type) {
      const normalizedType = config.type.toLowerCase();

      switch (normalizedType) {
        case 'stdio':
          return 'stdio';
        case 'http':
        case 'streamablehttp':
          return 'http';
        case 'sse':
          return 'sse';
        default:
          // Continue with auto-detection
          break;
      }
    }

    // Auto-detect based on configuration fields
    if (config.command || config.args) {
      return 'stdio';
    }

    if (config.url) {
      const url = config.url.toLowerCase();

      // Check for SSE patterns
      if (url.includes('/sse') ||
          url.includes('text/event-stream') ||
          url.includes('server-sent-events')) {
        return 'sse';
      }

      // Default to HTTP for URLs
      return 'http';
    }

    // Default fallback
    return 'stdio';
  }

  /**
   * Validate configuration for transport type
   */
  static validateConfig(config: TransportConfig): void {
    switch (config.type) {
      case 'stdio':
        if (!config.command) {
          throw new Error('Stdio transport requires a command');
        }
        if (!Array.isArray(config.args)) {
          throw new Error('Stdio transport requires args array');
        }
        break;

      case 'http':
      case 'sse':
        if (!config.url) {
          throw new Error(`${config.type.toUpperCase()} transport requires a URL`);
        }
        if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
          throw new Error(`${config.type.toUpperCase()} transport URL must start with http:// or https://`);
        }
        break;

      default:
        throw new Error(`Unknown transport type: ${(config as any).type}`);
    }
  }

  /**
   * Get supported transport types
   */
  static getSupportedTypes(): TransportType[] {
    return ['stdio', 'http', 'sse'];
  }
}

/**
 * Helper function to create a transport from MCP configuration
 */
export function createMcpTransport(serverName: string, rawConfig: any): McpTransport {
  return TransportFactory.createFromConfig(serverName, rawConfig);
}

/**
 * Helper function to detect if URL is SSE-based
 */
export function isSSEUrl(url: string): boolean {
  return url.includes('/sse') ||
         url.includes('text/event-stream') ||
         url.includes('server-sent-events');
}

/**
 * Helper function to check if config is for stdio transport
 */
export function isStdioConfig(config: any): boolean {
  return !!(config.command || config.args) || config.type?.toLowerCase() === 'stdio';
}

/**
 * Helper function to check if config is for HTTP/SSE transport
 */
export function isHttpConfig(config: any): boolean {
  return !!config.url || ['http', 'sse', 'streamablehttp'].includes(config.type?.toLowerCase());
}