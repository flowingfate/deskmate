/**
 * Vite pack orchestration script.
 * Builds Vite output, creates a staging directory (vite-pack/), installs
 * production dependencies, and runs electron-builder.
 *
 * Usage:
 *   bun scripts/vite/pack.ts                          # full build + package for current platform
 *   bun scripts/vite/pack.ts --dir                    # unpacked output (for testing)
 *   bun scripts/vite/pack.ts --skip-build             # skip vite build step
 *   bun scripts/vite/pack.ts --skip-clean             # keep vite-pack/ for inspection
 *   bun scripts/vite/pack.ts --mac --arm64            # target platform/arch
 *   bun scripts/vite/pack.ts --win --x64 --publish=never
 *   bun scripts/vite/pack.ts -- --config.mac.identity=null   # extra args forwarded to electron-builder
 *
 * Any flags not recognized below (or anything after `--`) are forwarded
 * verbatim to electron-builder.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../..');
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
  const result = Bun.spawnSync(['sh', '-c', cmd], {
    cwd: opts?.cwd ?? ROOT,
    env: { ...process.env, ...opts?.env },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit code ${result.exitCode}: ${cmd}`);
  }
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

  // Step 3: Install production dependencies
  console.log('\nStep 3/5: Installing production dependencies...');
  run('npm install --omit=dev', { cwd: VITE_PACK });

  // Step 4: Run electron-builder
  console.log('\nStep 4/5: Running electron-builder...');
  // electron-builder 自动加载 electron-builder.config.js（项目里唯一的打包配置真相源）。
  const builderCmd = ['npx', 'electron-builder', ...opts.builderArgs].join(' ');

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
