// scripts/drop-database.js
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Data directory - where registry.db and databases/ live
function getDefaultDataDir() {
  // Check for --data-dir or ATOMIC_DATA_DIR first
  const envDir = process.env.ATOMIC_DATA_DIR;
  if (envDir) return envDir;

  // Server mode default: current directory
  const cwdRegistry = path.join(process.cwd(), 'registry.db');
  const cwdDatabases = path.join(process.cwd(), 'databases');
  if (fs.existsSync(cwdRegistry) || fs.existsSync(cwdDatabases)) {
    return process.cwd();
  }

  // Tauri app data directory
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === 'darwin') {
    return `${home}/Library/Application Support/com.atomic.app`;
  } else if (platform === 'linux') {
    return `${home}/.local/share/com.atomic.app`;
  } else if (platform === 'win32') {
    return `${process.env.APPDATA}/com.atomic.app`;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function promptConfirmation(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function findAllFiles(dataDir) {
  const files = [];

  // Registry
  const registry = path.join(dataDir, 'registry.db');
  if (fs.existsSync(registry)) files.push(registry);
  for (const ext of ['-wal', '-shm']) {
    const f = registry + ext;
    if (fs.existsSync(f)) files.push(f);
  }

  // Databases directory
  const dbDir = path.join(dataDir, 'databases');
  if (fs.existsSync(dbDir)) {
    for (const file of fs.readdirSync(dbDir)) {
      files.push(path.join(dbDir, file));
    }
  }

  // Legacy atomic.db
  const legacy = path.join(dataDir, 'atomic.db');
  if (fs.existsSync(legacy)) files.push(legacy);
  for (const ext of ['-wal', '-shm']) {
    const f = legacy + ext;
    if (fs.existsSync(f)) files.push(f);
  }

  return files;
}

async function main() {
  const args = process.argv.slice(2);

  let dataDir = null;
  let force = false;
  let backup = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--data-dir' || args[i] === '--db') && args[i + 1]) {
      dataDir = args[i + 1];
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--backup') {
      backup = true;
    } else if (args[i] === '--help') {
      console.log(`
Database Drop Script for Atomic

Usage: node scripts/drop-database.js [options]

Deletes ALL database files: registry.db, all databases/*.db files, and WAL/SHM files.
The app will create a fresh database on next startup.

Options:
  --data-dir <path>  Data directory (default: auto-detect)
  --force            Skip confirmation prompt
  --backup           Create timestamped backup directory first
  --help             Show this help message
      `);
      return;
    }
  }

  if (!dataDir) {
    dataDir = getDefaultDataDir();
  }

  console.log('Database Drop Script for Atomic\n');
  console.log(`Data directory: ${dataDir}\n`);

  const files = findAllFiles(dataDir);

  if (files.length === 0) {
    console.log('No database files found.');
    return;
  }

  console.log('Files to delete:');
  let totalSize = 0;
  for (const f of files) {
    try {
      const stats = fs.statSync(f);
      totalSize += stats.size;
      console.log(`  ${path.relative(dataDir, f)} (${formatFileSize(stats.size)})`);
    } catch {
      console.log(`  ${path.relative(dataDir, f)} (inaccessible)`);
    }
  }
  console.log(`\nTotal: ${formatFileSize(totalSize)}`);

  if (!force) {
    console.log('\nThis will PERMANENTLY DELETE all databases, settings, and tokens.');
    const confirmed = await promptConfirmation("Type 'yes' to continue: ");
    if (!confirmed) {
      console.log('\nCancelled.');
      return;
    }
  }

  if (backup) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const backupDir = path.join(dataDir, `backup_${timestamp}`);
    console.log(`\nBacking up to ${backupDir}...`);
    fs.mkdirSync(backupDir, { recursive: true });
    for (const f of files) {
      const rel = path.relative(dataDir, f);
      const dest = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f, dest);
    }
    console.log('Backup complete.');
  }

  console.log('\nDeleting...');
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }

  // Remove empty databases/ directory
  const dbDir = path.join(dataDir, 'databases');
  try { fs.rmdirSync(dbDir); } catch {}

  console.log('All database files deleted.');
  console.log('Start the app to create a fresh database.');
}

main().catch(console.error);
