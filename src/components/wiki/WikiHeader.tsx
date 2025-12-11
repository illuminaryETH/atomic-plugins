import { useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { formatRelativeTime } from '../../lib/date';

interface WikiHeaderProps {
  tagName: string;
  updatedAt: string;
  sourceCount: number;
  newAtomsAvailable: number;
  onUpdate: () => void;
  onRegenerate: () => void;
  onClose: () => void;
  isUpdating: boolean;
  onBack?: () => void;
}

export function WikiHeader({
  tagName,
  updatedAt,
  sourceCount,
  newAtomsAvailable,
  onUpdate,
  onRegenerate,
  onClose,
  isUpdating,
  onBack,
}: WikiHeaderProps) {
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);

  const handleRegenerate = () => {
    setShowRegenerateModal(false);
    onRegenerate();
  };

  return (
    <div className="border-b border-[var(--color-border)]">
      {/* Main header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Back to list"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] truncate">{tagName}</h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Updated {formatRelativeTime(updatedAt)} • {sourceCount} source{sourceCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowRegenerateModal(true)}
            disabled={isUpdating}
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Regenerate
          </Button>
          <button
            onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* New atoms banner */}
      {newAtomsAvailable > 0 && (
        <div className="flex items-center justify-between px-6 py-2 bg-[var(--color-accent)]/10 border-t border-[var(--color-accent)]/20">
          <span className="text-sm text-[var(--color-accent-light)]">
            {newAtomsAvailable} new atom{newAtomsAvailable !== 1 ? 's' : ''} available
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={onUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <>
                <svg className="w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Updating...
              </>
            ) : (
              'Update Article'
            )}
          </Button>
        </div>
      )}

      {/* Regenerate confirmation modal */}
      <Modal
        isOpen={showRegenerateModal}
        onClose={() => setShowRegenerateModal(false)}
        title="Regenerate Article"
        confirmLabel="Regenerate"
        confirmVariant="primary"
        onConfirm={handleRegenerate}
      >
        <p className="text-[var(--color-text-primary)]">
          This will regenerate the article from scratch, replacing the current content.
          Are you sure you want to continue?
        </p>
      </Modal>
    </div>
  );
}

