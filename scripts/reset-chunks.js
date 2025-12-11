// scripts/reset-chunks.js
// Resets all chunks and related data (wikis, chats, citations, semantic edges)
// and marks atoms for re-embedding
import Database from 'better-sqlite3';
import fs from 'fs';
import readline from 'readline';

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

// Tables that require sqlite-vec extension (virtual tables)
const VIRTUAL_TABLES = ['vec_chunks'];

// Count records in a table
function countRecords(db, table, whereClause = '') {
  try {
    // For virtual tables, we can't count directly without the extension
    if (VIRTUAL_TABLES.includes(table)) {
      return null; // Unknown count
    }
    const query = whereClause
      ? `SELECT COUNT(*) as count FROM ${table} WHERE ${whereClause}`
      : `SELECT COUNT(*) as count FROM ${table}`;
    const result = db.prepare(query).get();
    return result.count;
  } catch (err) {
    return 0;
  }
}

// Format count for display (handles null for unknown)
function formatCount(count) {
  if (count === null) return '(unknown - virtual table)';
  return count.toLocaleString();
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
  const chunkCount = countRecords(db, 'atom_chunks');
  const vecChunkCount = countRecords(db, 'vec_chunks');
  const edgeCount = countRecords(db, 'semantic_edges');
  const clusterCount = countRecords(db, 'atom_clusters');
  const positionCount = countRecords(db, 'atom_positions');
  const wikiCount = countRecords(db, 'wiki_articles');
  const wikiCitationCount = countRecords(db, 'wiki_citations');
  const convCount = countRecords(db, 'conversations');
  const messageCount = countRecords(db, 'chat_messages');
  const toolCallCount = countRecords(db, 'chat_tool_calls');
  const chatCitationCount = countRecords(db, 'chat_citations');

  console.log(`  Atoms: ${formatCount(atomCount)}`);
  console.log(`  Chunks: ${formatCount(chunkCount)}`);
  console.log(`  Vector chunks: ${formatCount(vecChunkCount)}`);
  console.log(`  Semantic edges: ${formatCount(edgeCount)}`);
  console.log(`  Atom clusters: ${formatCount(clusterCount)}`);
  console.log(`  Atom positions: ${formatCount(positionCount)}`);
  console.log(`  Wiki articles: ${formatCount(wikiCount)}`);
  console.log(`  Wiki citations: ${formatCount(wikiCitationCount)}`);
  console.log(`  Conversations: ${formatCount(convCount)}`);
  console.log(`  Chat messages: ${formatCount(messageCount)}`);
  console.log(`  Chat tool calls: ${formatCount(toolCallCount)}`);
  console.log(`  Chat citations: ${formatCount(chatCitationCount)}`);

  // Show embedding status breakdown
  const pendingCount = countRecords(db, 'atoms', "embedding_status = 'pending'");
  const processingCount = countRecords(db, 'atoms', "embedding_status = 'processing'");
  const completeCount = countRecords(db, 'atoms', "embedding_status = 'complete'");
  const failedCount = countRecords(db, 'atoms', "embedding_status = 'failed'");

  console.log(`\n  Embedding status breakdown:`);
  console.log(`    Pending: ${formatCount(pendingCount)}`);
  console.log(`    Processing: ${formatCount(processingCount)}`);
  console.log(`    Complete: ${formatCount(completeCount)}`);
  console.log(`    Failed: ${formatCount(failedCount)}`);

  return {
    atomCount,
    chunkCount,
    vecChunkCount,
    edgeCount,
    clusterCount,
    positionCount,
    wikiCount,
    wikiCitationCount,
    convCount,
    messageCount,
    toolCallCount,
    chatCitationCount,
  };
}

