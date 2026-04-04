import type Database from "better-sqlite3";
import type { AtomicClient } from "./atomic-client.js";
import { formatAtomBody, generateTitle } from "./templates.js";
import { checkDedup, dedupKey, storeDedup } from "./dedup.js";
import type {
  AppConfig,
  NormalizedMessage,
  PipelineResult,
} from "../types/index.js";

export class Pipeline {
  constructor(
    private client: AtomicClient,
    private db: Database.Database,
    private config: AppConfig,
  ) {}

  /** Process a normalized message through the full pipeline */
  async ingest(msg: NormalizedMessage): Promise<PipelineResult> {
    // 1. Build dedup key
    const key = dedupKey(msg.guild_id, msg.channel_id, msg.id);

    // 2. Check dedup
    const existing = checkDedup(this.db, key);

    // 3. Assemble atom body
    const body = formatAtomBody(msg);

    // 4. Resolve tag names to IDs
    const tagNames = this.buildTags(msg);
    let tagIds: string[];
    try {
      tagIds = await this.client.resolveTagIds(tagNames);
    } catch (err) {
      console.warn("Tag resolution failed, proceeding without tags:", err);
      tagIds = [];
    }

    // 5. Create or update
    if (existing) {
      // Thread growth — update existing atom.
      // Preserve existing tags by fetching current atom's tag IDs and merging.
      try {
        let mergedTagIds = tagIds;
        try {
          const currentAtom = await this.client.getAtom(existing.atom_id);
          const existingTagIds = currentAtom.tags.map((t) => t.id);
          const tagSet = new Set([...existingTagIds, ...tagIds]);
          mergedTagIds = [...tagSet];
        } catch {
          // If we can't fetch the existing atom, use our resolved tags only
        }

        const atom = await this.client.updateAtom(existing.atom_id, {
          content: body,
          source_url: msg.permalink,
          published_at: msg.timestamp.toISOString(),
          tag_ids: mergedTagIds,
        });
        storeDedup(this.db, key, atom.id);
        return { action: "updated", atom_id: atom.id };
      } catch (err) {
        console.error(`Failed to update atom ${existing.atom_id}:`, err);
        return {
          action: "skipped",
          reason: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // New atom
    try {
      const atom = await this.client.createAtom({
        content: body,
        source_url: msg.permalink,
        published_at: msg.timestamp.toISOString(),
        tag_ids: tagIds,
      });
      storeDedup(this.db, key, atom.id);
      console.log(
        `Created atom ${atom.id}: "${generateTitle(msg.content, 50)}"`,
      );
      return { action: "created", atom_id: atom.id };
    } catch (err) {
      console.error("Failed to create atom:", err);
      return {
        action: "skipped",
        reason: `Create failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Build tag name list from message metadata and config */
  private buildTags(msg: NormalizedMessage): string[] {
    const tags: string[] = [];
    const prefix = this.config.tags.custom_prefix;

    // Always add discord prefix tag
    tags.push(prefix);

    // Auto-add channel name as tag
    if (this.config.tags.auto_channel) {
      tags.push(`${prefix}/${msg.channel_name}`);
    }

    // Auto-add guild name as tag
    if (this.config.tags.auto_guild) {
      tags.push(`${prefix}/${msg.guild_name}`);
    }

    // Add forum tags
    if (msg.tags) {
      for (const tag of msg.tags) {
        tags.push(`${prefix}/${tag}`);
      }
    }

    return tags;
  }
}
