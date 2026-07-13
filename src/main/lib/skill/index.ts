/**
 * Skill 子系统统一入口（barrel）
 *
 * 外部一律从 `@main/lib/skill` 导入，禁止深链子文件。内部模块之间可直连兄弟文件。
 *
 * 按关注点拆分：
 * - types.ts                共享类型
 * - skillVersion.ts         名称校验 / 文件名解析 / 版本裁决
 * - skillMetadata.ts        SKILL.md YAML 解析与磁盘元数据读取
 * - skillArchive.ts         zip/skill 归档解压
 * - skillInstall.ts         包校验 / 安装更新 / 临时目录
 * - skillDeviceImporter.ts  从设备路径导入 / 更新 skill
 * - installAndActivateSkill.ts  安装 + 按激活模式应用到 agents 的统一入口
 * - applySkillToAgents.ts   将 skill 应用到一个或多个 agent
 * - removeSkillsFromAgents.ts    从 agent 配置解绑 skill
 * - deleteInstalledSkill.ts 卸载本地 skill 包
 * - skillAvailability.ts    查询 skill 对某 agent 的可用性
 */

// --- 共享类型 ---
export type {
  SkillConfig,
  SkillMetadata,
  SkillValidationResult,
  VersionParseResult,
  MetadataParseResult,
  SkillOperationResult,
} from './types';

// --- 低层原子能力 ---
import { validateSkillName, parseSkillFileName, determineVersion } from './skillVersion';
import { parseSkillMarkdown, getSkillMetadata } from './skillMetadata';
import { extractZip } from './skillArchive';
import {
  validateSkillPackage,
  checkSkillExists,
  installSkill,
  linkSkill,
  createTempDirectory,
  cleanupTempDirectory,
} from './skillInstall';

export {
  validateSkillName,
  parseSkillFileName,
  determineVersion,
  parseSkillMarkdown,
  getSkillMetadata,
  extractZip,
  validateSkillPackage,
  checkSkillExists,
  installSkill,
  linkSkill,
  createTempDirectory,
  cleanupTempDirectory,
};

// --- 设备导入 ---
export { addSkillFromDevice, updateSkillFromDevice } from './skillDeviceImporter';
export type { SkillDeviceInputType, AddSkillFromDeviceResult } from './skillDeviceImporter';

// --- 外部 Agent skills 导入 ---
export { scanForeignAgentSkills } from './foreignAgentSkillScanner';
export { importForeignAgentSkills } from './importForeignAgentSkills';

// --- 安装 + 激活统一入口 ---
export { installAndActivateSkill } from './installAndActivateSkill';
export type {
  InstallAndActivateSkillArgs,
  SkillActivationResolution,
  InstallAndActivateSkillResult,
} from './installAndActivateSkill';

// --- agent 绑定 / 解绑 ---
// SkillAgentTarget 在 apply / remove 两模块结构相同，统一从 apply 再导出一次。
export { applySkillToAgents } from './applySkillToAgents';
export type {
  SkillAgentTarget,
  ApplySkillToAgentsOptions,
  ApplySkillToAgentsResult,
} from './applySkillToAgents';
export { removeSkillsFromAgents } from './removeSkillsFromAgents';
export type {
  RemoveSkillsFromAgentsOptions,
  RemoveSkillsFromAgentsResult,
} from './removeSkillsFromAgents';

// --- 卸载 / 可用性 ---
export { deleteInstalledSkill } from './deleteInstalledSkill';
export type { DeleteInstalledSkillResult } from './deleteInstalledSkill';
export { getSkillAvailability } from './skillAvailability';
export type { SkillAvailabilityArgs, SkillAvailabilityResult } from './skillAvailability';

/**
 * 向后兼容的门面对象。历史上以 `skillManager.foo()` 调用，保留以避免大范围改写与破坏测试 mock。
 */
export const skillManager = {
  validateSkillName,
  parseSkillFileName,
  determineVersion,
  parseSkillMarkdown,
  getSkillMetadata,
  extractZip,
  validateSkillPackage,
  checkSkillExists,
  installSkill,
  linkSkill,
  createTempDirectory,
  cleanupTempDirectory,
} as const;
