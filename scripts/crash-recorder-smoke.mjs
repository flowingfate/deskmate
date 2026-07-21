import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const fixture = path.resolve('out/main/crash-recorder-fixture.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function electronEnvironment(root) {
  const childEnvironment = { ...process.env, DESKMATE_TEST_USER_DATA_PATH: root };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  return childEnvironment;
}

function runScenario(root, scenario, expectSuccess = true) {
  const result = spawnSync(process.execPath, [fixture, `--scenario=${scenario}`, '--disable-gpu', '--disable-gpu-sandbox', '--no-sandbox'], {
    env: electronEnvironment(root),
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (expectSuccess && result.status !== 0) {
    throw new Error(`${scenario} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  if (!expectSuccess && result.status === 0) {
    throw new Error(`${scenario} unexpectedly exited cleanly.`);
  }
}

function openRecorder(root) {
  return new Database(path.join(root, 'diagnostics', 'prod', 'crash-recorder.db'), { readonly: true });
}

function incidents(root) {
  const db = openRecorder(root);
  try {
    return db.prepare('SELECT * FROM incidents ORDER BY first_event_at ASC').all();
  } finally {
    db.close();
  }
}

async function killScenario(root, scenario) {
  const child = spawn(process.execPath, [fixture, `--scenario=${scenario}`, '--disable-gpu', '--disable-gpu-sandbox', '--no-sandbox'], {
    env: electronEnvironment(root),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${scenario} did not become ready. stdout=${output}`)), 15_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('FIXTURE_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
  });
  child.kill('SIGKILL');
  await once(child, 'exit');
}

function temporaryRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `deskmate-crash-smoke-${label}-`));
}

const roots = [];
try {
  const normalRoot = temporaryRoot('normal');
  roots.push(normalRoot);
  runScenario(normalRoot, 'normal');
  let rows = incidents(normalRoot);
  assert(rows.length === 0, 'Normal exit created an Incident.');
  let db = openRecorder(normalRoot);
  assert(db.prepare('SELECT state FROM lifecycles ORDER BY started_at DESC LIMIT 1').get().state === 'clean', 'Normal lifecycle is not clean.');
  db.close();

  const updaterRoot = temporaryRoot('updater');
  roots.push(updaterRoot);
  runScenario(updaterRoot, 'updater');
  assert(incidents(updaterRoot).length === 0, 'Updater restart created an Incident.');

  const closeRoot = temporaryRoot('close-one');
  roots.push(closeRoot);
  runScenario(closeRoot, 'close-one');
  assert(incidents(closeRoot).length === 0, 'Closing one Profile window created an Incident.');

  const rendererRoot = temporaryRoot('renderer');
  roots.push(rendererRoot);
  runScenario(rendererRoot, 'renderer');
  rows = incidents(rendererRoot);
  assert(rows.length === 1 && rows[0].kind === 'renderer_crash', 'Renderer process.crash did not create exactly one renderer incident.');
  const rendererArtifacts = JSON.parse(rows[0].artifacts_json);
  assert(rendererArtifacts.items.some((artifact) => artifact.state === 'stored'), 'Renderer crash minidump was not collected during the open Incident window.');
  assert(rows[0].occurrence_count === 1, 'Supporting process signals inflated renderer occurrenceCount.');

  const dualRoot = temporaryRoot('dual');
  roots.push(dualRoot);
  runScenario(dualRoot, 'dual');
  rows = incidents(dualRoot);
  assert(rows.length === 1, 'Dual Profile renderer crash did not create exactly one Incident.');
  const dualPayload = JSON.parse(rows[0].payload_json);
  const rendererEvent = dualPayload.events.find((event) => event.type === 'renderer_gone');
  assert(rendererEvent?.window?.profileId === 'p_a', 'Dual Profile incident was not attributed to Profile A.');
  assert(rows[0].occurrence_count === 1, 'Dual Profile incident occurrenceCount is not one root failure.');

  const nativeRoot = temporaryRoot('main-native');
  roots.push(nativeRoot);
  runScenario(nativeRoot, 'main-native', false);
  runScenario(nativeRoot, 'recover');
  rows = incidents(nativeRoot);
  assert(rows.length === 1 && rows[0].kind === 'main_fatal', 'Main process.crash did not recover as one main_fatal Incident.');
  const nativeArtifacts = JSON.parse(rows[0].artifacts_json);
  assert(nativeArtifacts.items.length >= 1, 'Main native crash did not associate a minidump.');

  const jsRoot = temporaryRoot('main-js');
  roots.push(jsRoot);
  runScenario(jsRoot, 'main-js');
  const journalPath = path.join(jsRoot, 'diagnostics', 'prod', 'emergency.ndjson');
  assert(fs.readFileSync(journalPath, 'utf8').includes('fixture uncaught exception'), 'Main JS fatal did not reach Emergency Journal.');
  runScenario(jsRoot, 'recover');
  rows = incidents(jsRoot);
  assert(rows.length === 1 && rows[0].kind === 'main_fatal', 'Main JS fatal did not import as one Incident.');

  const killedRoot = temporaryRoot('killed');
  roots.push(killedRoot);
  await killScenario(killedRoot, 'hold-running');
  runScenario(killedRoot, 'recover');
  rows = incidents(killedRoot);
  assert(rows.length === 1 && rows[0].kind === 'abnormal_termination', 'SIGKILL while running was not classified as abnormal termination.');

  const shutdownRoot = temporaryRoot('shutdown');
  roots.push(shutdownRoot);
  await killScenario(shutdownRoot, 'hold-closing');
  runScenario(shutdownRoot, 'recover');
  assert(incidents(shutdownRoot).length === 0, 'Interrupted shutdown was incorrectly classified as a crash Incident.');

  process.stdout.write('Crash Recorder Electron smoke matrix passed.\n');
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
