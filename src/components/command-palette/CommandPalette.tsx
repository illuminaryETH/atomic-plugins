import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCommandPalette } from './useCommandPalette';
import { CommandInput } from './CommandInput';
import { CommandList } from './CommandList';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const {
    query,
    setQuery,
    selectedIndex,
    filteredCommands,
    recentCommands,
    handleKeyDown,
    handleSelect,
  } = useCommandPalette({ isOpen, onClose });

  // Close on click outside
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      data-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm safe-area-padding"
    >
      <div
        className="w-full max-w-xl mx-4 bg-[var(--color-bg-panel)] rounded-xl shadow-2xl border border-[var(--color-border)] animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
      >
        <CommandInput
          query={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          isSearching={false}
          shortcutHint="⌘⇧P"
        />

        <CommandList
          recentCommands={recentCommands}
          filteredCommands={filteredCommands}
          selectedIndex={selectedIndex}
          onSelect={handleSelect}
          hasQuery={!!query.trim()}
          query={query}
        />

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">esc</kbd>
              close
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">⌘P</kbd>
              open search
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
