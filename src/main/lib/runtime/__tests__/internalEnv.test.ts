/**
 * internalEnv.ts 纯函数单元测试。
 *
 * 覆盖两个纯函数的行为契约：
 * - buildInternalEnv：PATH 前插、大小写不敏感定位 PATH 键、无 PATH 键新建、
 *   PYTHONUTF8 / PYTHONIOENCODING 恒定写入、npm_config_prefix 删除、
 *   不再写 VIRTUAL_ENV / UV_PYTHON（反向断言），以及入参不可变性。
 * - applyManagedRuntimeDirs：各 managed dir 逐字段映射（含三键同值 = runtimeBinDir）、
 *   UV_PYTHON 的条件写入（值 / null / undefined / 空串 / 纯空白），以及就地 mutate 语义。
 *
 * 被测函数零依赖、零副作用，故全部用真实输入直接断言，无 mock。
 */
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { applyManagedRuntimeDirs, buildInternalEnv, type ManagedRuntimeDirs } from '../internalEnv';

const BIN = '/data/bin';

describe('buildInternalEnv — PATH 前插', () => {
  it('把 binPath 前插到已有 PATH，原值用 path.delimiter 连接保留在后面', () => {
    const original = `/usr/bin${path.delimiter}/bin`;
    const env = buildInternalEnv({ PATH: original }, BIN);

    expect(env['PATH']).toBe(`${BIN}${path.delimiter}${original}`);
  });
});

describe('buildInternalEnv — 大小写不敏感定位 PATH 键', () => {
  it('baseEnv 用小写 path（Windows 常见）时就地更新该键，不新建大写 PATH', () => {
    const env = buildInternalEnv({ path: '/usr/bin' }, BIN);

    expect(env['path']).toBe(`${BIN}${path.delimiter}/usr/bin`);
    expect('PATH' in env).toBe(false);
  });

  it('同样识别混合大小写的 Path 键并就地更新，不新建大写 PATH', () => {
    const env = buildInternalEnv({ Path: '/usr/bin' }, BIN);

    expect(env['Path']).toBe(`${BIN}${path.delimiter}/usr/bin`);
    expect('PATH' in env).toBe(false);
  });
});

describe('buildInternalEnv — 无 PATH 键', () => {
  it('baseEnv 完全没有 PATH 时新建 PATH，值为 binPath + delimiter + 空串', () => {
    const env = buildInternalEnv({}, BIN);

    expect(env['PATH']).toBe(`${BIN}${path.delimiter}`);
  });
});

describe('buildInternalEnv — 恒定写入的编码变量', () => {
  it('恒定写入 PYTHONUTF8=1、PYTHONIOENCODING=utf-8', () => {
    const env = buildInternalEnv({ PATH: '/usr/bin' }, BIN);

    expect(env['PYTHONUTF8']).toBe('1');
    expect(env['PYTHONIOENCODING']).toBe('utf-8');
  });

  it('无视 baseEnv 里已有的旧编码值，强制覆盖为 UTF-8', () => {
    const env = buildInternalEnv(
      { PATH: '/usr/bin', PYTHONUTF8: '0', PYTHONIOENCODING: 'latin-1' },
      BIN,
    );

    expect(env['PYTHONUTF8']).toBe('1');
    expect(env['PYTHONIOENCODING']).toBe('utf-8');
  });
});

describe('buildInternalEnv — 删除 npm_config_prefix', () => {
  it('即使 baseEnv 里存在 npm_config_prefix 也要被删掉', () => {
    const env = buildInternalEnv(
      { PATH: '/usr/bin', npm_config_prefix: '/opt/homebrew' },
      BIN,
    );

    expect('npm_config_prefix' in env).toBe(false);
  });

  it('baseEnv 没有 npm_config_prefix 时结果里也不存在', () => {
    const env = buildInternalEnv({ PATH: '/usr/bin' }, BIN);

    expect('npm_config_prefix' in env).toBe(false);
  });
});

describe('buildInternalEnv — 职责收窄：不写 VIRTUAL_ENV / UV_PYTHON', () => {
  it('结果里不含 VIRTUAL_ENV 键（已迁到 applyManagedRuntimeDirs）', () => {
    const env = buildInternalEnv({ PATH: '/usr/bin' }, BIN);

    expect('VIRTUAL_ENV' in env).toBe(false);
  });

  it('结果里不含 UV_PYTHON 键（已迁到 applyManagedRuntimeDirs）', () => {
    const env = buildInternalEnv({ PATH: '/usr/bin' }, BIN);

    expect('UV_PYTHON' in env).toBe(false);
  });

  it('baseEnv 里预置的 VIRTUAL_ENV / UV_PYTHON 会被原样透传，函数自身不主动改写', () => {
    // buildInternalEnv 只做展开拷贝，不触碰这两个键；透传是浅拷贝的自然结果，
    // 契约要点是「函数自身不再写入」，而非清除调用方预置的值。
    const env = buildInternalEnv(
      { PATH: '/usr/bin', VIRTUAL_ENV: '/pre/venv', UV_PYTHON: '3.12' },
      BIN,
    );

    expect(env['VIRTUAL_ENV']).toBe('/pre/venv');
    expect(env['UV_PYTHON']).toBe('3.12');
  });
});

