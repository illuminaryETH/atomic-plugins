// scripts/reset-tags.js
// Resets all tags to just top-level categories and marks atoms for re-tagging
import Database from 'better-sqlite3';
import fs from 'fs';
import readline from 'readline';
import crypto from 'crypto';

// Default top-level category tags
const DEFAULT_CATEGORIES = [
  'Topics',
  'People',
  'Locations',
  'Organizations',
  'Events',
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
function countRecords(db, table, whereClause = '') {
  try {
    const query = whereClause
      ? `SELECT COUNT(*) as count FROM ${table} WHERE ${whereClause}`
      : `SELECT COUNT(*) as count FROM ${table}`;
    const result = db.prepare(query).get();
    return result.count;
  } catch (err) {
    return 0;
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
  console.log(`  Backup created: ${backupPath}\n`);

  return backupPath;
}

// Display current state
function displayCurrentState(db) {
  console.log('Current database state:\n');

  const atomCount = countRecords(db, 'atoms');
  const tagCount = countRecords(db, 'tags');
  const topLevelTagCount = countRecords(db, 'tags', 'parent_id IS NULL');
  const childTagCount = tagCount - topLevelTagCount;
  const atomTagCount = countRecords(db, 'atom_tags');
  const convTagCount = countRecords(db, 'conversation_tags');
  const wikiCount = countRecords(db, 'wiki_articles');
  const citationCount = countRecords(db, 'wiki_citations');

  console.log(`  Atoms: ${atomCount.toLocaleString()}`);
  console.log(`  Tags: ${tagCount.toLocaleString()} (${topLevelTagCount} top-level, ${childTagCount} children)`);
  console.log(`  Atom-tag associations: ${atomTagCount.toLocaleString()}`);
  console.log(`  Conversation-tag associations: ${convTagCount.toLocaleString()}`);
  console.log(`  Wiki articles: ${wikiCount.toLocaleString()}`);
  console.log(`  Wiki citations: ${citationCount.toLocaleString()}`);

  // Show existing top-level tags
  const topLevelTags = db.prepare('SELECT name FROM tags WHERE parent_id IS NULL ORDER BY name').all();
  if (topLevelTags.length > 0) {
    console.log(`\n  Existing top-level tags: ${topLevelTags.map(t => t.name).join(', ')}`);
  }

  return { atomCount, tagCount, topLevelTagCount, childTagCount, atomTagCount, convTagCount, wikiCount, citationCount };
}

// Reset tags
function resetTags(db, dryRun = false) {
  console.log(dryRun ? '\nDry run - showing what would happen:\n' : '\nResetting tags...\n');

  // Step 1: Delete all wiki citations
  const citationCount = countRecords(db, 'wiki_citations');
  if (dryRun) {
    console.log(`  Would delete ${citationCount.toLocaleString()} wiki citations`);
  } else {
    db.prepare('DELETE FROM wiki_citations').run();
    console.log(`  Deleted ${citationCount.toLocaleString()} wiki citations`);
  }

  // Step 2: Delete all wiki articles
  const wikiCount = countRecords(db, 'wiki_articles');
  if (dryRun) {
    console.log(`  Would delete ${wikiCount.toLocaleString()} wiki articles`);
  } else {
    db.prepare('DELETE FROM wiki_articles').run();
    console.log(`  Deleted ${wikiCount.toLocaleString()} wiki articles`);
  }

  // Step 3: Delete all atom-tag associations
  const atomTagCount = countRecords(db, 'atom_tags');
  if (dryRun) {
    console.log(`  Would delete ${atomTagCount.toLocaleString()} atom-tag associations`);
  } else {
    db.prepare('DELETE FROM atom_tags').run();
    console.log(`  Deleted ${atomTagCount.toLocaleString()} atom-tag associations`);
  }

  // Step 4: Delete all conversation-tag associations
  const convTagCount = countRecords(db, 'conversation_tags');
  if (dryRun) {
    console.log(`  Would delete ${convTagCount.toLocaleString()} conversation-tag associations`);
  } else {
    db.prepare('DELETE FROM conversation_tags').run();
    console.log(`  Deleted ${convTagCount.toLocaleString()} conversation-tag associations`);
  }

  // Step 5: Delete ALL tags (wipe the entire table and recreate)
  const totalTagCount = countRecords(db, 'tags');
  if (dryRun) {
    console.log(`  Would delete ${totalTagCount.toLocaleString()} tags (all levels)`);
  } else {
    // Delete all tags at once - foreign keys use CASCADE or SET NULL
    db.prepare('DELETE FROM tags').run();
    console.log(`  Deleted ${totalTagCount.toLocaleString()} tags`);
  }

  // Step 6: Create default category tags
  const now = new Date().toISOString();
  const insertTag = db.prepare('INSERT INTO tags (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)');

  if (dryRun) {
    console.log(`  Would create ${DEFAULT_CATEGORIES.length} default category tags: ${DEFAULT_CATEGORIES.join(', ')}`);
  } else {
    for (const tagName of DEFAULT_CATEGORIES) {
      const tagId = crypto.randomUUID();
      insertTag.run(tagId, tagName, null, now);
    }
    console.log(`  Created ${DEFAULT_CATEGORIES.length} default category tags: ${DEFAULT_CATEGORIES.join(', ')}`);
  }

  // Step 7: Mark all atoms as needing re-tagging
  const atomCount = countRecords(db, 'atoms');
  if (dryRun) {
    console.log(`  Would mark ${atomCount.toLocaleString()} atoms for re-tagging (tagging_status = 'pending')`);
  } else {
    db.prepare("UPDATE atoms SET tagging_status = 'pending' WHERE embedding_status = 'complete'").run();
    const pendingCount = countRecords(db, 'atoms', "tagging_status = 'pending'");
    console.log(`  Marked ${pendingCount.toLocaleString()} atoms for re-tagging`);
  }

  return {
    citationsDeleted: citationCount,
    wikisDeleted: wikiCount,
    associationsDeleted: atomTagCount,
    tagsDeleted: totalTagCount,
    categoriesCreated: DEFAULT_CATEGORIES.length,
    atomsMarked: atomCount,
  };
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
Tag Reset Script for Atomic

Usage: node scripts/reset-tags.js [options]

Resets all tags to default top-level categories and marks atoms for re-tagging.
This is useful after changing the auto-tagging behavior.

What this script does:
  1. Deletes all wiki articles and citations
  2. Deletes all atom-tag associations
  3. Deletes all tags (top-level and children)
  4. Creates default category tags: ${DEFAULT_CATEGORIES.join(', ')}
  5. Marks all atoms with completed embeddings for re-tagging

After running this script:
  - Run the app and use "Process Pending Tagging" to re-tag all atoms
  - Or atoms will be re-tagged automatically as you view them

Options:
  --db <path>      Custom database path
  --force          Skip confirmation prompt
  --backup         Create backup before resetting
  --dry-run        Show what would happen without making changes
  --help           Show this help message

Examples:
  node scripts/reset-tags.js --dry-run
  node scripts/reset-tags.js --backup
  node scripts/reset-tags.js --force --backup
      `);
      return;
    }
  }

  // Use default path if not specified
  if (!dbPath) {
    dbPath = getDefaultDbPath();
  }

  console.log('Tag Reset Script for Atomic\n');
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

  // Enable foreign keys for proper CASCADE behavior
  db.pragma('foreign_keys = ON');

  try {
    // Display current state
    const state = displayCurrentState(db);

    // Check if there's anything to reset
    if (state.tagCount === 0 && state.atomTagCount === 0 && state.convTagCount === 0 && state.wikiCount === 0) {
      console.log('\n  No tags or wikis to reset!');
      db.close();
      return;
    }

    // Dry run mode
    if (dryRun) {
      resetTags(db, true);
      console.log('\nDry run complete - no changes made.');
      db.close();
      return;
    }

    // Confirmation prompt
    if (!force) {
      console.log('\n  WARNING: This will:');
      console.log('    - Delete ALL wiki articles and citations');
      console.log('    - Delete ALL atom-tag associations');
      console.log('    - Delete ALL tags and recreate only top-level categories');
      console.log('    - Mark all atoms for re-tagging\n');
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

    // Reset tags
    resetTags(db, false);

    console.log('\n  Tag reset complete!\n');
    console.log('Next steps:');
    console.log('  1. Start the Atomic app');
    console.log('  2. Go to Settings and click "Process Pending Tagging"');
    console.log('  3. Wait for all atoms to be re-tagged with the new category structure\n');

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch(console.error);
