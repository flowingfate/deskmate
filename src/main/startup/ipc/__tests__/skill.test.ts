import { dialog, ipcMain } from 'electron';

const mockHandle = vi.fn();
const mockShowMessageBox = vi.fn();
const mockShowOpenDialog = vi.fn();

const mockInstallAndActivateSkill = vi.fn();
const mockUpdateSkillFromDevice = vi.fn();
const mockWindow = vi.hoisted(() => ({ isDestroyed: () => false }));
const mockStore = vi.hoisted(() => ({ id: 'p_test' }));

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/tmp')
  },
  BrowserWindow: class {
    static fromWebContents() {
      return mockWindow;
    }
  },
  ipcMain: {
    handle: (...args: any[]) => mockHandle(...args),
    removeHandler: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showMessageBox: (...args: any[]) => mockShowMessageBox(...args),
    showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
  },
}));

vi.mock('../../../lib/skill/installAndActivateSkill', async () => ({
  installAndActivateSkill: (...args: any[]) => mockInstallAndActivateSkill(...args),
}));

vi.mock('../../../lib/skill/skillDeviceImporter', async () => ({
  updateSkillFromDevice: (...args: any[]) => mockUpdateSkillFromDevice(...args),
}));

vi.mock('../../../lib/skill/deleteInstalledSkill', async () => ({
  deleteInstalledSkill: vi.fn().mockResolvedValue({ success: true, skillName: '', removedFromDisk: true }),
}));

vi.mock('../../../lib/skill/applySkillToAgents', async () => ({
  applySkillToAgents: vi.fn().mockResolvedValue({ applied: [] }),
}));


vi.mock('@main/profileRegistry', async () => ({
  ProfileRegistry: {
    require: () => ({ store: mockStore }),
  },
}));

vi.mock('@main/startup/wins', async () => ({
  getWindowMeta: () => ({ role: 'main', profileId: 'p_test' }),
}));

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) {
    throw new Error(`Handler not registered for ${channel}`);
  }
  return call[1];
}

describe('startup/ipc/skill Windows selection flow', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockInstallAndActivateSkill.mockResolvedValue({
      success: true,
      skillName: 'sample-skill',
      skillVersion: '1.0.0',
      install: { isOverwrite: false },
      inputType: 'zip',
      resolution: 'installed_but_not_applied',
      currentChat: { callable: false },
      activation: {
        attempted: false,
        success: false,
        appliedTargets: [],
        skippedTargets: [],
      },
      message: 'ok',
    });

    mockUpdateSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'sample-skill',
      skillVersion: '1.0.1',
      inputType: 'zip',
    });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  function setPlatformWin32() {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  }

  it('add flow: Windows File choice opens file-only selector with .zip/.skill filters', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 1 });
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/tmp/demo.skill'] });

    const registerSkillIpc = (await import('../skill')).default;
    registerSkillIpc({
          mainWindow: {} as any,
        } as any);

    setPlatformWin32();
    const handler = getHandler('skills:addSkillFromDevice');
    const result = await handler({}, undefined, { requestSource: 'settings' });

    expect(result.success).toBe(true);
    expect(mockShowMessageBox).toHaveBeenCalled();
    expect(mockShowOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: 'Skill Artifact', extensions: ['zip', 'skill'] }],
      }),
    );
    expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p_test' }),
      expect.objectContaining({
        source: { type: 'device-path', value: 'C:/tmp/demo.skill' },
      }),
    );
  });

  it('returns canceled when user closes selector in add flow', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });

    const registerSkillIpc = (await import('../skill')).default;
    registerSkillIpc({
          mainWindow: {} as any,
        } as any);

    setPlatformWin32();
    const handler = getHandler('skills:addSkillFromDevice');
    const result = await handler({}, undefined, { requestSource: 'settings' });

    expect(result).toEqual({ success: false, error: 'File selection canceled' });
    expect(mockShowOpenDialog).not.toHaveBeenCalled();
    expect(mockInstallAndActivateSkill).not.toHaveBeenCalled();
  });

  it('add flow: Windows Folder choice opens folder-only selector', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 2 });
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/tmp/skill-folder'] });

    const registerSkillIpc = (await import('../skill')).default;
    registerSkillIpc({
          mainWindow: {} as any,
        } as any);

    setPlatformWin32();
    const handler = getHandler('skills:addSkillFromDevice');
    const result = await handler({}, undefined, { requestSource: 'settings' });

    expect(result.success).toBe(true);
    expect(mockShowMessageBox).toHaveBeenCalled();
    expect(mockShowOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        properties: ['openDirectory'],
      }),
    );
    expect(mockShowOpenDialog.mock.calls[0][1].filters).toBeUndefined();
    expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p_test' }),
      expect.objectContaining({
        source: { type: 'device-path', value: 'C:/tmp/skill-folder' },
      }),
    );
  });

  it('add flow: non-Windows uses a single merged file+folder dialog (no type prompt)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/demo.skill'] });

    const registerSkillIpc = (await import('../skill')).default;
    registerSkillIpc({
          mainWindow: {} as any,
        } as any);

    const handler = getHandler('skills:addSkillFromDevice');
    const result = await handler({}, undefined, { requestSource: 'settings' });

    expect(result.success).toBe(true);
    expect(mockShowMessageBox).not.toHaveBeenCalled();
    expect(mockShowOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Skill Artifact', extensions: ['zip', 'skill'] }],
      }),
    );
    expect(mockInstallAndActivateSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p_test' }),
      expect.objectContaining({
        source: { type: 'device-path', value: '/tmp/demo.skill' },
      }),
    );
  });

  it('uses Folder mode and supports old dialog array response format for update flow', async () => {
    mockShowMessageBox.mockResolvedValue(2);
    mockShowOpenDialog.mockResolvedValue(['C:/tmp/skill-folder']);

    const registerSkillIpc = (await import('../skill')).default;
    registerSkillIpc({
          mainWindow: {} as any,
        } as any);

    setPlatformWin32();
    const handler = getHandler('skills:updateSkillFromDevice');
    const result = await handler({});

    expect(result.success).toBe(true);
    expect(mockShowMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Select Skill Artifact Type to Update',
      }),
    );
    expect(mockShowOpenDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Select Skill Folder to Update',
        properties: ['openDirectory'],
      }),
    );
    expect(mockUpdateSkillFromDevice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p_test' }),
      'C:/tmp/skill-folder',
    );
  });
});
