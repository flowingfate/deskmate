/**
 * MCP stdio transport
 * Uses unified terminal instance manager, supports cross-platform terminal management
 */

import { EventEmitter } from 'events';
import { homedir } from 'os';
import * as path from 'path';
import { terminalManager, type McpTransportInstance } from '../../../terminal'
import { TerminalConfigBase, TerminalState } from '../../../terminal/types'
import { log } from '@main/log';

export interface StdioTransportConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | null>;
  envFile?: string;
}

export interface ConnectionState {
  state: 'stopped' | 'starting' | 'running' | 'error';
  code?: string;
  message?: string;
}

/**
 * MCP stdio transport
 * Uses unified terminal manager while preserving the original interface and behavior
 */
export class StdioTransport extends EventEmitter {
  private terminalInstance: McpTransportInstance | null = null;
  private currentState: ConnectionState = { state: 'stopped' };
  private logger = log;
  private instanceId: string;
  // Collect stderr output for error reporting
  private stderrBuffer: string[] = [];
  private readonly maxStderrLines = 50; // Keep at most 50 lines of stderr

  constructor(private config: StdioTransportConfig) {
    super();
    this.instanceId = this.generateInstanceId();

    this.logger.info({ msg: `StdioTransport created`, mod: 'StdioTransport', instanceId: this.instanceId, command: config.command, argsCount: config.args?.length || 0, cwd: config.cwd, hasEnvFile: !!config.envFile, envVarsCount: Object.keys(config.env || {}).length });
  }

  /**
   * Generate instance ID for log tracing
   */
  private generateInstanceId(): string {
    return `stdio_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  public get state(): ConnectionState {
    return this.currentState;
  }

  /**
   * Start the MCP server process
   */
  async start(): Promise<void> {
    const startTime = Date.now();

    this.logger.info({ msg: `Starting StdioTransport`, mod: 'StdioTransport', instanceId: this.instanceId, currentState: this.currentState.state, command: this.config.command, args: this.config.args });

    if (this.currentState.state === 'running' || this.currentState.state === 'starting') {
      this.logger.debug({ msg: `Transport already running or starting, skipping`, mod: 'StdioTransport', instanceId: this.instanceId, currentState: this.currentState.state });
      return;
    }

    this.setState({ state: 'starting' });

    // Clear the stderr buffer to ensure only errors from this startup are collected
    this.stderrBuffer = [];

    try {
      // Prepare working directory
      this.logger.debug({ msg: `Preparing working directory`, mod: 'StdioTransport', instanceId: this.instanceId });
      const cwd = this.prepareCwd();

      // Create terminal configuration
      // Environment variables are managed by TerminalInstance (decides whether to add bin directory based on runtime mode)
      // Only pass env and envFile specified in the configuration; let TerminalInstance handle the rest
      const terminalConfig: TerminalConfigBase = {
        command: this.expandTildePath(this.config.command),
        args: this.config.args.map(arg => this.expandTildePath(arg)),
        cwd,
        env: this.config.env as Record<string, string> | undefined,
        envFile: this.config.envFile,
        instanceId: `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
      };

      this.logger.info({ msg: `Creating MCP transport terminal instance`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId: terminalConfig.instanceId, expandedCommand: terminalConfig.command, expandedArgs: terminalConfig.args, cwd: terminalConfig.cwd, envVarsCount: Object.keys(this.config.env || {}).length });

      // 造实例（未启动）→ 先挂事件监听 → 再 start：保证 spawn 前监听就位，
      // 首帧 stdout / exit 不会丢。
      this.terminalInstance = await terminalManager.createTransport(terminalConfig);
      this.setupEventHandlers();

      this.emit('log', 'debug', `Starting MCP server: ${terminalConfig.command} ${terminalConfig.args.join(' ')}`);

      await this.terminalInstance.start();

      const startupTime = Date.now() - startTime;

      this.setState({ state: 'running' });

      this.logger.info({ msg: `StdioTransport started successfully`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId: this.terminalInstance.id, startupTimeMs: startupTime });

      this.emit('log', 'debug', 'Stdio transport started and running');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const startupTime = Date.now() - startTime;

      this.logger.error({ msg: `Failed to start StdioTransport`, mod: 'StdioTransport', instanceId: this.instanceId, err: error, startupTimeMs: startupTime, config: {
                        command: this.config.command,
                        argsCount: this.config.args?.length || 0,
                        cwd: this.config.cwd
                      } });

