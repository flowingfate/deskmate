import type { ForeignSkillSourceId, ForeignSkillSourceKind } from '../persist/types'

export interface SkillLibraryItem {
  name: string;
  description: string;
  version: string;
  contact?: string;
}

export interface SkillLibraryData {
  skills: SkillLibraryItem[];
}

export interface SkillInstallOptions {
  overwrite?: boolean;
  agentId?: string;
  applyToCurrentAgent?: boolean;
  agentName?: string;
  requestSource?: string;
}

export interface SkillDeviceImportOptions {
  agentId?: string;
  applyToCurrentAgent?: boolean;
  agentName?: string;
  requestSource?: string;
}

export interface SkillFilePathInstallOptions {
  agentId?: string;
  applyToCurrentAgent?: boolean;
  agentName?: string;
  requestSource?: string;
}

export type SkillResolution =
  | 'installed_and_callable'
  | 'installed_but_not_applied'
  | 'installed_but_needs_target_selection'
  | 'already_callable'
  | 'failed';

export interface SkillActivationInfo {
  attempted: boolean;
  success: boolean;
  appliedTargets: Array<{ agentId: string; agentName: string }>;
  skippedTargets: Array<{ agentId: string; agentName: string; reason: string }>;
}

export interface SkillCurrentChat {
  agentId?: string;
  agentName?: string;
  callable: boolean;
}

export interface SkillInstallResult {
  success: boolean;
  skillName?: string;
  skillVersion?: string;
  message?: string;
  error?: string;
  isOverwrite?: boolean;
  resolution?: SkillResolution;
  currentChat?: SkillCurrentChat;
  activation?: SkillActivationInfo;
}

export interface SkillDeviceInstallResult extends SkillInstallResult {
  inputType?: 'zip' | 'skill' | 'folder';
}

export interface SkillApplyTarget {
  agentId: string;
  agentName: string;
}

export interface SkillApplyResult {
  success: boolean;
  skillName: string;
  message: string;
  appliedCount: number;
  alreadyAppliedCount: number;
  failedCount: number;
  appliedTargets: Array<{ agentId: string; agentName: string }>;
  skippedTargets: Array<{ agentId: string; agentName: string; reason: string }>;
  error?: string;
}

export interface SkillUpdateFromDeviceResult {
  success: boolean;
  skillName?: string;
  error?: string;
  inputType?: 'zip' | 'skill' | 'folder';
}

export interface SkillDirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modifiedTime: string;
  extension: string | null;
}

export interface SkillDirectoryContents {
  currentPath: string;
  parentPath: string | null;
  items: SkillDirectoryItem[];
}

export interface SkillFileContent {
  fileName: string;
  path: string;
  extension: string;
  content: string | null;
  isSupported: boolean;
  size: number;
  modifiedTime: string;
}


/** link/copy 安装形态，与落盘的 `ForeignSkillSource.kind` 同一枚举。 */
export type ForeignSkillInstallMode = ForeignSkillSourceKind;

export interface ForeignSkillSourceDefinition {
  id: ForeignSkillSourceId;
  label: string;
  homeRelativePath: string[];
}

export interface ForeignSkillCandidate {
  id: string;
  sourceId: ForeignSkillSourceId;
  sourcePath: string;
  sourcePathDisplay: string;
  name: string;
  description: string;
  version?: string;
  valid: boolean;
  invalidReason?: string;
  duplicateSourceCount: number;
}

export interface ForeignSkillCategory {
  sourceId: ForeignSkillSourceId;
  sourceLabel: string;
  sourceRootDisplay: string;
  exists: boolean;
  candidates: ForeignSkillCandidate[];
  warnings: string[];
}

export interface ScanForeignAgentSkillsResult {
  success: boolean;
  categories: ForeignSkillCategory[];
  warnings: string[];
  error?: string;
}

export interface ImportForeignSkillItem {
  candidateId: string;
  sourceId: ForeignSkillSourceId;
  sourcePath: string;
  installMode: ForeignSkillInstallMode;
  overwrite: boolean;
  selectedSkillName: string;
}

export interface ImportForeignSkillItemResult {
  candidateId: string;
  skillName?: string;
  installMode: ForeignSkillInstallMode;
  success: boolean;
  isOverwrite: boolean;
  error?: string;
}

export interface ImportForeignAgentSkillsResult {
  success: boolean;
  importedCount: number;
  failedCount: number;
  linkedCount: number;
  copiedCount: number;
  overwrittenCount: number;
  results: ImportForeignSkillItemResult[];
  error?: string;
}