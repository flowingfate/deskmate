#!/usr/bin/env node
/**
 * Auto-detects the Electron version and rebuilds native modules against it.
 *
 * Required because the local Node ABI rarely matches Electron's. `better-sqlite3`
 * is the only native module that needs an Electron-specific build today —
 * mismatch will make both `npm test` (electron-as-node) and production startup
 * crash with NODE_MODULE_VERSION errors.
 */

const { execSync } = require('child_process');
const path = require('path');

const packageJson = require(path.join(__dirname, '..', 'package.json'));
const electronVersion = packageJson.devDependencies.electron?.replace(/[\^~>=<]/g, '') || '';
const nativeModulesToRebuild = ['better-sqlite3'];

if (!electronVersion) {
  console.warn('[rebuild-native] Warning: Could not find electron version in package.json');
  process.exit(0);
}

console.log(`[rebuild-native] Rebuilding native modules for Electron v${electronVersion}: ${nativeModulesToRebuild.join(', ')}`);

try {
  for (const moduleName of nativeModulesToRebuild) {
    console.log(`[rebuild-native] Rebuilding ${moduleName}...`);
    execSync(
      `npx @electron/rebuild --force --only ${moduleName} -v ${electronVersion}`,
      { stdio: 'inherit', cwd: path.join(__dirname, '..') }
    );
  }
  console.log('[rebuild-native] Successfully rebuilt native modules');
} catch (error) {
  console.warn('[rebuild-native] Warning: native module rebuild failed, but continuing...');
  // Do not throw; let CI continue
}
