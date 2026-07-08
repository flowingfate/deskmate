/**
 * `versionActions` 纯函数单测 —— 保护 runtime settings 页「安装/更新按钮语义判定」核心逻辑：
 * 语义化版本比较必须走数值而非字典序；四态动作判定（install/installed/update/switch）分支正确；
 * 按钮文案映射与 kind 一一对应。
 */
import { describe, it, expect } from 'vitest';

import {
  compareRuntimeVersions,
  resolveInstallAction,
  installActionLabel,
  type InstallActionKind,
} from '../versionActions';

describe('compareRuntimeVersions', () => {
  // sign() 把归一化后的 1/-1/0 与期望符号对齐，避免误设成断言原始 diff。
  const cases: Array<{ name: string; a: string; b: string; sign: -1 | 0 | 1 }> = [
    { name: '完全相同 → 0', a: '1.3.14', b: '1.3.14', sign: 0 },
    { name: 'a 更新（次段进位）→ >0', a: '0.11.27', b: '0.6.17', sign: 1 },
    { name: 'a 更旧（次段落后）→ <0', a: '3.12.13', b: '3.14.6', sign: -1 },
    { name: '缺失段按 0 补齐 → 0', a: '3.12', b: '3.12.0', sign: 0 },
    { name: '前导 v 被忽略 → 0', a: 'v1.3.14', b: '1.3.14', sign: 0 },
    // 关键回归：字典序里 "9" > "14"（首字符 '9' > '1'），数值比较里 9 < 14。
    { name: '末段 9 vs 14 走数值 → <0', a: '1.3.9', b: '1.3.14', sign: -1 },
    { name: '末段 14 vs 9 走数值 → >0', a: '1.3.14', b: '1.3.9', sign: 1 },
  ];

  for (const { name, a, b, sign } of cases) {
    it(name, () => {
      expect(Math.sign(compareRuntimeVersions(a, b))).toBe(sign);
    });
  }

  it('反对称：swap 参数结果取反', () => {
    expect(Math.sign(compareRuntimeVersions('0.11.27', '0.6.17'))).toBe(1);
    expect(Math.sign(compareRuntimeVersions('0.6.17', '0.11.27'))).toBe(-1);
  });
});

describe('resolveInstallAction', () => {
  it('未安装恒为 install（selected 更新时）', () => {
    expect(resolveInstallAction(false, '1.0.0', '2.0.0')).toBe('install');
  });

  it('未安装恒为 install（selected 更旧时也不看版本）', () => {
    // 关键分支：未安装短路，selected<installed 也绝不能落成 switch。
    expect(resolveInstallAction(false, '2.0.0', '1.0.0')).toBe('install');
  });

  it('已装且选中 == 已装 → installed', () => {
    expect(resolveInstallAction(true, '1.3.14', '1.3.14')).toBe('installed');
  });

  it('已装且选中 == 已装（缺失段等价）→ installed', () => {
    expect(resolveInstallAction(true, '1.3', '1.3.0')).toBe('installed');
  });

  it('已装且选中更新 → update', () => {
    expect(resolveInstallAction(true, '1.3.9', '1.3.14')).toBe('update');
  });

  it('已装且选中更旧 → switch', () => {
    expect(resolveInstallAction(true, '1.3.14', '1.3.9')).toBe('switch');
  });
});

describe('installActionLabel', () => {
  const labels: Array<{ kind: InstallActionKind; label: string }> = [
    { kind: 'install', label: 'Install' },
    { kind: 'installed', label: 'Installed' },
    { kind: 'update', label: 'Update' },
    { kind: 'switch', label: 'Switch' },
  ];

  for (const { kind, label } of labels) {
    it(`${kind} → ${label}`, () => {
      expect(installActionLabel(kind)).toBe(label);
    });
  }
});