      this.setState({
        state: 'error',
        message: errorMessage
      });
      throw error;
    }
  }

  /**
   * Send a message to the server
   */
  send(message: string): void {
    this.logger.debug({ msg: `Sending message to MCP server`, mod: 'StdioTransport', instanceId: this.instanceId, messageLength: message.length, currentState: this.currentState.state, hasTerminalInstance: !!this.terminalInstance });

    if (this.currentState.state !== 'running') {
      // If the state is already error and there is a specific error message, use it directly
      // Avoid wrapping it in a useless "Transport is not running (state: error)" message
      if (this.currentState.state === 'error' && this.currentState.message) {
         throw new Error(this.currentState.message);
      }

      // Build an error message that includes stderr output for diagnosing the actual failure cause
      const baseError = `Transport is not running (state: ${this.currentState.state})`;
      const errorWithStderr = this.buildErrorMessage(baseError);
      this.logger.error({ msg: `Cannot send message: transport not running`, mod: 'StdioTransport', instanceId: this.instanceId, currentState: this.currentState.state });
      throw new Error(errorWithStderr);
    }

    if (!this.terminalInstance) {
      // Build an error message that includes stderr output
      const baseError = 'Terminal instance not available';
      const errorWithStderr = this.buildErrorMessage(baseError);
      this.logger.error({ msg: `Cannot send message: terminal instance not available`, mod: 'StdioTransport', instanceId: this.instanceId });
      throw new Error(errorWithStderr);
    }

    try {
      this.terminalInstance.send(message);
      this.logger.debug({ msg: `Message sent successfully`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId: this.terminalInstance.id });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Build an error message that includes stderr output
      const errorWithStderr = this.buildErrorMessage(`Failed to send message: ${errorMessage}`);
      this.logger.error({ msg: `Failed to send message to MCP server`, mod: 'StdioTransport', instanceId: this.instanceId, err: error, terminalInstanceId: this.terminalInstance.id });
      this.emit('log', 'error', errorWithStderr);
      throw new Error(errorWithStderr);
    }
  }

  /**
   * Stop the server process
   */
  async stop(): Promise<void> {
    const stopTime = Date.now();

    this.logger.info({ msg: `Stopping StdioTransport`, mod: 'StdioTransport', instanceId: this.instanceId, currentState: this.currentState.state, hasTerminalInstance: !!this.terminalInstance });

    if (this.currentState.state === 'stopped') {
      this.logger.debug({ msg: `Transport already stopped`, mod: 'StdioTransport', instanceId: this.instanceId });
      return;
    }

    if (this.terminalInstance) {
      const terminalInstanceId = this.terminalInstance.id;
      this.logger.debug({ msg: `Stopping terminal instance`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId });

      try {
        await this.terminalInstance.stop();
        this.logger.debug({ msg: `Terminal instance stopped successfully`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error({ msg: `Error stopping terminal instance`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId, err: error });
        this.emit('log', 'error', `Error during stop: ${errorMessage}`);
      } finally {
        this.terminalInstance = null;
      }
    }

    this.setState({ state: 'stopped' });

    const stopDuration = Date.now() - stopTime;
    this.logger.info({ msg: `StdioTransport stopped`, mod: 'StdioTransport', instanceId: this.instanceId, stopDurationMs: stopDuration });
  }

  private prepareCwd(): string {
    this.logger.debug({ msg: `Preparing working directory`, mod: 'StdioTransport', instanceId: this.instanceId, configCwd: this.config.cwd });

    const home = homedir();
    let cwd = this.config.cwd ? this.expandTildePath(this.config.cwd) : home;

    if (!path.isAbsolute(cwd)) {
      cwd = path.join(home, cwd);
      this.logger.debug({ msg: `Converted relative path to absolute`, mod: 'StdioTransport', instanceId: this.instanceId, relativePath: this.config.cwd, absolutePath: cwd });
    }

    this.logger.debug({ msg: `Working directory prepared`, mod: 'StdioTransport', instanceId: this.instanceId, finalCwd: cwd });

    return cwd;
  }

  private expandTildePath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(homedir(), filePath.slice(2));
    }
    return filePath;
  }

  private setupEventHandlers(): void {
    if (!this.terminalInstance) {
      this.logger.warn({ msg: `Cannot setup event handlers: terminal instance not available`, mod: 'StdioTransport', instanceId: this.instanceId });
      return;
    }

    const terminalInstanceId = this.terminalInstance.id;
    this.logger.debug({ msg: `Setting up event handlers for terminal instance`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId });

    // Handle incoming messages
    this.terminalInstance.on('message', (message: string) => {
      this.logger.debug({ msg: `Received message from MCP server`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId, messageLength: message.length });
      this.emit('message', message);
    });

    const currentTerminalInstance = this.terminalInstance;

    // Collect stderr output for error diagnostics
    this.terminalInstance.on('stderr', (message: string) => {
      // Check whether this is from the current terminal instance; ignore delayed/zombie output from old instances
      if (this.terminalInstance !== currentTerminalInstance) {
         return;
      }

      // Keep only the most recent stderr lines
      this.stderrBuffer.push(message);
      if (this.stderrBuffer.length > this.maxStderrLines) {
        this.stderrBuffer.shift();
      }
      this.emit('log', 'debug', `[stderr] ${message}`);
    });

    // Handle errors
    this.terminalInstance.on('error', (error: Error) => {
      this.logger.error({ msg: `Terminal instance error occurred`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId, err: error });

      // Build error message that includes stderr
      const errorMessage = this.buildErrorMessage(`Process error: ${error.message}`);
      this.setState({
        state: 'error',
        message: errorMessage
      });
      this.emit('log', 'error', `Terminal instance error: ${errorMessage}`);
    });

    // Handle process exit
    this.terminalInstance.on('exit', (code: number | null, signal: string | null) => {
      const instanceInfo = this.terminalInstance!.getInfo();
      const isExpectedExit = instanceInfo.state === 'stopping';

      this.logger.info({ msg: `Terminal instance process exited`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId, exitCode: code, signal, isExpectedExit, instanceState: instanceInfo.state });

      if (isExpectedExit || code === 0) {
        this.setState({ state: 'stopped' });
        this.logger.debug({ msg: `Process exit was expected or successful, setting state to stopped`, mod: 'StdioTransport', instanceId: this.instanceId });
      } else {
        this.logger.error({ msg: `Unexpected process exit, setting state to error`, mod: 'StdioTransport', instanceId: this.instanceId, exitCode: code, signal });
        // Build error message that includes stderr
        const errorMessage = this.buildErrorMessage(`Process exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
        this.setState({
          state: 'error',
          message: errorMessage
        });
      }

      this.cleanup();
    });

    // Handle state changes
    this.terminalInstance.on('stateChange', (state: TerminalState) => {
      this.logger.debug({ msg: `Terminal instance state changed`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId, newState: state });
      this.emit('log', 'debug', `Terminal instance state changed to: ${state}`);
    });

    this.logger.debug({ msg: `Event handlers setup completed`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId });
  }

  private setState(newState: ConnectionState): void {
    const previousState = this.currentState.state;
    this.logger.debug({ msg: `Transport state changing`, mod: 'StdioTransport', instanceId: this.instanceId, previousState, newState: newState.state, message: newState.message });

    this.currentState = newState;
    this.emit('stateChange', newState);

    this.logger.info({ msg: `Transport state changed`, mod: 'StdioTransport', instanceId: this.instanceId, previousState, currentState: newState.state });
  }

  private cleanup(): void {
    this.logger.debug({ msg: `Cleaning up StdioTransport resources`, mod: 'StdioTransport', instanceId: this.instanceId, hasTerminalInstance: !!this.terminalInstance });

    if (this.terminalInstance) {
      const terminalInstanceId = this.terminalInstance.id;
      this.logger.debug({ msg: `Disposing terminal instance`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId });

      this.terminalInstance.dispose();
      this.terminalInstance = null;

      this.logger.debug({ msg: `Terminal instance disposed`, mod: 'StdioTransport', instanceId: this.instanceId, terminalInstanceId });
    }

    this.logger.info({ msg: `StdioTransport cleanup completed`, mod: 'StdioTransport', instanceId: this.instanceId });
  }

  /**
   * Remove ANSI escape codes
   */
  private stripAnsi(str: string): string {
    return str.replace(/\x1B\[[0-9;]*[mK]/g, '');
  }

  /**
   * Build an error message that includes stderr output
   * Appends the contents of the stderr buffer to the error message
   */
  private buildErrorMessage(baseMessage: string): string {
    if (this.stderrBuffer.length === 0) {
      return baseMessage;
    }

    // If baseMessage already contains "Stderr output:" and the content is similar to the current buffer, do not add more
    // A simple check for the "Stderr output:" marker
    if (baseMessage.includes('Stderr output:')) {
      return baseMessage;
    }

    // Get the most recent stderr output (up to 10 lines, to avoid excessively long messages)
    const recentStderr = this.stderrBuffer.slice(-10).join('\n');
    return `${baseMessage}\n\nStderr output:\n${this.stripAnsi(recentStderr)}`;
  }

  /**
   * Get the currently collected stderr output
   */
  public getStderrOutput(): string {
    return this.stripAnsi(this.stderrBuffer.join('\n'));
  }

  /**
   * Get a truncated stderr preview for UI display and error summaries
   */
  public getStderrPreview(maxLines = 12, maxChars = 4000): string {
    const preview = this.stripAnsi(this.stderrBuffer.slice(-maxLines).join('\n')).trim();

    if (preview.length <= maxChars) {
      return preview;
    }

    return `${preview.slice(0, maxChars).trimEnd()}\n...[truncated]`;
  }

  /**
   * Clear the stderr buffer (use before a retry)
   */
  public clearStderrBuffer(): void {
    this.stderrBuffer = [];
  }
}