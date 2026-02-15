#!/usr/bin/env node
/**
 * Build script for atomic-server sidecar
 *
 * Compiles the standalone server binary and places it in src-tauri/binaries/
 * with the correct architecture suffix for Tauri's externalBin feature.
 *
 * Usage:
 *   node scripts/build-server.js           # Build for current platform
 *   node scripts/build-server.js --target aarch64-apple-darwin
 */

import { execSync } from 'child_process';
import { mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Map Rust target triples to Tauri's expected suffixes
const TARGET_MAP = {
  'x86_64-apple-darwin': 'x86_64-apple-darwin',
  'aarch64-apple-darwin': 'aarch64-apple-darwin',
  'x86_64-pc-windows-msvc': 'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu': 'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu': 'aarch64-unknown-linux-gnu',
};

// Detect current platform's Rust target
function detectTarget() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  } else if (platform === 'win32') {
    return 'x86_64-pc-windows-msvc';
  } else if (platform === 'linux') {
    return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

function main() {
  // Parse args for --target
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf('--target');
  const target = targetIdx !== -1 ? args[targetIdx + 1] : detectTarget();

  if (!TARGET_MAP[target]) {
    console.error(`Unknown target: ${target}`);
    console.error(`Supported targets: ${Object.keys(TARGET_MAP).join(', ')}`);
    process.exit(1);
  }

  console.log(`Building atomic-server for ${target}...`);

  // Build the binary
  const buildCmd = `cargo build -p atomic-server --release --target ${target}`;
  console.log(`Running: ${buildCmd}`);

  try {
    execSync(buildCmd, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env }
    });
  } catch (error) {
    console.error('Build failed');
    process.exit(1);
  }

  // Determine binary name and paths
  const binaryName = process.platform === 'win32' ? 'atomic-server.exe' : 'atomic-server';
  const ext = process.platform === 'win32' ? '.exe' : '';

  const sourcePath = join(projectRoot, 'target', target, 'release', binaryName);
  const destDir = join(projectRoot, 'src-tauri', 'binaries');
  const destPath = join(destDir, `atomic-server-${target}${ext}`);

  // Create binaries directory if needed
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
    console.log(`Created directory: ${destDir}`);
  }

  // Copy binary with architecture suffix
  if (!existsSync(sourcePath)) {
    console.error(`Binary not found: ${sourcePath}`);
    process.exit(1);
  }

  copyFileSync(sourcePath, destPath);
  console.log(`Copied: ${sourcePath} -> ${destPath}`);

  console.log('Done!');
}

main();