// Reset chunks and related data
function resetChunks(db, dryRun = false) {
  console.log(dryRun ? '\nDry run - showing what would happen:\n' : '\nResetting chunks and related data...\n');

  // Step 1: Delete all chat citations
  const chatCitationCount = countRecords(db, 'chat_citations');
  if (dryRun) {
    console.log(`  Would delete ${chatCitationCount.toLocaleString()} chat citations`);
  } else {
    db.prepare('DELETE FROM chat_citations').run();
    console.log(`  Deleted ${chatCitationCount.toLocaleString()} chat citations`);
  }

  // Step 2: Delete all chat tool calls
  const toolCallCount = countRecords(db, 'chat_tool_calls');
  if (dryRun) {
    console.log(`  Would delete ${toolCallCount.toLocaleString()} chat tool calls`);
  } else {
    db.prepare('DELETE FROM chat_tool_calls').run();
    console.log(`  Deleted ${toolCallCount.toLocaleString()} chat tool calls`);
  }

  // Step 3: Delete all chat messages
  const messageCount = countRecords(db, 'chat_messages');
  if (dryRun) {
    console.log(`  Would delete ${messageCount.toLocaleString()} chat messages`);
  } else {
    db.prepare('DELETE FROM chat_messages').run();
    console.log(`  Deleted ${messageCount.toLocaleString()} chat messages`);
  }

  // Step 4: Delete all conversations
  const convCount = countRecords(db, 'conversations');
  if (dryRun) {
    console.log(`  Would delete ${convCount.toLocaleString()} conversations`);
  } else {
    db.prepare('DELETE FROM conversations').run();
    console.log(`  Deleted ${convCount.toLocaleString()} conversations`);
  }

  // Step 5: Delete all wiki citations
  const wikiCitationCount = countRecords(db, 'wiki_citations');
  if (dryRun) {
    console.log(`  Would delete ${wikiCitationCount.toLocaleString()} wiki citations`);
  } else {
    db.prepare('DELETE FROM wiki_citations').run();
    console.log(`  Deleted ${wikiCitationCount.toLocaleString()} wiki citations`);
  }

  // Step 6: Delete all wiki articles
  const wikiCount = countRecords(db, 'wiki_articles');
  if (dryRun) {
    console.log(`  Would delete ${wikiCount.toLocaleString()} wiki articles`);
  } else {
    db.prepare('DELETE FROM wiki_articles').run();
    console.log(`  Deleted ${wikiCount.toLocaleString()} wiki articles`);
  }

  // Step 7: Delete all semantic edges
  const edgeCount = countRecords(db, 'semantic_edges');
  if (dryRun) {
    console.log(`  Would delete ${edgeCount.toLocaleString()} semantic edges`);
  } else {
    db.prepare('DELETE FROM semantic_edges').run();
    console.log(`  Deleted ${edgeCount.toLocaleString()} semantic edges`);
  }

  // Step 8: Delete all atom clusters
  const clusterCount = countRecords(db, 'atom_clusters');
  if (dryRun) {
    console.log(`  Would delete ${clusterCount.toLocaleString()} atom clusters`);
  } else {
    db.prepare('DELETE FROM atom_clusters').run();
    console.log(`  Deleted ${clusterCount.toLocaleString()} atom clusters`);
  }

  // Step 9: Delete all atom positions (canvas will need to re-simulate)
  const positionCount = countRecords(db, 'atom_positions');
  if (dryRun) {
    console.log(`  Would delete ${positionCount.toLocaleString()} atom positions`);
  } else {
    db.prepare('DELETE FROM atom_positions').run();
    console.log(`  Deleted ${positionCount.toLocaleString()} atom positions`);
  }

  // Step 10: Note about vector chunks
  // vec_chunks is a sqlite-vec virtual table that requires the native extension.
  // We can't access it from Node.js without loading the extension.
  // The Tauri app will handle orphaned vec_chunks entries - they'll be cleaned up
  // when the app rebuilds the vec_chunks table during re-embedding.
  console.log(`  Vector chunks: will be rebuilt by app during re-embedding (requires sqlite-vec extension)`)

  // Step 11: Delete FTS entries
  let ftsCount = 0;
  try {
    ftsCount = countRecords(db, 'atom_chunks_fts');
    if (dryRun) {
      console.log(`  Would delete ${ftsCount.toLocaleString()} FTS entries`);
    } else {
      db.prepare('DELETE FROM atom_chunks_fts').run();
      console.log(`  Deleted ${ftsCount.toLocaleString()} FTS entries`);
    }
  } catch (err) {
    // FTS table might not exist in older databases
    console.log(`  FTS table not found (skipped)`);
  }

  // Step 12: Delete all atom chunks
  const chunkCount = countRecords(db, 'atom_chunks');
  if (dryRun) {
    console.log(`  Would delete ${chunkCount.toLocaleString()} atom chunks`);
  } else {
    db.prepare('DELETE FROM atom_chunks').run();
    console.log(`  Deleted ${chunkCount.toLocaleString()} atom chunks`);
  }

  // Step 13: Mark all atoms as needing re-embedding
  const atomCount = countRecords(db, 'atoms');
  if (dryRun) {
    console.log(`  Would mark ${atomCount.toLocaleString()} atoms for re-embedding (embedding_status = 'pending', tagging_status = 'pending')`);
  } else {
    db.prepare("UPDATE atoms SET embedding_status = 'pending', tagging_status = 'pending'").run();
    console.log(`  Marked ${atomCount.toLocaleString()} atoms for re-embedding and re-tagging`);
  }

  return {
    chatCitationsDeleted: chatCitationCount,
    toolCallsDeleted: toolCallCount,
    messagesDeleted: messageCount,
    conversationsDeleted: convCount,
    wikiCitationsDeleted: wikiCitationCount,
    wikisDeleted: wikiCount,
    edgesDeleted: edgeCount,
    clustersDeleted: clusterCount,
    positionsDeleted: positionCount,
    ftsDeleted: ftsCount,
    chunksDeleted: chunkCount,
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
Chunk Reset Script for Atomic

Usage: node scripts/reset-chunks.js [options]

Resets all chunks and related data, then marks atoms for re-embedding.
This is useful after changing the chunking strategy or embedding model.

What this script deletes:
  - All chat messages, tool calls, citations, and conversations
  - All wiki articles and citations
  - All semantic edges and atom clusters
  - All atom positions (canvas will re-simulate)
  - All vector chunks and FTS entries
  - All atom chunks

What this script preserves:
  - All atoms (content)
  - All tags and tag associations

After running this script:
  - Run the app and use "Process Pending Embeddings" to re-embed all atoms
  - Or atoms will be re-embedded automatically as you view them
  - Canvas view will re-calculate positions on first load

Options:
  --db <path>      Custom database path
  --force          Skip confirmation prompt
  --backup         Create backup before resetting
  --dry-run        Show what would happen without making changes
  --help           Show this help message

Examples:
  node scripts/reset-chunks.js --dry-run
  node scripts/reset-chunks.js --backup
  node scripts/reset-chunks.js --force --backup
      `);
      return;
    }
  }

  // Use default path if not specified
  if (!dbPath) {
    dbPath = getDefaultDbPath();
  }

  console.log('Chunk Reset Script for Atomic\n');
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
    if (state.chunkCount === 0 && state.vecChunkCount === 0) {
      console.log('\n  No chunks to reset!');
      db.close();
      return;
    }

    // Dry run mode
    if (dryRun) {
      resetChunks(db, true);
      console.log('\nDry run complete - no changes made.');
      db.close();
      return;
    }

    // Confirmation prompt
    if (!force) {
      console.log('\n  WARNING: This will:');
      console.log('    - Delete ALL chat conversations and messages');
      console.log('    - Delete ALL wiki articles and citations');
      console.log('    - Delete ALL chunks and vector embeddings');
      console.log('    - Delete ALL semantic edges and clusters');
      console.log('    - Reset canvas positions');
      console.log('    - Mark all atoms for re-embedding\n');
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

    // Reset chunks
    resetChunks(db, false);

    console.log('\n  Chunk reset complete!\n');
    console.log('Next steps:');
    console.log('  1. Start the Atomic app');
    console.log('  2. Go to Settings and click "Process Pending Embeddings"');
    console.log('  3. Wait for all atoms to be re-embedded with the new chunking strategy\n');

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch(console.error);
