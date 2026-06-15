/**
 * User-data 目录名（位于 $HOME 下）。Bootstrap 用 `app.setPath('userData', ...)` 覆盖
 * 默认 Electron userData 路径；CLI / 任何外部脚本在无 Electron `app` 时也需要拿到同样的路径。
 *
 * 修改此常量等于迁移用户数据 — 见 refactor/progress.md 中关于 userData 路径漂移的复盘。
 * 任何对 ~/.deskmate/<...> 的硬编码字符串都应改为引用本常量。
 */
export const USER_DATA_DIRNAME = '.deskmate';
