import { useEmbeddingProgressStore } from '../../stores/embedding-progress';

const PHASE_LABELS: Record<string, string> = {
  chunking: 'Preparing atoms...',
  embedding: 'Generating embeddings...',
  storing: 'Storing embeddings...',
  tagging: 'Extracting tags...',
  finalizing: 'Computing connections...',
  complete: 'Complete!',
};

function formatEta(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `~${seconds}s left`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes}m left`;
}

export function EmbeddingProgressBanner() {
  const activeBatch = useEmbeddingProgressStore(s => s.activeBatch);

  if (!activeBatch) return null;

  const { phase, completed, total, startedAt } = activeBatch;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const label = PHASE_LABELS[phase] || phase;

  // ETA: only show after 5% progress to avoid wild early estimates
  let eta: string | null = null;
  if (completed > 0 && percent >= 5 && phase !== 'complete') {
    const elapsed = Date.now() - startedAt;
    const rate = elapsed / completed;
    const remaining = rate * (total - completed);
    eta = formatEta(remaining);
  }

  return (
    <div className="px-4 py-2.5 bg-[var(--color-bg-card)] border-b border-[var(--color-border)] flex-shrink-0 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {completed.toLocaleString()} / {total.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-[var(--color-text-primary)]">{percent}%</span>
          {eta && (
            <span className="text-xs text-[var(--color-text-secondary)]">{eta}</span>
          )}
        </div>
      </div>
      <div className="w-full h-1.5 bg-[var(--color-bg-hover)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
