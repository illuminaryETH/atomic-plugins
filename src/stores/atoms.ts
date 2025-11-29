import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Atom {
  id: string;
  content: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  embedding_status: 'pending' | 'processing' | 'complete' | 'failed';
}

export interface Tag {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface AtomWithTags extends Atom {
  tags: Tag[];
}

export interface SemanticSearchResult {
  id: string;
  content: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  embedding_status: 'pending' | 'processing' | 'complete' | 'failed';
  tags: Tag[];
  similarity_score: number;
  matching_chunk_content: string;
  matching_chunk_index: number;
}

export interface SimilarAtomResult {
  id: string;
  content: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  embedding_status: 'pending' | 'processing' | 'complete' | 'failed';
  tags: Tag[];
  similarity_score: number;
  matching_chunk_content: string;
  matching_chunk_index: number;
}

interface AtomsStore {
  atoms: AtomWithTags[];
  isLoading: boolean;
  error: string | null;
  
  // New search state
  semanticSearchQuery: string;
  semanticSearchResults: SemanticSearchResult[] | null;  // null = not searching
  isSearching: boolean;
  
  // Existing methods
  fetchAtoms: () => Promise<void>;
  fetchAtomsByTag: (tagId: string) => Promise<void>;
  createAtom: (content: string, sourceUrl?: string, tagIds?: string[]) => Promise<AtomWithTags>;
  updateAtom: (id: string, content: string, sourceUrl?: string, tagIds?: string[]) => Promise<AtomWithTags>;
  deleteAtom: (id: string) => Promise<void>;
  clearError: () => void;
  
  // New methods
  updateAtomStatus: (atomId: string, status: string) => void;
  addAtom: (atom: AtomWithTags) => void;
  searchSemantic: (query: string) => Promise<void>;
  clearSemanticSearch: () => void;
  setSemanticSearchQuery: (query: string) => void;
  retryEmbedding: (atomId: string) => Promise<void>;
}

export const useAtomsStore = create<AtomsStore>((set) => ({
  atoms: [],
  isLoading: false,
  error: null,
  
  // New search state
  semanticSearchQuery: '',
  semanticSearchResults: null,
  isSearching: false,

  fetchAtoms: async () => {
    set({ isLoading: true, error: null });
    try {
      const atoms = await invoke<AtomWithTags[]>('get_all_atoms');
      set({ atoms, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  fetchAtomsByTag: async (tagId: string) => {
    set({ isLoading: true, error: null });
    try {
      const atoms = await invoke<AtomWithTags[]>('get_atoms_by_tag', { tagId });
      set({ atoms, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  createAtom: async (content: string, sourceUrl?: string, tagIds?: string[]) => {
    set({ error: null });
    try {
      const atom = await invoke<AtomWithTags>('create_atom', {
        content,
        sourceUrl: sourceUrl || null,
        tagIds: tagIds || [],
      });
      set((state) => ({ atoms: [atom, ...state.atoms] }));
      return atom;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAtom: async (id: string, content: string, sourceUrl?: string, tagIds?: string[]) => {
    set({ error: null });
    try {
      const atom = await invoke<AtomWithTags>('update_atom', {
        id,
        content,
        sourceUrl: sourceUrl || null,
        tagIds: tagIds || [],
      });
      set((state) => ({
        atoms: state.atoms.map((a) => (a.id === id ? atom : a)),
      }));
      return atom;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAtom: async (id: string) => {
    set({ error: null });
    try {
      await invoke('delete_atom', { id });
      set((state) => ({
        atoms: state.atoms.filter((a) => a.id !== id),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
  
  // New methods
  updateAtomStatus: (atomId: string, status: string) => {
    set((state) => ({
      atoms: state.atoms.map((a) =>
        a.id === atomId
          ? { ...a, embedding_status: status as Atom['embedding_status'] }
          : a
      ),
    }));
  },

  addAtom: (atom: AtomWithTags) => {
    set((state) => ({
      // Add to beginning of list (most recent first)
      atoms: [atom, ...state.atoms],
    }));
  },
  
  searchSemantic: async (query: string) => {
    set({ isSearching: true, error: null, semanticSearchQuery: query });
    try {
      const results = await invoke<SemanticSearchResult[]>('search_atoms_semantic', {
        query,
        limit: 20,
        threshold: 0.3,
      });
      set({ semanticSearchResults: results, isSearching: false });
    } catch (error) {
      set({ error: String(error), isSearching: false });
    }
  },
  
  clearSemanticSearch: () => {
    set({
      semanticSearchResults: null,
      semanticSearchQuery: '',
    });
  },
  
  setSemanticSearchQuery: (query: string) => {
    set({ semanticSearchQuery: query });
  },
  
  retryEmbedding: async (atomId: string) => {
    set({ error: null });
    try {
      await invoke('retry_embedding', { atomId });
      // Update the atom status to 'pending' optimistically
      set((state) => ({
        atoms: state.atoms.map((a) =>
          a.id === atomId ? { ...a, embedding_status: 'pending' as const } : a
        ),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));

