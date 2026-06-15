/**
 * 持久化布局的纯路径拼接。
 * 不读磁盘、不创建目录 —— 仅返回 string。
 * 所有 io 调用方传入 profileRoot 即可。
 */

export const PERSIST_PATH = {
  // 根
  profilesIndex:   (root: string) => `${root}/profiles/profiles.json`,
  profileDir:      (root: string, profileId: string) => `${root}/profiles/${profileId}`,

  // profile 级
  settingsFile:    (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/settings.json`,
  authFile:        (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/auth.json`,
  piAuthFile:      (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/auth.pi.json`,
  schedulerStateFile: (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/scheduler-state.json`,

  // agents
  agentsDir:       (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/agents`,
  agentsIndexFile: (root: string, p: string) => `${PERSIST_PATH.agentsDir(root, p)}/agents.json`,
  agentDir:        (root: string, p: string, a: string) => `${PERSIST_PATH.agentsDir(root, p)}/${a}`,
  agentMarkdown:   (root: string, p: string, a: string) => `${PERSIST_PATH.agentDir(root, p, a)}/AGENT.md`,
  agentKnowledge:  (root: string, p: string, a: string) => `${PERSIST_PATH.agentDir(root, p, a)}/knowledge`,

  // sessions
  sessionsDir:     (root: string, p: string, a: string) => `${PERSIST_PATH.agentDir(root, p, a)}/sessions`,
  sessionIndexFile:(root: string, p: string, a: string) => `${PERSIST_PATH.sessionsDir(root, p, a)}/index.json`,
  sessionDir:      (root: string, p: string, a: string, ym: string, s: string) =>
                     `${PERSIST_PATH.sessionsDir(root, p, a)}/${ym}/${s}`,
  sessionData:     (root: string, p: string, a: string, ym: string, s: string) =>
                     `${PERSIST_PATH.sessionDir(root, p, a, ym, s)}/data.json`,
  sessionMessages: (root: string, p: string, a: string, ym: string, s: string) =>
                     `${PERSIST_PATH.sessionDir(root, p, a, ym, s)}/messages.jsonl`,
  /** session 私有文件 sandbox（用户/LLM 在该 session 中生成或上传的文件）。 */
  sessionFiles:    (root: string, p: string, a: string, ym: string, s: string) =>
                     `${PERSIST_PATH.sessionDir(root, p, a, ym, s)}/files`,

  // schedules
  schedulesDir:    (root: string, p: string, a: string) => `${PERSIST_PATH.agentDir(root, p, a)}/schedules`,
  jobsIndexFile:   (root: string, p: string, a: string) => `${PERSIST_PATH.schedulesDir(root, p, a)}/jobs.json`,
  jobDir:          (root: string, p: string, a: string, j: string) =>
                     `${PERSIST_PATH.schedulesDir(root, p, a)}/${j}`,
  jobFile:         (root: string, p: string, a: string, j: string) =>
                     `${PERSIST_PATH.jobDir(root, p, a, j)}/job.json`,
  jobRunsDir:      (root: string, p: string, a: string, j: string) =>
                     `${PERSIST_PATH.jobDir(root, p, a, j)}/runs`,

  // profile 级共享
  subAgentsDir:    (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/sub-agents`,
  subAgentsIndex:  (root: string, p: string) => `${PERSIST_PATH.subAgentsDir(root, p)}/sub-agents.json`,
  skillsDir:       (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/skills`,
  skillsIndex:     (root: string, p: string) => `${PERSIST_PATH.skillsDir(root, p)}/skills.json`,
  mcpDir:          (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/mcp`,
  mcpServersFile:  (root: string, p: string) => `${PERSIST_PATH.mcpDir(root, p)}/mcp-servers.json`,
  modelsDir:       (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/models`,
  archiveDir:      (root: string, p: string) => `${PERSIST_PATH.profileDir(root, p)}/archive`,
} as const;

export const MONTH_KEY = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
};
