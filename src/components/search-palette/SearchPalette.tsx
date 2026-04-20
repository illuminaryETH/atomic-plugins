import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, FileText, Hash, MessageCircle } from 'lucide-react';
import { CommandInput } from '../command-palette/CommandInput';
import { useSearchPalette } from './useSearchPalette';
import {
  GlobalChatSearchResult,
  GlobalTagSearchResult,
  GlobalWikiSearchResult,
  SemanticSearchResult,
} from '../command-palette/types';

interface SearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide flex items-center justify-between">
      <span>{label}</span>
      <span className="normal-case font-normal">{count}</span>
    </div>
  );
}

function PaletteItem({
  selected,
  onClick,
  icon,
  title,
  subtitle,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
        selected
          ? 'bg-[var(--color-bg-hover)] border-l-2 border-[var(--color-accent)]'
          : 'border-l-2 border-transparent hover:bg-[var(--color-bg-hover)]'
      }`}
    >
      <span className="text-[var(--color-text-secondary)] mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{title}</span>
          {meta ? <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">{meta}</span> : null}
        </div>
        {subtitle ? <p className="mt-1 text-xs text-[var(--color-text-secondary)] line-clamp-2">{subtitle}</p> : null}
      </div>
    </button>
  );
}

function atomTitle(result: SemanticSearchResult): string {
  const firstLine = result.content.split('\n')[0].trim().replace(/^#+\s*/, '');
  return firstLine || 'Untitled';
}

export function SearchPalette({ isOpen, onClose, initialQuery = '' }: SearchPaletteProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const {
    query,
    setQuery,
    mode,
    selectedIndex,
    isSearching,
    globalResults,
    tagResults,
    handleKeyDown,
    handleSelect,
  } = useSearchPalette({ isOpen, onClose, initialQuery });

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  let runningIndex = 0;

  const renderAtoms = (results: SemanticSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Atoms" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`atom-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<FileText className="w-4 h-4" strokeWidth={2} />}
            title={atomTitle(result)}
            subtitle={result.matching_chunk_content}
            meta={`${Math.round(result.similarity_score * 100)}%`}
          />
        ))}
      </div>
    );
  };

  const renderWiki = (results: GlobalWikiSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Wiki" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`wiki-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<BookOpen className="w-4 h-4" strokeWidth={2} />}
            title={result.tag_name}
            subtitle={result.content_snippet}
            meta={`${result.atom_count} atoms`}
          />
        ))}
      </div>
    );
  };

  const renderChats = (results: GlobalChatSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Chats" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`chat-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<MessageCircle className="w-4 h-4" strokeWidth={2} />}
            title={result.title || 'Untitled conversation'}
            subtitle={result.matching_message_content}
            meta={`${result.message_count} messages`}
          />
        ))}
      </div>
    );
  };

  const renderTags = (results: GlobalTagSearchResult[]) => {
    if (results.length === 0) return null;
    const start = runningIndex;
    runningIndex += results.length;
    return (
      <div className="mb-2">
        <SectionHeader label="Tags" count={results.length} />
        {results.map((result, idx) => (
          <PaletteItem
            key={`tag-${result.id}`}
            selected={selectedIndex === start + idx}
            onClick={() => handleSelect(start + idx)}
            icon={<Hash className="w-4 h-4" strokeWidth={2} />}
            title={result.name}
            meta={`${result.atom_count} atoms`}
          />
        ))}
      </div>
    );
  };

  const showEmptyState =
    !isSearching &&
    query.trim().length >= 2 &&
    ((mode === 'tags' && tagResults.length === 0) ||
      (mode === 'global' &&
        globalResults.atoms.length === 0 &&
        globalResults.wiki.length === 0 &&
        globalResults.chats.length === 0 &&
        globalResults.tags.length === 0));

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      data-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm safe-area-padding"
    >
      <div className="w-full max-w-2xl mx-4 bg-[var(--color-bg-panel)] rounded-xl shadow-2xl border border-[var(--color-border)] animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        <CommandInput
          query={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          isSearching={isSearching}
          shortcutHint="⌘P"
          placeholder={mode === 'tags' ? 'Search tags...' : 'Search atoms, wiki, chats, and tags...'}
        />

        <div className="overflow-y-auto max-h-[50vh] py-2">
          {!query.trim() ? (
            <div className="px-4 py-8 text-center text-[var(--color-text-tertiary)] text-sm">
              Start typing to search across Atomic. Use `#` for exact-ish tag search.
            </div>
          ) : query.trim().length < 2 && mode === 'global' ? (
            <div className="px-4 py-8 text-center text-[var(--color-text-tertiary)] text-sm">
              Type at least 2 characters to search.
            </div>
          ) : null}

          {mode === 'global' && query.trim().length >= 2 ? (
            <>
              {renderAtoms(globalResults.atoms)}
              {renderWiki(globalResults.wiki)}
              {renderChats(globalResults.chats)}
              {renderTags(globalResults.tags)}
            </>
          ) : null}

          {mode === 'tags' && query.trim().length >= 2 ? renderTags(tagResults) : null}

          {showEmptyState ? (
            <div className="px-4 py-8 text-center text-[var(--color-text-tertiary)] text-sm">
              No matches found for "{mode === 'tags' ? query.slice(1) : query}".
            </div>
          ) : null}
        </div>

        <div className="px-4 py-2 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">esc</kbd>
              close
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[var(--color-bg-hover)] rounded">#</kbd>
              tags only
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