describe('buildInternalEnv — 入参不可变性', () => {
  it('返回新对象，与传入的 baseEnv 不是同一引用', () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const env = buildInternalEnv(baseEnv, BIN);

    expect(env).not.toBe(baseEnv);
  });

  it('不改动 baseEnv：原 PATH 保持不变，且未注入编码变量', () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin', npm_config_prefix: '/opt/homebrew' };
    buildInternalEnv(baseEnv, BIN);

    expect(baseEnv['PATH']).toBe('/usr/bin');
    expect(baseEnv['npm_config_prefix']).toBe('/opt/homebrew');
    expect('PYTHONUTF8' in baseEnv).toBe(false);
    expect('PYTHONIOENCODING' in baseEnv).toBe(false);
  });
});

const DIRS: ManagedRuntimeDirs = {
  uvCacheDir: '/data/env/uv-cache',
  uvToolDir: '/data/env/uv-tools',
  uvPythonInstallDir: '/data/env/python',
  bunInstallDir: '/data/env/bun',
  runtimeBinDir: '/data/env/runtime-bin',
  venvPath: '/data/env/python-venv',
};

describe('applyManagedRuntimeDirs — 各 managed dir 逐字段映射', () => {
  it('uv / bun / venv 目录变量逐字段映射到对应键', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, DIRS);

    expect(env['UV_CACHE_DIR']).toBe(DIRS.uvCacheDir);
    expect(env['UV_TOOL_DIR']).toBe(DIRS.uvToolDir);
    expect(env['UV_PYTHON_INSTALL_DIR']).toBe(DIRS.uvPythonInstallDir);
    expect(env['BUN_INSTALL']).toBe(DIRS.bunInstallDir);
    expect(env['VIRTUAL_ENV']).toBe(DIRS.venvPath);
  });

  it('UV_TOOL_BIN_DIR / UV_PYTHON_BIN_DIR / BUN_INSTALL_BIN 三键同值 = runtimeBinDir', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, DIRS);

    expect(env['UV_TOOL_BIN_DIR']).toBe(DIRS.runtimeBinDir);
    expect(env['UV_PYTHON_BIN_DIR']).toBe(DIRS.runtimeBinDir);
    expect(env['BUN_INSTALL_BIN']).toBe(DIRS.runtimeBinDir);
  });
});

describe('applyManagedRuntimeDirs — UV_PYTHON 条件写入', () => {
  it('pinnedPythonVersion 非空且 trim 后非空 → 写入其原值', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, { ...DIRS, pinnedPythonVersion: '3.12' });

    expect(env['UV_PYTHON']).toBe('3.12');
  });

  it('pinnedPythonVersion 带首尾空白时按原值写入（不 trim 存储，只 trim 判空）', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, { ...DIRS, pinnedPythonVersion: '  3.12  ' });

    expect(env['UV_PYTHON']).toBe('  3.12  ');
  });

  it('pinnedPythonVersion 为 null → 不写入 UV_PYTHON', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, { ...DIRS, pinnedPythonVersion: null });

    expect('UV_PYTHON' in env).toBe(false);
  });

  it('pinnedPythonVersion 为 undefined（字段缺省）→ 不写入 UV_PYTHON', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, { ...DIRS, pinnedPythonVersion: undefined });

    expect('UV_PYTHON' in env).toBe(false);
  });

  it('pinnedPythonVersion 为空串 → 不写入 UV_PYTHON', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, { ...DIRS, pinnedPythonVersion: '' });

    expect('UV_PYTHON' in env).toBe(false);
  });

  it('pinnedPythonVersion 为纯空白 → trim 后判空，不写入 UV_PYTHON', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedRuntimeDirs(env, { ...DIRS, pinnedPythonVersion: '   \t\n ' });

    expect('UV_PYTHON' in env).toBe(false);
  });
});

describe('applyManagedRuntimeDirs — 就地 mutate 语义', () => {
  it('无返回值（void），直接改传入的 env 对象', () => {
    const env: NodeJS.ProcessEnv = {};
    const result = applyManagedRuntimeDirs(env, DIRS);

    expect(result).toBeUndefined();
    expect(env['UV_CACHE_DIR']).toBe(DIRS.uvCacheDir);
  });

  it('叠加到已有 env 上：保留无关键，不整体替换对象', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', FOO: 'bar' };
    applyManagedRuntimeDirs(env, DIRS);

    expect(env['PATH']).toBe('/usr/bin');
    expect(env['FOO']).toBe('bar');
    expect(env['BUN_INSTALL']).toBe(DIRS.bunInstallDir);
  });
});
