/**
 * Vite pack orchestration script.
 * Builds Vite output, creates a staging directory (vite-pack/), copies the
 * production dependency closure (already built for the Electron ABI) from the
 * root node_modules, and runs electron-builder.
 *
 * Usage (Node 24+ 直接跑 .mts，无需 bun；也兼容 `bun scripts/vite/pack.mts`)：
 *   node scripts/vite/pack.mts                          # full build + package for current platform
 *   node scripts/vite/pack.mts --dir                    # unpacked output (for testing)
 *   node scripts/vite/pack.mts --skip-build             # skip vite build step
 *   node scripts/vite/pack.mts --skip-clean             # keep vite-pack/ for inspection
 *   node scripts/vite/pack.mts --mac --arm64            # target platform/arch
 *   node scripts/vite/pack.mts --win --x64 --publish=never
 *   node scripts/vite/pack.mts -- --config.mac.identity=null   # extra args forwarded to electron-builder
 *
 * Any flags not recognized below (or anything after `--`) are forwarded
 * verbatim to electron-builder.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VITE_PACK = path.join(ROOT, 'vite-pack');
const OUT_DIR = path.join(ROOT, 'out');

const OWN_FLAGS = new Set(['--skip-build', '--skip-clean']);

// ─── CLI Argument Parsing ────────────────────────────────────────

export function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const skipBuild = args.includes('--skip-build');
  const skipClean = args.includes('--skip-clean');

  // Forward everything else (including --dir, --mac, --win, --arm64, --publish, etc.)
  // to electron-builder. Anything after a `--` separator is also forwarded.
  const sepIdx = args.indexOf('--');
  const head = sepIdx === -1 ? args : args.slice(0, sepIdx);
  const tail = sepIdx === -1 ? [] : args.slice(sepIdx + 1);
  const builderArgs = [...head.filter(a => !OWN_FLAGS.has(a)), ...tail];

  return { skipBuild, skipClean, builderArgs };
}

// ─── Shell Command Runner ────────────────────────────────────────

function run(cmd: string, opts?: { cwd?: string; env?: Record<string, string> }): void {
  console.log(`\n> ${cmd}`);
  const result = spawnSync('sh', ['-c', cmd], {
    cwd: opts?.cwd ?? ROOT,
    env: { ...process.env, ...opts?.env },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${cmd}`);
  }
}

// ─── Production Dependency Closure ───────────────────────────────

/**
 * 用 `npm ls` 枚举生产依赖闭包（含 optionalDependencies），返回每个包在
 * 根 node_modules 下的相对路径（保留 npm 提升后的真实布局）。
 * 首行是项目根自身，跳过。
 */
