#!/usr/bin/env node

/**
 * Development helper for the Capacitor Android app.
 *
 * Spawns the backend + web dev server (via dev-server.js), points Capacitor
 * at the running Vite instance via CAP_DEV_URL, builds the Android app,
 * installs it on a booted emulator, and launches it. Edits to src/
 * hot-reload through Vite HMR — no rebuild or re-sync needed for JS/TS/CSS
 * changes.
 *
 * Uses `adb reverse` so the emulator can reach Vite at localhost:1420
 * (otherwise it would need 10.0.2.2). That means CAP_DEV_URL stays identical
 * to the iOS flow.
 *
 * Usage:
 *   npm run dev:mobile:android
 *   npm run dev:mobile:android -- --device Pixel_7_API_34
 *   npm run dev:mobile:android -- --no-build    # skip gradle (reuse prior apk)
 *   npm run dev:mobile:android -- --postgres    # forwarded to dev-server.js
 *
 * Options:
 *   --device NAME   AVD name (default: first running emulator, else first AVD)
 *   --no-build      Skip gradle assembleDebug; reuse the previously built apk
 *
 * All unrecognised flags are forwarded to scripts/dev-server.js.
 * Ctrl+C stops the backend, Vite, and force-stops the app on the emulator.
 */

import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const DEV_URL = 'http://localhost:1420';
const DEV_PORT = 1420;
const BUNDLE_ID = 'com.atomic.mobile';
const ANDROID_DIR = resolve(root, 'mobile/android');
const APK_PATH = resolve(ANDROID_DIR, 'app/build/outputs/apk/debug/app-debug.apk');
const GRADLEW = resolve(ANDROID_DIR, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

let deviceName = null;
let skipBuild = false;
const forwardArgs = [];
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--device') deviceName = rawArgs[++i];
  else if (a === '--no-build') skipBuild = true;
  else forwardArgs.push(a);
}

const children = [];
let shuttingDown = false;

function log(prefix, line, color = '\x1b[36m') {
  process.stdout.write(`${color}[${prefix.padEnd(6)}]\x1b[0m ${line}\n`);
}

function spawnChild(name, command, args, opts = {}) {
  const proc = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
  });
  const color = opts.color || '\x1b[36m';
  const emit = (warn) => (data) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      log(name, line, warn ? '\x1b[33m' : color);
    }
  };
  proc.stdout.on('data', emit(false));
  proc.stderr.on('data', emit(true));
  proc.on('exit', (code) => {
    log(name, `exited (${code})`, '\x1b[90m');
    if (!shuttingDown) cleanup(1);
  });
  children.push(proc);
  return proc;
}

