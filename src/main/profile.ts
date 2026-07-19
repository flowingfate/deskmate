import type { BrowserWindow } from 'electron';
import { mainToRender } from '@shared/ipc/subagentRun';

import { DoctorManager } from '@main/lib/doctor/manager';
import { MCPClientManager } from '@main/lib/mcpRuntime';
import { SchedulerManager } from '@main/lib/scheduler';
import { Agent as RuntimeAgent, SubAgentManager } from './pi';
import { ProfileStore } from './persist';

export class Profile {
  public readonly id: string;
  public readonly doctor: DoctorManager;
  private readonly agents = new Map<string, RuntimeAgent>();
  private subagent: SubAgentManager | undefined;
  public readonly mcpManager: MCPClientManager;
  public readonly scheduler: SchedulerManager;
  private mainWindow: BrowserWindow | null = null;
  private state: 'created' | 'started' | 'stopping' | 'stopped' = 'created';

  public constructor(public readonly store: ProfileStore) {
    this.id = store.id;
    this.doctor = new DoctorManager(store);
    this.mcpManager = new MCPClientManager(store);
    this.scheduler = new SchedulerManager(store);
  }

  public async start(): Promise<{ warnings: string[] }> {
    if (this.state === 'started') return { warnings: [] };
    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error(`Profile.start: profile ${this.id} is stopping or stopped`);
    }

    const reconcile = await this.store.reconcileAgents();
    await this.scheduler.start();
    try {
      await this.mcpManager.initialize();
    } catch (error) {
      await this.scheduler.dispose('unknown');
      throw error;
    }
    this.state = 'started';
    return {
      warnings: reconcile.droppedFromIndex.length || reconcile.primaryCleared
        ? [`reconcileAgents: index-drop=${reconcile.droppedFromIndex.length} primary-cleared=${reconcile.primaryCleared}`]
        : [],
    };
  }

  public getOrCreateAgent(agentId: string): RuntimeAgent {
    if (this.state !== 'started') {
      throw new Error(`Profile.getOrCreateAgent: profile ${this.id} is not running`);
    }

    const existing = this.agents.get(agentId);
    if (existing) return existing;

    const agent = new RuntimeAgent(this.store, agentId);
    this.agents.set(agentId, agent);
    return agent;
  }

  public getAgent(agentId: string): RuntimeAgent | undefined {
    return this.agents.get(agentId);
  }

  public getSubAgentManager(): SubAgentManager {
    return this.subagent ??= new SubAgentManager(this.store, (state) => {
      const wc = this.getMainWindow()?.webContents;
      if (wc) mainToRender.bindWebContents(wc).stateUpdate(state);
    });
  }

  public attachMainWindow(window: BrowserWindow): void {
    if (window.isDestroyed()) {
      throw new Error(`Profile.attachMainWindow: window ${window.id} is destroyed`);
    }
    this.mainWindow = window;
  }

  public detachMainWindow(window: BrowserWindow): void {
    if (this.mainWindow !== window) return;
    this.mainWindow = null;
    this.doctor.cancel();
    this.mcpManager.cancelAuthPrompts();
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null;
  }

  public async archiveAgent(agentId: string): Promise<void> {
    await this.agents.get(agentId)?.dispose();
    await this.store.archiveAgent(agentId);
    this.agents.delete(agentId);
  }

  public async dispose(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping') return;

    this.state = 'stopping';
    await this.scheduler.dispose('unknown');
    await this.doctor.dispose();
    await Promise.all([...this.agents.values()].map((agent) => agent.dispose()));
    await this.mcpManager.cleanup();
    await this.store.shutdown();
    this.agents.clear();
    this.state = 'stopped';
  }
}