export function listProdDepPaths(rootDir: string): string[] {
  const result = spawnSync('sh', ['-c', 'npm ls --omit=dev --all --parseable'], {
    cwd: rootDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // npm ls 在有 peer/extraneous 告警时会以非零退出，但 stdout 仍完整可用，
  // 因此不检查 exitCode，只要拿到路径列表即可。
  const nmPrefix = path.join(rootDir, 'node_modules') + path.sep;
  return result.stdout
    .toString()
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith(nmPrefix))
    .map(abs => path.relative(rootDir, abs));
}

/**
 * 把生产依赖闭包从根 node_modules 复制到 vite-pack/node_modules。
 *
 * 复用根目录的产物 —— 其中原生模块（better-sqlite3）已由 postinstall 的
 * rebuild-native.js 按 Electron ABI 编译好。绝不在 staging 目录里重装/重编，
 * 否则会（a）在 Windows 上因缺 Node-ABI 预编译包退回 node-gyp 编译而失败，
 * （b）在 mac 上误装 Node-ABI 预编译包，打进包里运行时 ABI 不匹配崩溃。
 */
function copyProdClosure(rootDir: string, packDir: string): number {
  const relPaths = listProdDepPaths(rootDir);
  for (const rel of relPaths) {
    const src = path.join(rootDir, rel);
    const dst = path.join(packDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  }
  return relPaths.length;
}

// ─── Package.json Generator ─────────────────────────────────────

export function buildVitePackPackageJson(
  rootPkg: {
    name: string;
    version: string;
    description?: string;
    author?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  },
): Record<string, unknown> {
  return {
    name: rootPkg.name,
    version: rootPkg.version,
    description: rootPkg.description,
    author: rootPkg.author,
    main: 'out/main/bootstrap.js',
    dependencies: rootPkg.dependencies ?? {},
    ...(rootPkg.optionalDependencies && Object.keys(rootPkg.optionalDependencies).length > 0
      ? { optionalDependencies: rootPkg.optionalDependencies }
      : {}),
  };
}

// ─── Main Flow ───────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  console.log(`\n=== Vite Pack ===\n`);

  // Step 1: Build Vite
  if (!opts.skipBuild) {
    console.log('Step 1/5: Building Vite output...');
    run('npm run build');
  } else {
    console.log('Step 1/5: Skipped (--skip-build)');
  }

  // Verify out/ exists
  if (!fs.existsSync(path.join(OUT_DIR, 'main', 'main.js'))) {
    throw new Error('out/main/main.js not found. Run `npm run build` first or remove --skip-build.');
  }

  // Step 2: Create staging directory
  console.log('\nStep 2/5: Creating vite-pack/ staging directory...');
  fs.rmSync(VITE_PACK, { recursive: true, force: true });
  fs.mkdirSync(VITE_PACK, { recursive: true });

  // 把 out/ 整目录复制到 vite-pack/out/，与源结构对齐，
  // electron-builder 的 files glob (`out/**/*`) 与 asarUnpack 路径都直接复用。
  console.log('  Copying out/ → vite-pack/out/');
  fs.cpSync(OUT_DIR, path.join(VITE_PACK, 'out'), { recursive: true });

  // Copy resources/ → vite-pack/resources/
  const resourcesSrc = path.join(ROOT, 'resources');
  if (fs.existsSync(resourcesSrc)) {
    console.log('  Copying resources/ → vite-pack/resources/');
    fs.cpSync(resourcesSrc, path.join(VITE_PACK, 'resources'), { recursive: true });
  }

  // Generate vite-pack/package.json
  console.log('  Generating vite-pack/package.json');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const packPkg = buildVitePackPackageJson(rootPkg);

  fs.writeFileSync(
    path.join(VITE_PACK, 'package.json'),
    JSON.stringify(packPkg, null, 2) + '\n',
  );

  console.log(`  Dependencies: ${Object.keys(packPkg.dependencies as Record<string, string>).length} packages`);

  // Step 3: Copy production dependency closure from root node_modules
  console.log('\nStep 3/5: Copying production dependencies from root node_modules...');
  const copied = copyProdClosure(ROOT, VITE_PACK);
  console.log(`  Copied ${copied} packages (Electron-ABI native modules reused, no recompile)`);

  // Step 4: Run electron-builder
  console.log('\nStep 4/5: Running electron-builder...');
  // 必须显式 --config：electron-builder 26 在本项目布局下不会自动发现
  // electron-builder.config.js（缺了它会静默退回默认配置 → 默认图标、默认
  // 产物命名、输出目录跑到 dist/ 而非 release/）。这是打包配置的唯一真相源。
  const builderCmd = ['npx', 'electron-builder', '--config', 'electron-builder.config.js', ...opts.builderArgs].join(' ');

  run(builderCmd);

  // Step 5: Clean up
  if (!opts.skipClean) {
    console.log('\nStep 5/5: Cleaning up vite-pack/...');
    fs.rmSync(VITE_PACK, { recursive: true, force: true });
  } else {
    console.log('\nStep 5/5: Skipped cleanup (--skip-clean). Inspect vite-pack/ manually.');
  }

  console.log('\n=== Done ===\n');
}

main().catch(err => {
  console.error('\n❌ Pack failed:', err.message);
  process.exit(1);
});
