import { memo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { DisplayAtom } from '../../stores/atoms';
import { TagChip } from '../tags/TagChip';
import { formatRelativeDate, formatShortRelativeDate } from '../../lib/date';

/** Get display source — prefer pre-parsed `source` field, fall back to extracting from URL */
function getDisplaySource(atom: DisplayAtom): string | null {
  if (atom.source) return atom.source;
  if (atom.source_url) {
    try {
      const hostname = new URL(atom.source_url).hostname;
      return hostname.replace(/^www\./, '');
    } catch {
      return atom.source_url;
    }
  }
  return null;
}

/** Display date matches the default sort order (updated_at desc) */
function getDisplayDate(atom: DisplayAtom): string {
  return atom.updated_at;
}

interface AtomCardProps {
  atom: DisplayAtom;
  onAtomClick: (atomId: string, opts?: { newTab?: boolean }) => void;
  viewMode: 'grid' | 'list';
  matchingChunkContent?: string;  // For search results
  onRetryEmbedding?: (atomId: string) => void;  // For retry action
  onRetryTagging?: (atomId: string) => void;  // For tagging retry action
}

function ProcessingStatusIndicator({
  embeddingStatus,
  taggingStatus,
  onRetry,
  onRetryTagging,
}: {
  embeddingStatus: DisplayAtom['embedding_status'];
  taggingStatus: DisplayAtom['tagging_status'];
  onRetry?: () => void;
  onRetryTagging?: () => void;
}) {
  // Show failed state if embedding failed
  if (embeddingStatus === 'failed') {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRetry?.();
        }}
        className="absolute top-2 right-2 text-red-500 hover:text-red-400 transition-colors"
        title="Embedding failed - click to retry"
      >
        <AlertTriangle className="w-4 h-4" strokeWidth={2} />
      </button>
    );
  }

  // Determine if still processing (either embedding or tagging not complete)
  const isEmbedding = embeddingStatus === 'pending' || embeddingStatus === 'processing';
  const isTagging = taggingStatus === 'pending' || taggingStatus === 'processing';
  const taggingFailed = taggingStatus === 'failed';

  // Both complete (or tagging skipped) - no indicator needed
  if (embeddingStatus === 'complete' && (taggingStatus === 'complete' || taggingStatus === 'skipped')) {
    return null;
  }

  // Show amber indicator for pending/processing states
  if (isEmbedding || isTagging) {
    let title = 'Processing...';
    if (isEmbedding) {
      title = embeddingStatus === 'pending' ? 'Embedding pending' : 'Embedding in progress';
    } else if (isTagging) {
      title = taggingStatus === 'pending' ? 'Tag extraction pending' : 'Tag extraction in progress';
    }

    return (
      <div
        className="absolute top-2 right-2 w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse"
        title={title}
      />
    );
  }

  // Tagging failed (but embedding succeeded) - show retry button
  if (taggingFailed) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRetryTagging?.();
        }}
        className="absolute top-2 right-2 text-orange-500 hover:text-orange-400 transition-colors"
        title="Tag extraction failed - click to retry"
      >
        <RefreshCw className="w-4 h-4" strokeWidth={2} />
      </button>
    );
  }

  return null;
}

