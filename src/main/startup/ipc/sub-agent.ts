import { ipcMain, shell } from "electron";
import { isFeatureEnabled } from '../../lib/featureFlags';
import { Profiles } from '@main/persist';

import type { Context } from './shared';
import { subAgentRenderToMain } from '@shared/ipc/subAgent';

export default function(_ctx: Context) {
  const handleSubAgent = subAgentRenderToMain.bindMain(ipcMain);

  // ===============================
  // Sub-Agent CRUD IPC handlers
  // ===============================

  // Get all sub-agent configs（full config 懒读 AGENT.md）
  handleSubAgent.getAll(async (_event) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: true, data: [] };
    }
    try {
      const profile = await Profiles.get().active();
      const data = await profile.subAgents.listConfigs();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Add sub-agent（写 AGENT.md + index 同步落盘 + emit）
  handleSubAgent.add(async (_event, config: any) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      const profile = await Profiles.get().active();
      await profile.subAgents.writeConfig(config);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Update sub-agent（getConfig → 浅合并 → writeConfig）
  handleSubAgent.update(async (_event, name: string, updates: any) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      const profile = await Profiles.get().active();
      const current = await profile.subAgents.getConfig(name);
      if (!current) {
        return { success: false, error: `Sub-agent "${name}" not found` };
      }
      const merged = { ...current, ...updates, name: current.name };
      await profile.subAgents.writeConfig(merged);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Delete sub-agent（删 index entry + 物理目录 + cache + emit）
  handleSubAgent.delete(async (_event, name: string) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      const profile = await Profiles.get().active();
      await profile.subAgents.remove(name);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Import Claude Code format .md file as sub-agent
  handleSubAgent.importFromFile(async (_event, filePath: string) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      const profile = await Profiles.get().active();
      const config = await profile.subAgents.importFromClaudeCodeFile(filePath);
      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Export as Claude Code standard format
  handleSubAgent.exportAsClaudeCode(async (_event, name: string) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      const profile = await Profiles.get().active();
      const content = await profile.subAgents.exportAsClaudeCode(name);
      if (content == null) {
        return { success: false, error: `Sub-agent "${name}" not found` };
      }
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Open agent directory in file manager
  handleSubAgent.openInExplorer(async (_event, name: string) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: false, error: 'Sub-Agent feature is disabled' };
    }
    try {
      const profile = await Profiles.get().active();
      const agentDir = profile.subAgents.agentDirPath(name);
      await shell.openPath(agentDir);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Manually trigger file system scan sync（对账 sub-agents/ 目录与 index）
  handleSubAgent.syncFromDisk(async (_event) => {
    if (!isFeatureEnabled('deskmateFeatureSubAgent')) {
      return { success: true, data: [] };
    }
    try {
      const profile = await Profiles.get().active();
      const data = await profile.subAgents.scanFromDisk();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });


}
