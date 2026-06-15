/**
 * Adapter that bridges the MCP transport interface to the JSON-RPC transport interface.
 */

import { JsonRpcTransport } from '../core/JsonRpc';
import { McpTransport } from '../transport/TransportFactory';

/**
 * Adapts a transport to the JsonRpcTransport interface for use with JsonRpcClient.
 */
export class JsonRpcTransportAdapter implements JsonRpcTransport {
  private mcpTransport: McpTransport;
  private messageListeners: ((message: string) => void)[] = [];
  private errorListeners: ((error: Error) => void)[] = [];
  private closeListeners: (() => void)[] = [];

  // Unsubscribe functions from the underlying transport
  private messageUnsubscribe?: () => void;
  private errorUnsubscribe?: () => void;
  private closeUnsubscribe?: () => void;
  private stateUnsubscribe?: () => void;

  constructor(mcpTransport: McpTransport) {
    this.mcpTransport = mcpTransport;
    this.setupTransportListeners();
  }

  private setupTransportListeners(): void {
    // Listen to transport messages and forward to JsonRpcClient
    this.mcpTransport.on('message', this.handleMessage);

    // Listen to transport state changes and convert to appropriate events
    this.mcpTransport.on('stateChange', this.handleStateChange);

    // Listen to transport logs for error detection
    this.mcpTransport.on('log', this.handleLog);
  }

  private handleMessage = (message: string): void => {
    this.messageListeners.forEach(listener => {
      try {
        listener(message);
      } catch (error) {
        // Ignore listener errors to prevent cascading failures
      }
    });
  };

  private handleStateChange = (state: any): void => {
    // Convert transport state changes to appropriate events
    if (state.state === 'error') {
      const error = new Error(state.message || 'Transport error');
      this.errorListeners.forEach(listener => {
        try {
          listener(error);
        } catch (err) {
          // Ignore listener errors
        }
      });
    } else if (state.state === 'stopped') {
      this.closeListeners.forEach(listener => {
        try {
          listener();
        } catch (error) {
          // Ignore listener errors
        }
      });
    }
  };

  private handleLog = (level: string, message: string): void => {
    // Convert error-level logs to error events
    if (level === 'error') {
      const error = new Error(`Transport log error: ${message}`);
      this.errorListeners.forEach(listener => {
        try {
          listener(error);
        } catch (err) {
          // Ignore listener errors
        }
      });
    }
  };

  // JsonRpcTransport interface implementation
  send(message: string): void {
    if (this.mcpTransport.state.state !== 'running') {
      throw new Error(`Cannot send message: transport state is ${this.mcpTransport.state.state}`);
    }

    // transport.send() can return Promise<void> or void
    const result = this.mcpTransport.send(message);

    // If it returns a promise, we should handle potential errors
    if (result && typeof result.catch === 'function') {
      result.catch((error: Error) => {
        // Forward send errors to error listeners
        this.errorListeners.forEach(listener => {
          try {
            listener(error);
          } catch (err) {
            // Ignore listener errors
          }
        });
      });
    }
  }

  onMessage(callback: (message: string) => void): () => void {
    this.messageListeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.messageListeners.indexOf(callback);
      if (index >= 0) {
        this.messageListeners.splice(index, 1);
      }
    };
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorListeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.errorListeners.indexOf(callback);
      if (index >= 0) {
        this.errorListeners.splice(index, 1);
      }
    };
  }

  onClose(callback: () => void): () => void {
    this.closeListeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.closeListeners.indexOf(callback);
      if (index >= 0) {
        this.closeListeners.splice(index, 1);
      }
    };
  }

  async close(): Promise<void> {
    // Clean up our listeners first
    this.cleanup();

    // Stop the underlying transport
    await this.mcpTransport.stop();
  }

  private cleanup(): void {
    // Remove all event listeners from the transport
    this.mcpTransport.off('message', this.handleMessage);
    this.mcpTransport.off('stateChange', this.handleStateChange);
    this.mcpTransport.off('log', this.handleLog);

    // Clear all listener arrays
    this.messageListeners.length = 0;
    this.errorListeners.length = 0;
    this.closeListeners.length = 0;
  }

  // Additional helper methods
  get state() {
    return this.mcpTransport.state;
  }

  isReady(): boolean {
    return this.mcpTransport.state.state === 'running';
  }

  /**
   * Get the underlying transport for direct access if needed
   */
  getTransport(): McpTransport {
    return this.mcpTransport;
  }
}