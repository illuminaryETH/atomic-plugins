import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

// Types matching the Rust structs
export interface WikiArticle {
  id: string;
  tag_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  atom_count: number;
}

export interface WikiCitation {
  id: string;
  citation_index: number;
  atom_id: string;
  chunk_index: number | null;
  excerpt: string;
}

export interface WikiArticleWithCitations {
  article: WikiArticle;
  citations: WikiCitation[];
}

export interface WikiArticleStatus {
  has_article: boolean;
  article_atom_count: number;
  current_atom_count: number;
  new_atoms_available: number;
  updated_at: string | null;
}

interface WikiStore {
  // Current article state
  currentArticle: WikiArticleWithCitations | null;
  articleStatus: WikiArticleStatus | null;
  
  // Loading states
  isLoading: boolean;
  isGenerating: boolean;
  isUpdating: boolean;
  error: string | null;
  
  // Actions
  fetchArticle: (tagId: string) => Promise<void>;
  fetchArticleStatus: (tagId: string) => Promise<void>;
  generateArticle: (tagId: string, tagName: string) => Promise<void>;
  updateArticle: (tagId: string, tagName: string) => Promise<void>;
  deleteArticle: (tagId: string) => Promise<void>;
  clearArticle: () => void;
  clearError: () => void;
}

export const useWikiStore = create<WikiStore>((set, get) => ({
  currentArticle: null,
  articleStatus: null,
  isLoading: false,
  isGenerating: false,
  isUpdating: false,
  error: null,

  fetchArticle: async (tagId: string) => {
    set({ isLoading: true, error: null });
    try {
      const article = await invoke<WikiArticleWithCitations | null>('get_wiki_article', { tagId });
      set({ currentArticle: article, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  fetchArticleStatus: async (tagId: string) => {
    try {
      const status = await invoke<WikiArticleStatus>('get_wiki_article_status', { tagId });
      set({ articleStatus: status });
    } catch (error) {
      console.error('Failed to fetch article status:', error);
    }
  },

  generateArticle: async (tagId: string, tagName: string) => {
    set({ isGenerating: true, error: null });
    try {
      const article = await invoke<WikiArticleWithCitations>('generate_wiki_article', { tagId, tagName });
      set({ currentArticle: article, isGenerating: false });
      // Refresh status after generation
      get().fetchArticleStatus(tagId);
    } catch (error) {
      set({ error: String(error), isGenerating: false });
    }
  },

  updateArticle: async (tagId: string, tagName: string) => {
    set({ isUpdating: true, error: null });
    try {
      const article = await invoke<WikiArticleWithCitations>('update_wiki_article', { tagId, tagName });
      set({ currentArticle: article, isUpdating: false });
      // Refresh status after update
      get().fetchArticleStatus(tagId);
    } catch (error) {
      set({ error: String(error), isUpdating: false });
    }
  },

  deleteArticle: async (tagId: string) => {
    try {
      await invoke('delete_wiki_article', { tagId });
      set({ currentArticle: null, articleStatus: null });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  clearArticle: () => {
    set({ currentArticle: null, articleStatus: null, error: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));

