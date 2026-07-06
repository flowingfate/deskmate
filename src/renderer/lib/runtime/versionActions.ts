// src/renderer/lib/runtime/versionActions.ts
// 版本安装动作判定：根据「选中版本 vs 已安装版本」推导按钮真实语义，
// 避免 UI 出现「已是最新却仍写 Update / 已安装却仍写 Install」的误导。

/**
 * 语义化比较两个版本号（形如 1.3.14 / 0.11.27 / 3.12.13）。
 * 返回 >0 表示 a 更新，<0 表示 a 更旧，0 表示相同。
 * 忽略前导 v，逐段数值比较，缺失段按 0 处理。
 */
export function compareRuntimeVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 安装/更新按钮的动作类型（discriminated union）。
 * - install: 该工具尚未安装 → 首次安装
 * - installed: 选中版本 === 已安装版本 → 无需操作（按钮禁用）
 * - update: 选中版本 > 已安装版本 → 升级
 * - switch: 选中版本 < 已安装版本 → 切换到更旧版本
 */
export type InstallActionKind = 'install' | 'installed' | 'update' | 'switch';

/**
 * 根据「是否已安装 / 已装版本 / 选中版本」推导按钮动作。
 * @param isInstalled 该工具当前是否已安装（来自 status 探测）
 * @param installedVersion 已安装/已配置的版本号
 * @param selectedVersion 下拉框当前选中的版本号
 */
export function resolveInstallAction(
  isInstalled: boolean,
  installedVersion: string,
  selectedVersion: string,
): InstallActionKind {
  if (!isInstalled) return 'install';
  const cmp = compareRuntimeVersions(selectedVersion, installedVersion);
  if (cmp === 0) return 'installed';
  return cmp > 0 ? 'update' : 'switch';
}

/** 按钮文案（面向 bun / uv）。 */
export function installActionLabel(kind: InstallActionKind): string {
  switch (kind) {
    case 'install':
      return 'Install';
    case 'installed':
      return 'Installed';
    case 'update':
      return 'Update';
    case 'switch':
      return 'Switch';
  }
}
