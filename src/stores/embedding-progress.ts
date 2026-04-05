import { create } from 'zustand';

interface BatchState {
  batchId: string;
  phase: string;
  completed: number;
  total: number;
  startedAt: number;
}

interface EmbeddingProgressStore {
  activeBatch: BatchState | null;
  updateBatch: (batchId: string, phase: string, completed: number, total: number) => void;
  clearBatch: (batchId: string) => void;
}

export const useEmbeddingProgressStore = create<EmbeddingProgressStore>()((set) => ({
  activeBatch: null,

  updateBatch: (batchId, phase, completed, total) =>
    set((state) => {
      const startedAt = state.activeBatch?.batchId === batchId
        ? state.activeBatch.startedAt
        : Date.now();
      return {
        activeBatch: { batchId, phase, completed, total, startedAt },
      };
    }),

  clearBatch: (batchId) =>
    set((state) => {
      if (state.activeBatch?.batchId === batchId) {
        return { activeBatch: null };
      }
      return state;
    }),
}));
