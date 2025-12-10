// scripts/reset-database.js
import Database from 'better-sqlite3';
import fs from 'fs';
import readline from 'readline';
import crypto from 'crypto';

// Tables to clear in safe deletion order
const TABLES_TO_CLEAR = [
  'atom_positions',
  'wiki_citations',
  'wiki_articles',
  'vec_chunks',
  'atom_chunks',
  'atom_tags',
  'atoms',
  'tags',
];

// Database path - in development, the database is in the Tauri app data directory
function getDefaultDbPath() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === 'darwin') {
    return `${home}/Library/Application Support/com.atomic.app/atomic.db`;
  } else if (platform === 'linux') {
    return `${home}/.local/share/com.atomic.app/atomic.db`;
  } else if (platform === 'win32') {
    return `${process.env.APPDATA}/com.atomic.app/atomic.db`;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

// Count records in a table
function countRecords(db, table) {
  try {
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    return result.count;
  } catch (err) {
    return 0; // Table might not exist in older schemas
  }
}

// Get settings for display
function getSettings(db) {
  try {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    return settings.reduce((acc, { key, value }) => {
      // Mask sensitive values
      if (key.includes('key') || key.includes('token')) {
        const masked = value.substring(0, 6) + '*'.repeat(Math.min(value.length - 6, 15));
        acc[key] = masked;
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
  } catch (err) {
    return {};
  }
}

// Prompt for confirmation
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

// Create backup
function createBackup(dbPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const backupPath = dbPath.replace('.db', `_backup_${timestamp}.db`);

  console.log(`\nCreating backup...`);
  fs.copyFileSync(dbPath, backupPath);
  console.log(`✓ Backup created: ${backupPath}\n`);

  return backupPath;
}

// Clear database content
function clearDatabase(db, dryRun = false) {
  const deleted = {};

  console.log(dryRun ? '\nDry run - showing what would be deleted:\n' : '\nClearing database...\n');

  for (const table of TABLES_TO_CLEAR) {
    const count = countRecords(db, table);

    if (dryRun) {
      console.log(`  Would delete ${count.toLocaleString()} records from ${table}`);
      deleted[table] = count;
    } else {
      try {
        // Special handling for virtual tables
        if (table === 'vec_chunks') {
          // Drop and recreate virtual table instead of DELETE
          db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
          console.log(`  ✓ Dropped ${count.toLocaleString()} ${table} (virtual table)`);
        } else {
          db.prepare(`DELETE FROM ${table}`).run();
          console.log(`  ✓ Deleted ${count.toLocaleString()} ${table}`);
        }
        deleted[table] = count;
      } catch (err) {
        console.log(`  ⚠ Skipped ${table} (${err.message})`);
        deleted[table] = 0;
      }
    }
  }

  return deleted;
}

// Insert default top-level tags
function insertDefaultTags(db) {
  console.log('\nInserting default tags...');

  // Must match categories in db.rs and scripts/reset-tags.js
  const defaultTags = ['Topics', 'People', 'Locations', 'Organizations', 'Events'];
  const now = new Date().toISOString();

  const insertTag = db.prepare('INSERT INTO tags (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)');
  const checkTag = db.prepare('SELECT 1 FROM tags WHERE name = ? COLLATE NOCASE');

  for (const tagName of defaultTags) {
    // Check if tag already exists
    const exists = checkTag.get(tagName);

    if (!exists) {
      // Generate UUID for tag
      const tagId = crypto.randomUUID();
      insertTag.run(tagId, tagName, null, now);
      console.log(`  ✓ Created tag: ${tagName}`);
    }
  }
}

// Vacuum database to reclaim space
function vacuumDatabase(db, dbPath) {
  console.log('\nVacuuming database...');

  const sizeBefore = fs.statSync(dbPath).size;
  db.prepare('VACUUM').run();
  const sizeAfter = fs.statSync(dbPath).size;
  const freed = (sizeBefore - sizeAfter) / 1024 / 1024;

  console.log(`  ✓ Freed ${freed.toFixed(1)} MB`);
}

// Display counts
function displayCounts(db) {
  console.log('\nCurrent database contents:');

  const totals = {};
  for (const table of TABLES_TO_CLEAR) {
    const count = countRecords(db, table);
    if (count > 0) {
      console.log(`  - ${table}: ${count.toLocaleString()} records`);
      totals[table] = count;
    }
  }

  const settings = getSettings(db);
  if (Object.keys(settings).length > 0) {
    console.log('\nSettings to preserve:');
    for (const [key, value] of Object.entries(settings)) {
      console.log(`  - ${key}: ${value}`);
    }
  }

  return totals;
}

// Main function
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let dbPath = null;
  let force = false;
  let backup = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      dbPath = args[i + 1];
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--backup') {
      backup = true;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--help') {
      console.log(`
Database Reset Script for Atomic

Usage: node scripts/reset-database.js [options]

Clears all content from the database while preserving settings.

Options:
  --db <path>      Custom database path
  --force          Skip confirmation prompt
  --backup         Create backup before clearing
  --dry-run        Show what would be deleted without doing it
  --help           Show this help message

Examples:
  node scripts/reset-database.js
  node scripts/reset-database.js --backup
  node scripts/reset-database.js --dry-run
  node scripts/reset-database.js --force --backup
      `);
      return;
    }
  }

  // Use default path if not specified
  if (!dbPath) {
    dbPath = getDefaultDbPath();
  }

  console.log('Database Reset Script for Atomic\n');
  console.log(`Database: ${dbPath}\n`);

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    console.error('\nThe database is created when you first run the Atomic app.');
    console.error('Please run the app at least once before using this script.');
    console.error('\nAlternatively, specify a custom database path with --db <path>');
    process.exit(1);
  }

  // Open database
  const db = new Database(dbPath);

  try {
    // Display current counts
    const totals = displayCounts(db);

    // Check if there's anything to delete
    const hasContent = Object.values(totals).some(count => count > 0);
    if (!hasContent) {
      console.log('\n✓ Database is already empty!');
      db.close();
      return;
    }

    // Dry run mode
    if (dryRun) {
      clearDatabase(db, true);
      console.log('\nDry run complete - no changes made.');
      db.close();
      return;
    }

    // Confirmation prompt
    if (!force) {
      console.log('\n⚠️  WARNING: This will DELETE ALL CONTENT except settings!\n');
      const confirmed = await promptConfirmation('Type \'yes\' to continue: ');

      if (!confirmed) {
        console.log('\nCancelled.');
        db.close();
        return;
      }
    }

    // Create backup if requested
    if (backup) {
      createBackup(dbPath);
    }

    // Clear the database
    clearDatabase(db, false);

    // Insert default tags
    insertDefaultTags(db);

    // Vacuum to reclaim space
    vacuumDatabase(db, dbPath);

    // Show preserved settings
    const settings = getSettings(db);
    if (Object.keys(settings).length > 0) {
      console.log('\nPreserved settings:');
      for (const key of Object.keys(settings)) {
        console.log(`  - ${key}`);
      }
    }

    console.log('\n✓ Database cleared successfully!\n');
    console.log('Start the Atomic app to begin fresh.');

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch(console.error);
