interface WikiEmptyStateProps {
  tagName: string;
  atomCount: number;
  onGenerate: () => void;
  isGenerating: boolean;
}

export function WikiEmptyState({ tagName, atomCount, onGenerate, isGenerating }: WikiEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
      {/* Document icon with plus */}
      <div className="w-16 h-16 mb-4 rounded-full bg-[var(--color-bg-card)] flex items-center justify-center">
        <svg className="w-8 h-8 text-[var(--color-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
      
      <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
        No article yet for "{tagName}"
      </h3>
      
      <p className="text-sm text-[var(--color-text-secondary)] mb-6">
        Generate an article from {atomCount} atom{atomCount !== 1 ? 's' : ''}
      </p>
      
      <button
        onClick={onGenerate}
        disabled={isGenerating || atomCount === 0}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isGenerating ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Generating...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Article
          </>
        )}
      </button>
      
      {atomCount === 0 && (
        <p className="text-xs text-[var(--color-text-tertiary)] mt-4">
          Add some atoms with this tag first
        </p>
      )}
    </div>
  );
}

