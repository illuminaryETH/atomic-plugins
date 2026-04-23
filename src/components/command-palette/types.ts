import { ComponentType, SVGProps } from 'react';

export type CommandCategory = 'navigation' | 'atoms' | 'tags' | 'wiki' | 'utility';

export type PaletteMode = 'commands' | 'search' | 'tags';

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  keywords: string[];          // Additional search terms for fuzzy matching
  shortcut?: string;           // Display hint (e.g., "⌘N")
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  action: () => void | Promise<void>;
  isEnabled?: () => boolean;   // Conditional availability
}

export interface CommandGroup {
  category: CommandCategory;
  label: string;
  commands: Command[];
}

export interface FuzzyMatch {
  command: Command;
  score: number;
  matches: number[];  // Indices of matched characters in label
}

export interface MatchOffset {
  /** Byte offset in the atom's content where the match starts. */
  start: number;
  /** Exclusive byte offset in the atom's content where the match ends. */
  end: number;
}

export interface SemanticSearchResult {
  id: string;
  content: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  embedding_status: string;
  tagging_status: string;
  tags: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    created_at: string;
  }>;
  similarity_score: number;
  matching_chunk_content: string;
  matching_chunk_index: number;
  /**
   * Byte offsets of every match in the atom's content, in document order.
   * Present for keyword search only. The reader uses this for the match
   * count and for cycle-through navigation of the matches.
   */
  match_offsets?: MatchOffset[];
  /**
   * Total number of matches. May exceed `match_offsets.length` when the offset
   * list was capped by the backend — always prefer this over the array length
   * when displaying counts.
   */
  match_count?: number;
  /**
   * FTS-windowed excerpt around matched terms with the PUA markers in
   * `markdownToPlainText` wrapping each hit. Present for keyword search only;
   * absent for semantic/hybrid results. The backend names this `match_snippet`
   * (not `snippet`) so it doesn't collide with `Atom.snippet` — the atom's
   * stored preview, which the server flattens into the same JSON object.
   */
  match_snippet?: string;
}

export interface TagWithCount {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  atom_count: number;
  children?: TagWithCount[];
}

export interface GlobalWikiSearchResult {
  id: string;
  tag_id: string;
  tag_name: string;
  /** Full article body — sent so the palette can build per-match windows. */
  content: string;
  content_snippet: string;
  updated_at: string;
  atom_count: number;
  score: number;
  /** FTS5 windowed excerpt with PUA markers around each matched token. */
  match_snippet?: string;
  /** Byte offsets of every match in the article's content, in document order. */
  match_offsets?: MatchOffset[];
  /** Total match count — may exceed `match_offsets.length` when capped. */
  match_count?: number;
}

export interface GlobalChatSearchResult {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
  tags: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    created_at: string;
  }>;
  matching_message_content: string;
  score: number;
}

export interface GlobalTagSearchResult {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  atom_count: number;
  score: number;
}

export interface GlobalSearchResponse {
  atoms: SemanticSearchResult[];
  wiki: GlobalWikiSearchResult[];
  chats: GlobalChatSearchResult[];
  tags: GlobalTagSearchResult[];
}
