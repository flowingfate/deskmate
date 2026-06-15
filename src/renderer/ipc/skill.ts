import { skillsRenderToMain } from '@shared/ipc/skill';

export const skillsApi = skillsRenderToMain.bindRender(window.electronAPI.skills.invoke);
