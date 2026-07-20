/**
 * @vitest-environment node
 */

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:\\test\\userData'),
  },
}));

vi.mock('../../runtime/RuntimeManager', async () => ({
  RuntimeManager: vi.fn(),
}));

// `which`/`where` 探测统一失败，让 shell 可用性只由确定性的平台分支决定。
vi.mock('child_process', async () => ({
  execSync: vi.fn(() => {
    throw new Error('command not found');
  }),
}));

describe('platformConfigs shell fallback', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('falls back to the default shell when bash.exe is unavailable on Windows', async () => {
    // 动态 import：每个用例先 resetModules 再按当前 platform 重新加载模块（模块加载边界，测试专属）。
    const { getRunnableShellProfile } = await import('../platformConfigs');

    const result = await getRunnableShellProfile('bash');

    // bash.exe 不在已知内置之列且 where 探测失败 → 回退到 powershell（win32 内置视为可用）。
    expect(result.shellType).toBe('powershell');
    expect(result.profile.command).toBe('powershell.exe');
    expect(result.fallbackReason).toContain("falling back to 'powershell'");
  });

  it('reports unavailable commands as unavailable on non-Windows platforms', async () => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const { isShellCommandAvailable } = await import('../platformConfigs');

    // 非 win32 且 which 探测失败 → 命令不可用。
    await expect(isShellCommandAvailable('missing-shell')).resolves.toBe(false);
  });
});

describe('platformConfigs.getEnhancedEnvironment - npm_config_prefix sanitization', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env['npm_config_prefix'] = '/opt/homebrew/Cellar/node/25.9.0_2';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('strips npm_config_prefix in internal mode (includeBinPath=true)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { getEnhancedEnvironment } = await import('../platformConfigs');

    const env = getEnhancedEnvironment(true);
    expect(env['npm_config_prefix']).toBeUndefined();
  });

  it('preserves npm_config_prefix in system mode (includeBinPath=false)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { getEnhancedEnvironment } = await import('../platformConfigs');

    const env = getEnhancedEnvironment(false);
    expect(env['npm_config_prefix']).toBe('/opt/homebrew/Cellar/node/25.9.0_2');
  });
});