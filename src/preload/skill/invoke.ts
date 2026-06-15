import { ipcRenderer } from 'electron';
import { skillsRenderToMain } from '@shared/ipc/skill';

export const invokeSkills = skillsRenderToMain.provideInvokeForPreload(ipcRenderer, [
  'addSkillFromDevice',
  'installSkillFromFilePath',
  'updateSkillFromDevice',
  'applySkillToAgents',
  'getSkillMarkdown',
  'getSkillDirectoryContents',
  'getSkillFileContent',
  'deleteSkill',
  'openSkillFolder',
]);
