import { AtomWithTags } from '../../stores/atoms';
import { AtomCard } from './AtomCard';

interface AtomListProps {
  atoms: AtomWithTags[];
  onAtomClick: (atomId: string) => void;
  getMatchingChunkContent?: (atomId: string) => string | undefined;
  onRetryEmbedding?: (atomId: string) => void;
}

export function AtomList({
  atoms,
  onAtomClick,
  getMatchingChunkContent,
  onRetryEmbedding,
}: AtomListProps) {
  if (atoms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <svg
          className="w-16 h-16 text-[var(--color-border)] mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">No atoms yet</h3>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
          Click the + button to create your first atom and start building your knowledge base.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {atoms.map((atom) => (
        <AtomCard
          key={atom.id}
          atom={atom}
          onClick={() => onAtomClick(atom.id)}
          viewMode="list"
          matchingChunkContent={getMatchingChunkContent?.(atom.id)}
          onRetryEmbedding={onRetryEmbedding ? () => onRetryEmbedding(atom.id) : undefined}
        />
      ))}
    </div>
  );
}

