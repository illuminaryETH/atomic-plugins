import { create } from 'zustand';

export type BatchKind = 'embedding' | 'tagging';

export interface KindCounters {
  pending: number;    // total atoms observed (denominator)
  completed: number;  // atoms finished (numerator)
  phase: string | null;  // latest phase from batch-progress events; null for non-bulk paths
  startedAt: number;
  lastUpdatedAt: number;
}

interface EmbeddingProgressStore {
  embedding: KindCounters | null;
  tagging: KindCounters | null;
  // Flips true the first time we observe any tagging activity in the current
  // session. Until then, atom-created events don't bump tagging.pending
  // (we don't know whether auto-tagging is enabled). On flip we retroactively
  // set tagging.pending to match the atoms seen so far.
  taggingSeen: boolean;
  addPending: (kind: BatchKind, n: number) => void;
  addCompleted: (kind: BatchKind, n: number) => void;
  setPhase: (kind: BatchKind, phase: string) => void;
  markTaggingSeen: () => void;
  clearAll: () => void;
}

function freshCounters(): KindCounters {
  const now = Date.now();
  return { pending: 0, completed: 0, phase: null, startedAt: now, lastUpdatedAt: now };
}

export const useEmbeddingProgressStore = create<EmbeddingProgressStore>()((set) => ({
  embedding: null,
  tagging: null,
  taggingSeen: false,

  addPending: (kind, n) =>
    set((state) => {
      const now = Date.now();
      if (kind === 'embedding') {
        const base = state.embedding ?? freshCounters();
        return {
          embedding: { ...base, pending: base.pending + n, lastUpdatedAt: now },
        };
      }
      // Tagging counters are only created/bumped once we've observed tagging
      // activity in the session. Callers should guard on `taggingSeen` before
      // calling this; we also guard here defensively.
      if (!state.taggingSeen) return {};
      const base = state.tagging ?? freshCounters();
      return {
        tagging: { ...base, pending: base.pending + n, lastUpdatedAt: now },
      };
    }),

  addCompleted: (kind, n) =>
    set((state) => {
      const now = Date.now();
      if (kind === 'embedding') {
        if (!state.embedding) return {};
        return {
          embedding: {
            ...state.embedding,
            completed: Math.min(state.embedding.pending, state.embedding.completed + n),
            lastUpdatedAt: now,
          },
        };
      }
      if (!state.tagging) return {};
      return {
        tagging: {
          ...state.tagging,
          completed: Math.min(state.tagging.pending, state.tagging.completed + n),
          lastUpdatedAt: now,
        },
      };
    }),

  setPhase: (kind, phase) =>
    set((state) => {
      const now = Date.now();
      if (kind === 'embedding') {
        if (!state.embedding) return {};
        return { embedding: { ...state.embedding, phase, lastUpdatedAt: now } };
      }
      if (!state.tagging) return {};
      return { tagging: { ...state.tagging, phase, lastUpdatedAt: now } };
    }),

  // Flip `taggingSeen` on the first observed tagging event and retroactively
  // catch up the tagging denominator to match the atoms already seen via
  // atom-created (tracked on the embedding counter). Subsequent atom-created
  // events will bump both kinds in lockstep.
  markTaggingSeen: () =>
    set((state) => {
      if (state.taggingSeen) return {};
      const now = Date.now();
      const catchUp = state.embedding?.pending ?? 0;
      return {
        taggingSeen: true,
        tagging: {
          ...freshCounters(),
          pending: catchUp,
          startedAt: state.embedding?.startedAt ?? now,
          lastUpdatedAt: now,
        },
      };
    }),

  clearAll: () => set({ embedding: null, tagging: null, taggingSeen: false }),
}));

/// Map a backend phase string onto which pipeline (embedding vs tagging) it belongs to.
/// `complete` is terminal for the whole batch and doesn't uniquely identify a kind.
export function phaseKind(phase: string): BatchKind | null {
  if (phase === 'tagging') return 'tagging';
  if (phase === 'complete') return null;
  // chunking, embedding, storing, finalizing
  return 'embedding';
}
