import { connectRenderToMain } from './base';
import type {
  SkillDeviceImportOptions,
  SkillFilePathInstallOptions,
  SkillDeviceInstallResult,
  SkillApplyTarget,
  SkillApplyResult,
  SkillUpdateFromDeviceResult,
  SkillDirectoryContents,
  SkillFileContent,
  ScanForeignAgentSkillsResult,
  ImportForeignSkillItem,
  ImportForeignAgentSkillsResult,
} from '../types/skillTypes';

type SkillsRenderToMain = {
  // Device-side install / update / apply
  addSkillFromDevice: { call: [selectedPath?: string, options?: SkillDeviceImportOptions]; return: SkillDeviceInstallResult };
  installSkillFromFilePath: { call: [filePath: string, options?: SkillFilePathInstallOptions]; return: SkillDeviceInstallResult };
  updateSkillFromDevice: { call: []; return: SkillUpdateFromDeviceResult };
  applySkillToAgents: { call: [skillName: string, targets?: SkillApplyTarget[]]; return: SkillApplyResult };
  scanForeignAgentSkills: { call: []; return: ScanForeignAgentSkillsResult };
  importForeignAgentSkills: { call: [items: ImportForeignSkillItem[]]; return: ImportForeignAgentSkillsResult };
  // Read / inspect / delete
  getSkillMarkdown: { call: [skillName: string]; return: { success: boolean; content?: string; error?: string } };
  getSkillDirectoryContents: { call: [skillName: string, relativePath?: string]; return: { success: boolean; data?: SkillDirectoryContents; error?: string } };
  getSkillFileContent: { call: [skillName: string, relativePath: string]; return: { success: boolean; data?: SkillFileContent; error?: string } };
  deleteSkill: { call: [skillName: string]; return: { success: boolean; error?: string } };
  openSkillFolder: { call: [skillName: string]; return: { success: boolean; error?: string } };
};

export const skillsRenderToMain = connectRenderToMain<SkillsRenderToMain>('skills');
