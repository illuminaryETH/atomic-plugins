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
  content_snippet: string;
  updated_at: string;
  atom_count: number;
  score: number;
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
