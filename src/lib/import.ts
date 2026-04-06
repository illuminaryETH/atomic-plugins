/**
 * Client-side markdown folder import.
 *
 * Reads files locally via Tauri FS plugin, parses them, and creates atoms/tags
 * via the transport layer (works with both local and remote servers).
 */

import { readDir, readTextFile, DirEntry } from '@tauri-apps/plugin-fs';
import { getTransport } from './transport';
import type { ImportResult } from './api';

// ---------- Types ----------

interface ParsedNote {
  title: string;
  content: string;
  sourceUrl: string;
  frontmatterTags: string[];
  folderTags: HierarchicalTag[];
  relativePath: string;
}

interface HierarchicalTag {
  name: string;
  parentPath: string[]; // e.g. ["Projects", "Work"] for tag "Tasks" under Projects > Work
}

export interface ImportProgress {
  current: number;
  total: number;
  currentFile: string;
  status: 'importing' | 'skipped' | 'error';
}

// ---------- Constants ----------

const DEFAULT_EXCLUDES = ['.obsidian', '.trash', '.git', 'node_modules'];
const MIN_CONTENT_LENGTH = 10;

// ---------- File discovery ----------

async function discoverMarkdownFiles(
  dirPath: string,
  relativeTo: string,
  excludes: string[],
): Promise<{ absolutePath: string; relativePath: string }[]> {
  const results: { absolutePath: string; relativePath: string }[] = [];
  let entries: DirEntry[];
  try {
    entries = await readDir(dirPath);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const absPath = `${dirPath}/${entry.name}`;
    const relPath = absPath.slice(relativeTo.length + 1);

    if (entry.isDirectory) {
      if (excludes.includes(entry.name)) continue;
      const children = await discoverMarkdownFiles(absPath, relativeTo, excludes);
      results.push(...children);
    } else if (entry.name.endsWith('.md')) {
      results.push({ absolutePath: absPath, relativePath: relPath });
    }
  }

  return results;
}

// ---------- Frontmatter parsing ----------

function parseFrontmatter(content: string): { yaml: Record<string, unknown> | null; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { yaml: null, body: content };

  const body = content.slice(match[0].length);
  const yamlStr = match[1];

  // Simple YAML key-value parser (handles strings, arrays, lists)
  const yaml: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of yamlStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // List item (continuation of a key)
    if (trimmed.startsWith('- ') && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''));
      yaml[currentKey] = currentList;
      continue;
    }

    // Flush previous list
    currentList = null;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    currentKey = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    if (!value) {
      // Value will come as list items
      continue;
    }

    // Inline array: [tag1, tag2]
    if (value.startsWith('[') && value.endsWith(']')) {
      yaml[currentKey] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }

    // Strip quotes
    value = value.replace(/^["']|["']$/g, '');
    yaml[currentKey] = value;
  }

  return { yaml, body };
}

