import { invoke } from '@tauri-apps/api/core';

// Re-export invoke for convenience
export { invoke };

// Type-safe wrapper for checking sqlite-vec
export async function checkSqliteVec(): Promise<string> {
  return invoke<string>('check_sqlite_vec');
}

// Semantic search
export async function searchAtomsSemantic(
  query: string,
  limit: number = 20,
  threshold: number = 0.3
): Promise<any[]> {
  return invoke('search_atoms_semantic', { query, limit, threshold });
}

// Find similar atoms
export async function findSimilarAtoms(
  atomId: string,
  limit: number = 5,
  threshold: number = 0.7
): Promise<any[]> {
  return invoke('find_similar_atoms', { atomId, limit, threshold });
}

// Retry embedding
export async function retryEmbedding(atomId: string): Promise<void> {
  return invoke('retry_embedding', { atomId });
}

// Process pending embeddings
export async function processPendingEmbeddings(): Promise<number> {
  return invoke('process_pending_embeddings');
}

// Get embedding status
export async function getEmbeddingStatus(atomId: string): Promise<string> {
  return invoke('get_embedding_status', { atomId });
}

// Wiki commands
export async function getWikiArticle(tagId: string): Promise<any | null> {
  return invoke('get_wiki_article', { tagId });
}

export async function getWikiArticleStatus(tagId: string): Promise<any> {
  return invoke('get_wiki_article_status', { tagId });
}

export async function generateWikiArticle(tagId: string, tagName: string): Promise<any> {
  return invoke('generate_wiki_article', { tagId, tagName });
}

export async function updateWikiArticle(tagId: string, tagName: string): Promise<any> {
  return invoke('update_wiki_article', { tagId, tagName });
}

export async function deleteWikiArticle(tagId: string): Promise<void> {
  return invoke('delete_wiki_article', { tagId });
}

