#!/usr/bin/env bun
/**
 * check-deps.ts — 检查 dependencies / devDependencies 分类是否合规。
 *
 * 规则：
 *   1. dependencies 中的包必须被 main 进程代码使用（否则应移到 devDependencies 或删除）
 *   2. devDependencies 中若被 main 进程代码使用则提示（确认是否应为 external）
 *   3. devDependencies 中完全未被任何代码使用则提示（候选删除）
 *
 * Run: bun scripts/check-deps.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Constants ──────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname!, '..');
const SRC = path.join(ROOT, 'src');

const MAIN_DIRS = ['src/main', 'src/preload', 'src/shared'];
const RENDERER_DIRS = ['src/renderer'];
const OTHER_DIRS = ['scripts', 'tests'];
const CONFIG_FILES = [
  'electron.vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
];

// packages that won't appear in source imports but are legitimately used
const BUILD_TOOL_PATTERNS: RegExp[] = [
  /^@types\//,
  /^@babel\//,
  /^@testing-library\//,
  /^@vitest\//,
  /^@vitejs\//,
  /^@tailwindcss\//,
  /^@electron\//,
  /^@playwright\//,
  /^playwright$/,
  /^typescript/,
  /^postcss/,
  /^vite$/,
  /^vitest$/,
  /^electron$/,
  /^electron-builder$/,
  /^electron-vite$/,
  /^cross-env$/,
  /^concurrently$/,
  /^css-loader$/,
  /^style-loader$/,
  /^node-loader$/,
  /^react-refresh$/,
  /^sass$/,
  /^serve$/,
  /^caniuse-lite$/,
  /^purgecss$/,
  /^png-to-ico$/,
  /^to-ico$/,
  /^dotenv$/,
  /^happy-dom$/,
  /^jsdom$/,
  /^wait-on$/,
  /^postcss-selector-parser$/,
  // polyfills / browserify shims
  /^buffer$/,
  /^process$/,
  /^events$/,
  /^util$/,
  /^stream-browserify$/,
  /^crypto-browserify$/,
  /^os-browserify$/,
  /^path-browserify$/,
  // native extensions loaded at runtime without import
  /^sqlite-vec$/,
  // bundled into the extractor injection IIFE at build time
  // (scripts/vite/extractor-plugin.ts); main runtime never require()s them,
  // so they legitimately stay in devDependencies.
  /^@mozilla\/readability$/,
  /^turndown$/,
  /^turndown-plugin-gfm$/,
];

// packages in dependencies that are used at runtime but not via import
// (e.g., native extensions loaded via loadExtension, binaries resolved by path)
const RUNTIME_ONLY_DEPS = new Set(['sqlite-vec', 'pino-pretty']);

// ── ANSI helpers ───────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function isBuildTool(pkg: string): boolean {
  return BUILD_TOOL_PATTERNS.some((re) => re.test(pkg));
}

function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}

function extractPackageNames(content: string): Set<string> {
  const pkgs = new Set<string>();
  // match: from 'pkg', require('pkg'), import('pkg'), @import "pkg"
  const re = /(?:from\s+['"]|require\s*\(\s*['"]|import\s*\(\s*['"]|@import\s+['"])([^'"./][^'"]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const raw = m[1];
    // extract package name: @scope/pkg or pkg (ignore deep paths)
    if (raw.startsWith('@')) {
      const parts = raw.split('/');
      if (parts.length >= 2) pkgs.add(`${parts[0]}/${parts[1]}`);
    } else {
      pkgs.add(raw.split('/')[0]);
    }
  }
  return pkgs;
}

type ProcessGroup = 'main' | 'renderer' | 'other';

function classifyFile(filePath: string): ProcessGroup {
  const rel = path.relative(ROOT, filePath);
  if (RENDERER_DIRS.some((d) => rel.startsWith(d))) return 'renderer';
  if (MAIN_DIRS.some((d) => rel.startsWith(d))) return 'main';
  return 'other';
}

function scanImports(): { main: Set<string>; renderer: Set<string>; other: Set<string> } {
  const main = new Set<string>();
  const renderer = new Set<string>();
  const other = new Set<string>();

  // Scan src/
  const srcFiles = collectFiles(SRC, ['.ts', '.tsx', '.cjs', '.css']);
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const pkgs = extractPackageNames(content);
    const group = classifyFile(file);
    const target = group === 'main' ? main : group === 'renderer' ? renderer : other;
    for (const pkg of pkgs) target.add(pkg);
  }

  // Scan scripts/ and tests/
  for (const dir of OTHER_DIRS) {
    const absDir = path.join(ROOT, dir);
    const files = collectFiles(absDir, ['.ts', '.tsx', '.js', '.mjs']);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pkg of extractPackageNames(content)) other.add(pkg);
    }
  }

  // Scan config files
  for (const cf of CONFIG_FILES) {
    const abs = path.join(ROOT, cf);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf-8');
    for (const pkg of extractPackageNames(content)) other.add(pkg);
  }

  return { main, renderer, other };
}

// ── Main ───────────────────────────────────────────────────────────────────

const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const deps = Object.keys(pkgJson.dependencies || {});
const devDeps = Object.keys(pkgJson.devDependencies || {});
const optDeps = Object.keys(pkgJson.optionalDependencies || {});

console.log(`${c.cyan}${c.bold}Scanning imports in src/...${c.reset}\n`);

const imports = scanImports();

// ── Check 1: dependencies not used in main process ─────────────────────────

interface Issue {
  pkg: string;
  detail: string;
}

const depsNotInMain: Issue[] = [];
for (const pkg of deps) {
  if (RUNTIME_ONLY_DEPS.has(pkg)) continue;
  if (!imports.main.has(pkg)) {
    const inRenderer = imports.renderer.has(pkg);
    depsNotInMain.push({
      pkg,
      detail: inRenderer ? 'renderer only → move to devDependencies' : 'unused → remove or move to devDependencies',
    });
  }
}

// ── Check 2: devDependencies used in main process ──────────────────────────

const devInMain: Issue[] = [];
for (const pkg of devDeps) {
  if (isBuildTool(pkg)) continue;
  if (imports.main.has(pkg)) {
    devInMain.push({
      pkg,
      detail: 'used in main process → move to dependencies',
    });
  }
}

// ── Check 3: devDependencies not used anywhere ─────────────────────────────

const devUnused: Issue[] = [];
for (const pkg of devDeps) {
  if (isBuildTool(pkg)) continue;
  if (optDeps.includes(pkg)) continue;
  if (!imports.main.has(pkg) && !imports.renderer.has(pkg) && !imports.other.has(pkg)) {
    devUnused.push({ pkg, detail: 'not imported anywhere' });
  }
}

// ── Output ─────────────────────────────────────────────────────────────────

function printSection(
  icon: string,
  title: string,
  color: string,
  issues: Issue[],
) {
  if (issues.length === 0) return;

  console.log(`${color}${c.bold}${icon} ${title} (${issues.length})${c.reset}`);
  console.log(`${c.gray}${'─'.repeat(60)}${c.reset}`);

  const maxPkg = Math.max(...issues.map((i) => i.pkg.length), 7);
  console.log(
    `  ${c.bold}${'Package'.padEnd(maxPkg + 2)}Reason${c.reset}`,
  );

  for (const { pkg, detail } of issues) {
    console.log(`  ${color}${pkg.padEnd(maxPkg + 2)}${c.reset}${c.dim}${detail}${c.reset}`);
  }
  console.log();
}

printSection('⚠', 'dependencies not used in main process', c.red, depsNotInMain);
printSection('●', 'devDependencies used in main process (should be in dependencies)', c.red, devInMain);
printSection('○', 'devDependencies not used anywhere (candidate for removal)', c.yellow, devUnused);

// ── Summary ────────────────────────────────────────────────────────────────

const total = depsNotInMain.length + devInMain.length + devUnused.length;

if (total === 0) {
  console.log(`${c.green}${c.bold}✓ All dependencies are correctly classified.${c.reset}`);
} else {
  console.log(
    `${c.dim}──────────────────────────────────────────────────────────${c.reset}`,
  );
  console.log(
    `${c.bold}Summary:${c.reset} ` +
    (depsNotInMain.length > 0 ? `${c.red}${depsNotInMain.length} misplaced deps${c.reset}  ` : '') +
    (devInMain.length > 0 ? `${c.red}${devInMain.length} devDeps should be deps${c.reset}  ` : '') +
    (devUnused.length > 0 ? `${c.yellow}${devUnused.length} unused devDeps${c.reset}` : ''),
  );
}
