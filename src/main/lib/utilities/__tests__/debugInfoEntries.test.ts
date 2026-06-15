import * as path from 'path';
import { getDebugInfoEntries } from '../debugInfoEntries';

describe('getDebugInfoEntries', () => {
  it('includes the current user schedules directory when a profile id is provided', () => {
    const entries = getDebugInfoEntries(
      path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'deskmate'),
      path.join('C:', 'Users', 'tester', 'AppData', 'Local', 'Temp', 'Deskmate Crashes'),
      'alice',
    );

    expect(entries).toEqual([
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'deskmate', 'logs'),
        zipPath: 'logs',
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'deskmate', 'state', 'current-run.json'),
        zipPath: path.join('state', 'current-run.json'),
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'deskmate', 'crashes'),
        zipPath: 'crashes',
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Local', 'Temp', 'Deskmate Crashes'),
        zipPath: 'crashDumps',
      },
      {
        sourcePath: path.join('C:', 'Users', 'tester', 'AppData', 'Roaming', 'deskmate', 'profiles', 'alice', 'schedules'),
        zipPath: path.join('profiles', '<REDACTED_PROFILE_ID>', 'schedules'),
      },
    ]);
  });

  it('omits the schedules directory when there is no current profile id', () => {
    const entries = getDebugInfoEntries('/tmp/deskmate', '/tmp/crashDumps', null);

    expect(entries).toEqual([
      {
        sourcePath: path.join('/tmp/deskmate', 'logs'),
        zipPath: 'logs',
      },
      {
        sourcePath: path.join('/tmp/deskmate', 'state', 'current-run.json'),
        zipPath: path.join('state', 'current-run.json'),
      },
      {
        sourcePath: path.join('/tmp/deskmate', 'crashes'),
        zipPath: 'crashes',
      },
      {
        sourcePath: '/tmp/crashDumps',
        zipPath: 'crashDumps',
      },
    ]);
  });
});