export const AtomCard = memo(function AtomCard({
  atom,
  onAtomClick,
  viewMode,
  matchingChunkContent,
  onRetryEmbedding,
  onRetryTagging,
}: AtomCardProps) {
  const handleClick = (e: React.MouseEvent) => {
    onAtomClick(atom.id, { newTab: e.metaKey || e.ctrlKey });
  };
  // Middle-click (button === 1) also opens in a new tab — matches browser
  // tab affordance. Listened on auxclick to capture all middle-click button
  // up events without preventing focus behavior elsewhere.
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onAtomClick(atom.id, { newTab: true });
    }
  };
  const handleRetry = onRetryEmbedding ? () => onRetryEmbedding(atom.id) : undefined;
  const handleRetryTagging = onRetryTagging ? () => onRetryTagging(atom.id) : undefined;

  const { title, snippet } = atom;

  const displaySource = getDisplaySource(atom);
  const hasSource = !!displaySource;
  const maxVisibleTags = viewMode === 'grid' ? (hasSource ? 1 : 2) : 3;
  const visibleTags = atom.tags.slice(0, maxVisibleTags);
  const remainingTags = atom.tags.length - maxVisibleTags;

  if (viewMode === 'list') {
    const hasMetaRow = atom.tags.length > 0 || !!displaySource;
    return (
      <div
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        className="relative flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-hover)] transition-all duration-150"
      >
        <ProcessingStatusIndicator
          embeddingStatus={atom.embedding_status}
          taggingStatus={atom.tagging_status}
          onRetry={handleRetry}
          onRetryTagging={handleRetryTagging}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={`text-sm font-medium truncate min-w-0 ${
                matchingChunkContent ? 'text-[var(--color-accent-light)]' : 'text-[var(--color-text-primary)]'
              }`}
            >
              {title || 'Untitled'}
            </span>
            {snippet && (
              <span className="hidden sm:inline text-xs text-[var(--color-text-tertiary)] truncate">
                {snippet}
              </span>
            )}
          </div>
          {hasMetaRow && (
            <div className="flex items-center gap-1.5 mt-1 min-w-0">
              {atom.tags.length > 0 && (
                <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                  {visibleTags.map((tag) => (
                    <TagChip key={tag.id} name={tag.name} size="sm" />
                  ))}
                  {remainingTags > 0 && (
                    <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">+{remainingTags}</span>
                  )}
                </div>
              )}
              {displaySource && (
                <span
                  className="ml-auto shrink-0 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-bg-panel)] px-1.5 py-0.5 rounded truncate max-w-[100px] sm:max-w-[140px]"
                  title={atom.source_url ?? displaySource}
                >
                  {displaySource}
                </span>
              )}
            </div>
          )}
        </div>
        <span
          className="shrink-0 text-xs text-[var(--color-text-tertiary)] whitespace-nowrap"
          title={formatRelativeDate(getDisplayDate(atom))}
        >
          {formatShortRelativeDate(getDisplayDate(atom))}
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      className="relative flex flex-col p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-hover)] transition-all duration-150 h-full min-w-0 overflow-hidden break-words"
    >
      <ProcessingStatusIndicator
        embeddingStatus={atom.embedding_status}
        taggingStatus={atom.tagging_status}
        onRetry={handleRetry}
        onRetryTagging={handleRetryTagging}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={`text-sm font-medium line-clamp-1 min-w-0 ${
              matchingChunkContent ? 'text-[var(--color-accent-light)]' : 'text-[var(--color-text-primary)]'
            }`}
          >
            {title || 'Untitled'}
          </p>
          <span className="text-xs text-[var(--color-text-tertiary)] shrink-0" title={formatRelativeDate(getDisplayDate(atom))}>
            {formatShortRelativeDate(getDisplayDate(atom))}
          </span>
        </div>
        {snippet && (
          <p className="text-sm text-[var(--color-text-secondary)] mt-1 leading-relaxed line-clamp-4">
            {snippet}
          </p>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-1.5">
          {visibleTags.map((tag) => (
            <TagChip key={tag.id} name={tag.name} size="sm" />
          ))}
          {remainingTags > 0 && (
            <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">+{remainingTags}</span>
          )}
          {displaySource && (
            <span className="ml-auto text-xs text-[var(--color-text-tertiary)] bg-[var(--color-bg-panel)] px-1.5 py-0.5 rounded truncate max-w-[120px] shrink-0" title={atom.source_url ?? displaySource}>
              {displaySource}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.atom.id === next.atom.id
    && prev.atom.updated_at === next.atom.updated_at
    && prev.atom.embedding_status === next.atom.embedding_status
    && prev.atom.tagging_status === next.atom.tagging_status
    && prev.atom.tags.length === next.atom.tags.length
    && prev.atom.source === next.atom.source
    && prev.viewMode === next.viewMode
    && prev.matchingChunkContent === next.matchingChunkContent;
});
