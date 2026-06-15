import * as path from 'path';

export interface DebugInfoEntry {
  sourcePath: string;
  zipPath: string;
}

export function getDebugInfoEntries(
  userDataPath: string,
  crashDumpsPath: string,
  profileId: string | null,
): DebugInfoEntry[] {
  const entries: DebugInfoEntry[] = [
    {
      sourcePath: path.join(userDataPath, 'logs'),
      zipPath: 'logs',
    },
    {
      sourcePath: path.join(userDataPath, 'state', 'current-run.json'),
      zipPath: path.join('state', 'current-run.json'),
    },
    {
      sourcePath: path.join(userDataPath, 'crashes'),
      zipPath: 'crashes',
    },
    {
      sourcePath: crashDumpsPath,
      zipPath: 'crashDumps',
    },
  ];

  if (profileId) {
    entries.push({
      sourcePath: path.join(userDataPath, 'profiles', profileId, 'schedules'),
      zipPath: path.join('profiles', '<REDACTED_PROFILE_ID>', 'schedules'),
    });
  }

  return entries;
}