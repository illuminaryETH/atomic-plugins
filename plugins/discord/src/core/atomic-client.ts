import type {
  AtomPayload,
  AtomResponse,
  AtomTag,
  BulkCreateResponse,
  SearchResult,
  TagWithCount,
} from "../types/index.js";

const REQUEST_TIMEOUT_MS = 30_000;

export class AtomicApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Atomic API error: ${status} - ${body}`);
    this.name = "AtomicApiError";
  }
}

export class AtomicClient {
  /** Cache of tag name → tag ID to avoid repeated lookups */
  private tagCache = new Map<string, string>();

  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new AtomicApiError(res.status, text);
    }

    return res.json() as Promise<T>;
  }

  async createAtom(payload: AtomPayload): Promise<AtomResponse> {
    return this.request<AtomResponse>("POST", "/api/atoms", {
      content: payload.content,
      source_url: payload.source_url ?? null,
      published_at: payload.published_at ?? null,
      tag_ids: payload.tag_ids ?? [],
    });
  }

  async updateAtom(
    id: string,
    payload: AtomPayload,
  ): Promise<AtomResponse> {
    return this.request<AtomResponse>("PUT", `/api/atoms/${id}`, {
      content: payload.content,
      source_url: payload.source_url ?? null,
      published_at: payload.published_at ?? null,
      tag_ids: payload.tag_ids ?? [],
    });
  }

  async getAtom(id: string): Promise<AtomResponse> {
    return this.request<AtomResponse>("GET", `/api/atoms/${id}`);
  }

  async deleteAtom(id: string): Promise<void> {
    await this.request<unknown>("DELETE", `/api/atoms/${id}`);
  }

  async createAtomsBulk(
    payloads: AtomPayload[],
  ): Promise<BulkCreateResponse> {
    return this.request<BulkCreateResponse>(
      "POST",
      "/api/atoms/bulk",
      payloads.map((p) => ({
        content: p.content,
        source_url: p.source_url ?? null,
        published_at: p.published_at ?? null,
        tag_ids: p.tag_ids ?? [],
      })),
    );
  }

  async searchAtoms(
    query: string,
    mode: "keyword" | "semantic" | "hybrid" = "semantic",
    limit = 10,
  ): Promise<SearchResult[]> {
    return this.request<SearchResult[]>("POST", "/api/search", {
      query,
      mode,
      limit,
    });
  }

  async getTags(): Promise<TagWithCount[]> {
    return this.request<TagWithCount[]>("GET", "/api/tags");
  }

  async createTag(
    name: string,
    parentId?: string,
  ): Promise<AtomTag> {
    return this.request<AtomTag>("POST", "/api/tags", {
      name,
      parent_id: parentId ?? null,
    });
  }

  /** Resolve a tag name to its ID, creating it if it doesn't exist.
   *  Supports hierarchical names like "discord/engineering" by
   *  resolving each segment in order. */
  async resolveTagId(tagName: string): Promise<string> {
    // Check cache first
    const cached = this.tagCache.get(tagName);
    if (cached) return cached;

    // Fetch all tags and build a lookup
    const allTags = await this.getTags();
    this.populateTagCache(allTags);

    // Check again after refresh
    const found = this.tagCache.get(tagName);
    if (found) return found;

    // Tag doesn't exist — create it, handling hierarchy
    const segments = tagName.split("/");
    let parentId: string | undefined;
    let builtName = "";

    for (const segment of segments) {
      builtName = builtName ? `${builtName}/${segment}` : segment;
      const existingId = this.tagCache.get(builtName);
      if (existingId) {
        parentId = existingId;
        continue;
      }

      const created = await this.createTag(segment, parentId);
      this.tagCache.set(builtName, created.id);
      parentId = created.id;
    }

    return parentId!;
  }

  /** Resolve multiple tag names to IDs */
  async resolveTagIds(tagNames: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of tagNames) {
      try {
        ids.push(await this.resolveTagId(name));
      } catch (err) {
        console.warn(`Failed to resolve tag "${name}":`, err);
      }
    }
    return ids;
  }

  private populateTagCache(
    tags: TagWithCount[],
    prefix = "",
  ): void {
    for (const tag of tags) {
      const fullName = prefix ? `${prefix}/${tag.name}` : tag.name;
      this.tagCache.set(fullName, tag.id);
      if (tag.children?.length > 0) {
        this.populateTagCache(tag.children, fullName);
      }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.request("GET", "/api/atoms?limit=1");
      return true;
    } catch {
      return false;
    }
  }
}
