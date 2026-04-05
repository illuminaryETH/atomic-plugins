import {
  useEmbeddingProgressStore,
  type BatchKind,
  type KindCounters,
} from '../../stores/embedding-progress';

const EMBEDDING_PHASE_LABELS: Record<string, string> = {
  chunking: 'Preparing atoms...',
  embedding: 'Generating embeddings...',
  storing: 'Storing embeddings...',
  finalizing: 'Computing connections...',
};

const TAGGING_PHASE_LABELS: Record<string, string> = {
  tagging: 'Extracting tags...',
};

const DEFAULT_LABELS: Record<BatchKind, string> = {
  embedding: 'Generating embeddings...',
  tagging: 'Extracting tags...',
};

const DONE_LABELS: Record<BatchKind, string> = {
  embedding: 'Embeddings complete',
  tagging: 'Tagging complete',
};

// Show the overlay only once more than one atom is in flight — avoids a flash
// when the user creates a single atom manually.
const MIN_PENDING_TO_SHOW = 2;

function formatEta(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `~${seconds}s left`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes}m left`;
}

function labelFor(kind: BatchKind, counters: KindCounters): string {
  const done = counters.completed >= counters.pending;
  if (done) return DONE_LABELS[kind];
  if (counters.phase) {
    const map = kind === 'tagging' ? TAGGING_PHASE_LABELS : EMBEDDING_PHASE_LABELS;
    return map[counters.phase] ?? DEFAULT_LABELS[kind];
  }
  return DEFAULT_LABELS[kind];
}

function ProgressRow({ kind, counters }: { kind: BatchKind; counters: KindCounters }) {
  const { pending, completed, startedAt } = counters;
  const percent = pending > 0 ? Math.round((completed / pending) * 100) : 0;
  const allComplete = completed >= pending;
  const label = labelFor(kind, counters);

  let eta: string | null = null;
  if (completed > 0 && percent >= 5 && !allComplete) {
    const elapsed = Date.now() - startedAt;
    const rate = elapsed / completed;
    const remaining = rate * (pending - completed);
    eta = formatEta(remaining);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="text-xs text-[var(--color-text-primary)] truncate">{label}</span>
        <span className="text-xs font-medium text-[var(--color-text-primary)] shrink-0">{percent}%</span>
      </div>
      <div className="w-full h-1 bg-[var(--color-bg-hover)] rounded-full overflow-hidden mb-1">
        <div
          className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-secondary)]">
        <span>{completed.toLocaleString()} / {pending.toLocaleString()}</span>
        {eta && <span>{eta}</span>}
      </div>
    </div>
  );
}

export function EmbeddingProgressBanner() {
  const embedding = useEmbeddingProgressStore(s => s.embedding);
  const tagging = useEmbeddingProgressStore(s => s.tagging);

  const showEmbedding = embedding && embedding.pending >= MIN_PENDING_TO_SHOW;
  const showTagging = tagging && tagging.pending >= MIN_PENDING_TO_SHOW;

  if (!showEmbedding && !showTagging) return null;

  return (
    <div className="absolute bottom-4 left-4 z-20 w-72 px-3 py-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg shadow-lg pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200 space-y-2.5">
      {showEmbedding && <ProgressRow kind="embedding" counters={embedding!} />}
      {showTagging && <ProgressRow kind="tagging" counters={tagging!} />}
    </div>
  );
}
