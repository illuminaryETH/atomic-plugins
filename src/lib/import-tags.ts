/**
 * Shared tag-resolution helpers for importers (markdown, Apple Notes, etc.).
 *
 * Tags are created lazily under a hierarchy: for a path `[A, B, C]` we create
 * `A`, then `B` under `A`, then `C` under `B`, and return the leaf ID. Results
 * are cached per-session so a single import doesn't re-query for common
 * prefixes.
 */

import { getTransport } from './transport';

export interface HierarchicalTag {
  /** Leaf tag name (the deepest segment). */
  name: string;
  /** Ancestor path, outermost first. Empty for a root tag. */
  parentPath: string[];
}

export type TagCache = Map<string, string>;

export function createTagCache(): TagCache {
  return new Map();
}

export async function getOrCreateTag(
  name: string,
  parentId: string | null,
  cache: TagCache,
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

/**
 * Resolve a list of hierarchical tags plus a list of flat tag names to tag IDs.
 * Used by importers to turn folder paths + frontmatter tags into tag IDs in one pass.
 */
export async function resolveTagIds(
  hierarchical: HierarchicalTag[],
  flat: string[],
  cache: TagCache,
): Promise<string[]> {
  const tagIds: string[] = [];

  for (const ht of hierarchical) {
    let parentId: string | null = null;
    for (const ancestor of ht.parentPath) {
      parentId = await getOrCreateTag(ancestor, parentId, cache);
    }
    const id = await getOrCreateTag(ht.name, parentId, cache);
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  for (const name of flat) {
    const id = await getOrCreateTag(name, null, cache);
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  return tagIds;
}
