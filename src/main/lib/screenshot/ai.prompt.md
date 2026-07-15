<!-- Last verified: 2026-07-15 -->
# Screenshot Module

> 先截图再选区的截屏系统：为每个显示器生成覆盖窗口、捕获原生图像，并在用户完成或取消时 resolve 一个 promise。

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `ScreenshotManager.ts` | 单例 — 覆盖窗口生命周期、并行截图、裁剪、剪贴板/文件/发送到主进程操作、自定义 `screenshot://` 协议 | large |
| `ScreenshotIPC.ts` | 通过 `renderToMain.bindMain()` 注册所有 `ipcMain` handlers；桥接覆盖窗口 ↔ 主进程；读写设置 | medium |
| `screenshotShortcut.ts` | 注册/注销全局快捷键；设置变更时重新注册 | small |
| `windowFrames.ts` | 使用 `node-screenshots` 枚举按显示器分组的系统窗口；返回物理像素坐标用于窗口吸附高亮 | small |
| `index.ts` | 重导出 `registerScreenshotIPC`、`registerScreenshotShortcut`、`unregisterScreenshotShortcut` | tiny |

## Architecture

### 截图流程
1. `ScreenshotManager.capture()` → 权限检查 → `cleanup()` → 创建 `ResolveablePromise<CaptureResult>`。
2. **并行**：`createDisplayWindowForParallel()`（每个显示器，`show: false`）+ `captureAllDisplays()`（通过 `desktopCapturer`）。
3. `initializeWindowsWithScreenshots()` 附加截图、缓存 JPEG、设置 `alwaysOnTop: screen-saver`、显示窗口。
4. 覆盖层 JS 通过 IPC 回调。`selectionStart` 关闭所有非活跃显示器窗口。`sendToMain` / `copyToClipboard` / `saveToFile` resolve `capturePromise`。
5. `cleanup()` 关闭所有覆盖窗口，重置状态。

### 自定义协议
`screenshot://image/<displayId>` 向覆盖层渲染进程提供预缓存的 JPEG。必须在 `main.ts` 中 `app.ready` **之前**通过 `protocol.registerSchemesAsPrivileged` 注册 scheme（不在本模块中）。

⚠️ scheme privileges 必须含 `corsEnabled: true`。覆盖层用 `image.crossOrigin = 'anonymous'`（`renderer/screenshot/core/common/utils/bg.ts`）加载该图以便后续 canvas `getImageData` 不被污染；dev 下页面源是 `http://localhost:39017`，对 `screenshot://` 是跨源请求，缺 `corsEnabled` 会被 CORS 拦截、图加载失败。

⚠️ 截图窗口的 preload（`src/preload/screenshot.ts`）必须暴露 `electronAPI.log`（`write`/`writeBatch`）。`screenshot.tsx` import 了 `@/log` 与 `installGlobalErrorHandlers`，二者依赖 `window.electronAPI.log`；缺失时任意 `log.error`（如全局异常处理器）会因 `undefined` 再次抛错、连锁崩溃。

### IPC 契约
所有通道通过 `src/shared/ipc/screenshot.ts` 中的 `connectRenderToMain('screenshot')` 命名空间在 `screenshot:*` 下。类型：`CaptureResult`、`SaveToFileResult`、`DisplayInfo`、`WindowFrame`、`ScreenshotSettings`。

### 设置
存储在 `appCacheManager`（UserDataADO）中；用户可通过 `enabled` 设置启用或禁用截图。

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| 添加新的 IPC 通道 | `src/shared/ipc/screenshot.ts`（类型）+ `ScreenshotIPC.ts`（handler） | 渲染进程调用 `renderToMain.bindRenderer()` 对应方法 |
| 更改默认快捷键 | `screenshotShortcut.ts` 回退字符串 | 同时更新 UserDataADO 中的 ScreenshotSettings 默认值 |
| 添加新的截图操作（如 OCR） | `ScreenshotManager.ts`（方法）+ `ScreenshotIPC.ts`（handler）+ `src/shared/ipc/screenshot.ts`（类型） | 使用新的 `CaptureResult` 变体 resolve `capturePromise` |
| 添加新的设置字段 | `src/shared/ipc/screenshot.ts`（`ScreenshotSettings`）+ UserDataADO schema | 保持默认值向后兼容 |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `CaptureResult` 联合类型 | 渲染进程和主进程中所有对 `type` 做 `switch` 的调用方 |
| `registerCustomProtocol()` | `main.ts` 中的 `protocol.registerSchemesAsPrivileged` 调用（必须保持在 `app.ready` 之前） |
| `cleanup()` | 验证 macOS Dock 图标恢复（`app.dock?.show()`）保持在窗口关闭之前 |
| 快捷键注册 | `registerScreenshotShortcut` 从 `main.ts` 启动和 `updateSettings` IPC handler 两处调用 |

## Anti-Patterns
- 不要在本模块内调用 `protocol.registerSchemesAsPrivileged` — 它必须在 `main.ts` 中 `app.ready` 之前运行。
- 不要在 `loadFile()` 中直接将查询参数拼接到文件路径 — Electron 会将 `?` 编码为 `%3F`。使用 `loadFile` 的 `query` 选项。
- 不要绕过 `capture()` 直接显示覆盖窗口；始终走完整流程以确保 `capturePromise` 被正确初始化。
- 不要多次调用 `registerScreenshotIPC` — 它有 `isRegistered` 守卫，但双重注册仍是逻辑错误。

## Verification Steps
1. 触发截屏（快捷键或 IPC `capture`）；确认覆盖窗口出现在每个连接的显示器上。
2. 拖拽选择一个区域；确认 `selectionStart` 时其他显示器窗口关闭。
3. 测试复制、保存和发送到聊天流程 — 每个都应恰好 resolve `capturePromise` 一次。
4. 在 macOS 上：撤销屏幕录制权限，验证权限对话框出现并包含系统设置链接。
5. 验证 `screenshot://image/<id>` 在开发和生产构建中提供正确的 JPEG。

## Gotchas
- ⚠️ macOS 15+ 在授予屏幕录制权限后需要重启应用；否则 `desktopCapturer` 返回空图像。模块会以 500ms 延迟重试 3 次并显示重启对话框。
- ⚠️ `windowFrames.ts` 将窗口坐标转换为**物理像素**（乘以 `scaleFactor`）。覆盖层渲染进程在绘制吸附高亮时必须考虑这一点。
- ⚠️ 在 macOS 上，`app.dock?.show()` 必须在 `cleanup()` 中关闭覆盖窗口**之前**调用，否则 Dock 图标可能消失。
- ⚠️ 缩放因子在 `did-finish-load` 后强制重置为 1，以防止 Chromium 继承的每来源缩放扭曲覆盖层。
- ⚠️ `captureReadyPromise` 初始为预拒绝的 `Promise`；`getInitData` 会 await 它，因此在 `capture()` 之前调用会抛出异常。

## Related
- 依赖：[appCache](../appCache/)（`appCacheManager` 提供截屏设置）、`src/shared/ipc/screenshot.ts`（IPC 类型契约）、`node-screenshots`（窗口枚举）
- 被依赖：`src/main/main.ts`（启动时注册 IPC + 快捷键）、渲染进程截屏覆盖 UI（`src/renderer/screenshot/`）