function extractFrontmatterTags(yaml: Record<string, unknown> | null): string[] {
  if (!yaml?.tags) return [];
  const raw = yaml.tags;

  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// ---------- Tag extraction ----------

function extractFolderTags(relativePath: string): HierarchicalTag[] {
  const parts = relativePath.split('/');
  // Remove filename
  parts.pop();
  if (parts.length === 0) return [];

  return parts.map((name, i) => ({
    name,
    parentPath: parts.slice(0, i),
  }));
}

// ---------- Note parsing ----------

function parseNote(
  content: string,
  relativePath: string,
  vaultName: string,
): ParsedNote | null {
  const { yaml, body } = parseFrontmatter(content);

  // Extract title: frontmatter > first h1 > filename
  let title = yaml?.title as string | undefined;
  if (!title) {
    const h1Match = body.match(/^#\s+(.+)$/m);
    title = h1Match?.[1];
  }
  if (!title) {
    const filename = relativePath.split('/').pop() ?? '';
    title = filename.replace(/\.md$/, '');
  }

  // Build content with title prepended if body doesn't start with h1
  let finalContent = body.trimStart();
  if (!finalContent.startsWith('# ')) {
    finalContent = `# ${title}\n\n${finalContent}`;
  }

  if (finalContent.length < MIN_CONTENT_LENGTH) return null;

  // Generate source URL matching the Rust format
  const encodedVault = encodeURIComponent(vaultName);
  const encodedPath = relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const sourceUrl = `obsidian://${encodedVault}/${encodedPath}`;

  return {
    title,
    content: finalContent,
    sourceUrl,
    frontmatterTags: extractFrontmatterTags(yaml),
    folderTags: extractFolderTags(relativePath),
    relativePath,
  };
}

// ---------- Tag resolution ----------

async function getOrCreateTag(
  name: string,
  parentId: string | null,
  cache: Map<string, string>,
): Promise<string> {
  const cacheKey = parentId ? `${parentId}:${name}` : name;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const tag = await getTransport().invoke<{ id: string }>('create_tag', {
    name,
    parentId,
  });
  cache.set(cacheKey, tag.id);
  return tag.id;
}

async function resolveTagIds(
  note: ParsedNote,
  tagCache: Map<string, string>,
): Promise<string[]> {
  const tagIds: string[] = [];

  // Hierarchical folder tags
  for (const ht of note.folderTags) {
    let parentId: string | null = null;
    for (let i = 0; i < ht.parentPath.length; i++) {
      parentId = await getOrCreateTag(ht.parentPath[i], parentId, tagCache);
    }
    const id = await getOrCreateTag(ht.name, parentId, tagCache);
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  // Flat frontmatter tags (root level)
  for (const name of note.frontmatterTags) {
    const id = await getOrCreateTag(name, null, tagCache);
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  return tagIds;
}

// ---------- Main import function ----------

interface BulkCreateResult {
  atoms: unknown[];
  count: number;
  skipped: number;
}

const BATCH_SIZE = 50;

export interface ImportOptions {
  importTags?: boolean;
  onProgress?: (progress: ImportProgress) => void;
}

export async function importMarkdownFolder(
  folderPath: string,
  options?: ImportOptions,
): Promise<ImportResult> {
  const { importTags = true, onProgress } = options ?? {};
  // Derive vault name from folder path
  const vaultName = folderPath.split('/').pop() ?? 'vault';

  // Discover all .md files
  const files = await discoverMarkdownFiles(folderPath, folderPath, DEFAULT_EXCLUDES);
  const total = files.length;

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let tagsLinked = 0;

  const tagCache = new Map<string, string>();

  // Parse all notes and resolve tags upfront
  const prepared: { note: ParsedNote; tagIds: string[] }[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({ current: i + 1, total, currentFile: file.relativePath, status: 'importing' });

    try {
      const content = await readTextFile(file.absolutePath);
      const note = parseNote(content, file.relativePath, vaultName);
      if (!note) {
        skipped++;
        continue;
      }

      let tagIds: string[] = [];
      if (importTags) {
        tagIds = await resolveTagIds(note, tagCache);
        tagsLinked += tagIds.length;
      }

      prepared.push({ note, tagIds });
    } catch (e) {
      errors++;
      console.error(`Import: failed to read ${file.relativePath}:`, e);
    }
  }

  // Send in batches via bulk create — server handles dedup
  for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
    const batch = prepared.slice(i, i + BATCH_SIZE);
    const lastFile = batch[batch.length - 1].note.relativePath;
    onProgress?.({
      current: Math.min(i + BATCH_SIZE, prepared.length),
      total: prepared.length,
      currentFile: lastFile,
      status: 'importing',
    });

    try {
      const result = await getTransport().invoke<BulkCreateResult>('bulk_create_atoms', {
        atoms: batch.map(({ note, tagIds }) => ({
          content: note.content,
          sourceUrl: note.sourceUrl,
          skipIfSourceExists: true,
          tagIds,
        })),
      });
      imported += result.count;
      skipped += result.skipped;
    } catch (e) {
      errors += batch.length;
      console.error(`Import: bulk create failed for batch starting at ${i}:`, e);
    }
  }

  return {
    imported,
    skipped,
    errors,
    tags_created: tagCache.size,
    tags_linked: tagsLinked,
  };
}