function waitForVite(timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const tick = () => {
      if (Date.now() - start > timeoutMs) {
        rejectPromise(new Error(`Vite did not respond on ${DEV_URL} within ${timeoutMs}ms`));
        return;
      }
      const req = http.get(DEV_URL, (res) => {
        res.resume();
        resolvePromise();
      });
      req.on('error', () => setTimeout(tick, 500));
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Auto-detect a Homebrew-installed SDK/JDK when env vars aren't set, so
// `npm run dev:mobile:android` works without users editing their shell rc.
// Only apply defaults that actually exist on disk.
function autodetectAndroidEnv() {
  const sdkCandidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    '/opt/homebrew/share/android-commandlinetools',
    '/usr/local/share/android-commandlinetools',
    `${process.env.HOME}/Library/Android/sdk`,
  ].filter(Boolean);
  for (const p of sdkCandidates) {
    if (existsSync(p)) {
      process.env.ANDROID_SDK_ROOT = p;
      process.env.ANDROID_HOME = p;
      break;
    }
  }

  if (!process.env.JAVA_HOME && !which('java')) {
    const jdkCandidates = [
      '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
      '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    ];
    for (const p of jdkCandidates) {
      if (existsSync(`${p}/bin/java`)) {
        process.env.JAVA_HOME = p;
        process.env.PATH = `${p}/bin:${process.env.PATH}`;
        break;
      }
    }
  }
}

autodetectAndroidEnv();

function sdkTool(name) {
  const onPath = which(name);
  if (onPath) return onPath;
  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (!sdkRoot) return null;
  const candidates = name === 'emulator'
    ? [`${sdkRoot}/emulator/emulator`]
    : [`${sdkRoot}/platform-tools/${name}`, `${sdkRoot}/cmdline-tools/latest/bin/${name}`];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

const ADB = sdkTool('adb');
const EMULATOR = sdkTool('emulator');

function preflight() {
  const problems = [];
  if (!ADB) problems.push('adb not found on PATH or under ANDROID_SDK_ROOT/platform-tools');
  if (!EMULATOR) problems.push('emulator not found on PATH or under ANDROID_SDK_ROOT/emulator');
  if (!which('java')) problems.push('java not found on PATH (needed by gradlew)');
  if (!existsSync(ANDROID_DIR)) problems.push(`android project missing at ${ANDROID_DIR} — run \`npx cap add android\``);
  if (problems.length) {
    const msg = [
      'Android toolchain is not ready:',
      ...problems.map((p) => `  - ${p}`),
      '',
      'Install Android Studio (which bundles the SDK + emulator) and set ANDROID_SDK_ROOT,',
      'or install the command-line tools + a JDK. Then re-run this script.',
    ].join('\n');
    throw new Error(msg);
  }
}

function listAvds() {
  const r = spawnSync(EMULATOR, ['-list-avds'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function bootedSerial() {
  // `adb devices` prints "List of devices attached\n<serial>\t<state>\n..."
  const r = spawnSync(ADB, ['devices'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  for (const line of r.stdout.split('\n').slice(1)) {
    const [serial, state] = line.split('\t');
    if (serial && state && state.trim() === 'device') return serial.trim();
  }
  return null;
}

function ensureEmulator() {
  // Prefer any already-booted device (physical or emulator) when no --device given.
  const booted = bootedSerial();
  if (booted && !deviceName) {
    log('emu', `using already-booted device: ${booted}`);
    return booted;
  }

  const avds = listAvds();
  if (avds.length === 0) {
    throw new Error(
      'No Android Virtual Devices found. Create one in Android Studio ' +
      '(Tools → Device Manager) or via `avdmanager create avd`.',
    );
  }

  const target = deviceName || avds[0];
  if (!avds.includes(target)) {
    throw new Error(`AVD "${target}" not found. Available: ${avds.join(', ')}`);
  }

  log('emu', `booting ${target}...`);
  // Detached so the emulator keeps running after this script exits.
  const emu = spawn(EMULATOR, ['-avd', target, '-no-boot-anim', '-no-snapshot-save'], {
    stdio: 'ignore',
    detached: true,
  });
  emu.unref();

  log('emu', 'waiting for device...');
  execFileSync(ADB, ['wait-for-device'], { stdio: 'inherit' });
  // sys.boot_completed → '1' when Android is fully up.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const r = spawnSync(ADB, ['shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '1') {
      return bootedSerial() || target;
    }
    // Busy-wait at 1s granularity for boot — cheap and bounded.
    const waitUntil = Date.now() + 1000;
    while (Date.now() < waitUntil) {}
  }
  throw new Error(`Emulator ${target} failed to finish booting within 120s`);
}

function adbReverse(serial) {
  // Route emulator localhost:1420 → host localhost:1420.
  log('adb', `reverse tcp:${DEV_PORT} -> host tcp:${DEV_PORT}`);
  execFileSync(ADB, ['-s', serial, 'reverse', `tcp:${DEV_PORT}`, `tcp:${DEV_PORT}`], {
    stdio: 'inherit',
  });
}

function capSync() {
  log('cap', `cap sync android (CAP_DEV_URL=${DEV_URL})`);
  execFileSync('npx', ['cap', 'sync', 'android'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CAP_DEV_URL: DEV_URL },
  });
}

function gradleBuild() {
  log('cap', 'gradlew :app:assembleDebug...');
  execFileSync(GRADLEW, [':app:assembleDebug'], {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
  });
}

function installAndLaunch(serial) {
  if (!existsSync(APK_PATH)) {
    throw new Error(`APK not found at ${APK_PATH} (did gradle build fail?)`);
  }
  log('emu', 'installing app...');
  execFileSync(ADB, ['-s', serial, 'install', '-r', APK_PATH], { stdio: 'inherit' });
  try {
    execFileSync(ADB, ['-s', serial, 'shell', 'am', 'force-stop', BUNDLE_ID], { stdio: 'ignore' });
  } catch {}
  log('emu', 'launching app');
  execFileSync(
    ADB,
    ['-s', serial, 'shell', 'am', 'start', '-n', `${BUNDLE_ID}/.MainActivity`],
    { stdio: 'inherit' },
  );
}

function cleanup(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (ADB) {
    try { execFileSync(ADB, ['shell', 'am', 'force-stop', BUNDLE_ID], { stdio: 'ignore' }); } catch {}
    try { execFileSync(ADB, ['reverse', '--remove', `tcp:${DEV_PORT}`], { stdio: 'ignore' }); } catch {}
  }
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

(async () => {
  preflight();

  // 1. Backend + Vite via the existing dev-server.js (forwarding unknown flags).
  spawnChild('dev', 'node', [resolve(root, 'scripts/dev-server.js'), ...forwardArgs], {
    color: '\x1b[36m',
  });

  // 2. Wait for Vite to answer before syncing — cap sync doesn't care, but we
  //    don't want to launch the app before HMR is ready to serve.
  log('cap', `waiting for Vite on ${DEV_URL}...`);
  await waitForVite();
  log('cap', 'Vite is up');

  // 3. Emulator, reverse-port, sync, build, install, launch.
  const serial = ensureEmulator();
  log('emu', `target: ${serial}`);
  adbReverse(serial);
  capSync();
  if (!skipBuild) gradleBuild();
  installAndLaunch(serial);

  log('cap', 'ready — edit src/ to hot-reload in the emulator (Ctrl+C to stop)');
})().catch((err) => {
  console.error(`\x1b[31m[error]\x1b[0m ${err.stack || err.message || err}`);
  cleanup(1);
});
