import { useState, useEffect, useLayoutEffect, useCallback, ReactNode, useRef, useMemo, memo } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { openExternalUrl } from '../../lib/platform';
import { Modal } from '../ui/Modal';
import { SearchBar } from '../ui/SearchBar';
import { Input } from '../ui/Input';
import { MarkdownImage } from '../ui/MarkdownImage';
import { TagChip } from '../tags/TagChip';
import { TagSelector } from '../tags/TagSelector';
import { MiniGraphPreview } from '../canvas/MiniGraphPreview';
import { useAtomsStore, type AtomWithTags, type SimilarAtomResult } from '../../stores/atoms';
import { useTagsStore } from '../../stores/tags';
import { useUIStore } from '../../stores/ui';
import { useContentSearch, useInlineEditor } from '../../hooks';
import { formatDate } from '../../lib/date';
import { chunkMarkdown, findChunkIndexForOffset } from '../../lib/markdown';
import { getTransport } from '../../lib/transport';
import { getEditorExtensions } from '../../lib/codemirror-config';
import { readerEditorActions } from '../../lib/reader-editor-bridge';

// Progressive rendering configuration
const CHUNK_SIZE = 8000;
const INITIAL_CHUNKS = 1;
const CHUNKS_PER_BATCH = 2;
const CHUNK_DELAY = 32;

const remarkPluginsStable = [remarkGfm];

const MemoizedMarkdownChunk = memo(function MarkdownChunk({
  content,
  components,
}: {
  content: string;
  components: any;
}) {
  return (
    <ReactMarkdown remarkPlugins={remarkPluginsStable} components={components}>
      {content}
    </ReactMarkdown>
  );
});

interface AtomReaderProps {
  atomId: string;
  highlightText?: string | null;
  initialEditing?: boolean;
}

export function AtomReader({ atomId, highlightText, initialEditing }: AtomReaderProps) {
  const deleteAtom = useAtomsStore(s => s.deleteAtom);
  const fetchTags = useTagsStore(s => s.fetchTags);
  const setSelectedTag = useUIStore(s => s.setSelectedTag);
  const overlayNavigate = useUIStore(s => s.overlayNavigate);
  const overlayDismiss = useUIStore(s => s.overlayDismiss);

  const [atom, setAtom] = useState<AtomWithTags | null>(null);
  const [isLoadingAtom, setIsLoadingAtom] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const lastFetchedAt = useRef<string | null>(null);

  const refreshAtom = useCallback(async () => {
    const fetchedAtom = await getTransport().invoke<AtomWithTags | null>('get_atom_by_id', { id: atomId });
    setAtom(fetchedAtom);
    lastFetchedAt.current = fetchedAtom?.updated_at ?? null;
  }, [atomId]);


  // Watch the atoms store for updates to the currently viewed atom
  const storeAtom = useAtomsStore((s) =>
    s.atoms.find((a) => a.id === atomId)
  );

  // Fetch atom from database
  useEffect(() => {
    setIsLoadingAtom(true);
    setShowLoading(false);

    // Only show loading indicator if fetch takes longer than 200ms
    const loadingTimer = setTimeout(() => setShowLoading(true), 200);

    refreshAtom()
      .then(() => {
        clearTimeout(loadingTimer);
        setIsLoadingAtom(false);
      })
      .catch((error) => {
        clearTimeout(loadingTimer);
        console.error('Failed to fetch atom:', error);
        setAtom(null);
        setIsLoadingAtom(false);
        // atom loaded
      });

    return () => clearTimeout(loadingTimer);
  }, [atomId, refreshAtom]);

  // Re-fetch when store summary changes (e.g., after tag extraction)
  const storeAtomUpdatedAt = storeAtom?.updated_at;
  useEffect(() => {
    if (storeAtomUpdatedAt && !isLoadingAtom && storeAtomUpdatedAt !== lastFetchedAt.current) {
      lastFetchedAt.current = storeAtomUpdatedAt;
      refreshAtom().catch(console.error);
    }
  }, [storeAtomUpdatedAt, isLoadingAtom, refreshAtom]);

  // Refresh the open reader immediately when tagging completes for this atom.
  // The list store gets its status update from the global event hook, but the
  // reader owns full atom details and needs its own refresh to pick up new tags.
  useEffect(() => {
    const transport = getTransport();
    return transport.subscribe<{ atom_id: string }>('tagging-complete', (payload) => {
      if (payload.atom_id !== atomId) return;
      refreshAtom().catch(console.error);
    });
  }, [atomId, refreshAtom]);

  return (
    <div className="h-full bg-[var(--color-bg-main)]">
      {isLoadingAtom ? (
        showLoading ? (
          <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
            Loading...
          </div>
        ) : null
      ) : !atom ? (
        <div className="flex items-center justify-center h-full text-[var(--color-text-secondary)]">
          Atom not found
        </div>
      ) : (
        <AtomReaderContent
          atom={atom}
          highlightText={highlightText}
          initialEditing={initialEditing}
          onDismiss={overlayDismiss}
          onDelete={async () => {
            await deleteAtom(atomId);
            await fetchTags();
            overlayDismiss();
          }}
          onTagClick={(tagId) => { setSelectedTag(tagId); overlayDismiss(); }}
          onRelatedAtomClick={(id) => overlayNavigate({ type: 'reader', atomId: id })}
          onViewGraph={() => overlayNavigate({ type: 'graph', atomId })}
          onAtomUpdated={(updated) => setAtom(updated)}
        />
      )}
    </div>
  );
}

interface AtomReaderContentProps {
  atom: AtomWithTags;
  highlightText?: string | null;
  initialEditing?: boolean;
  onDismiss: () => void;
  onDelete: () => Promise<void>;
  onTagClick: (tagId: string) => void;
  onRelatedAtomClick: (atomId: string) => void;
  onViewGraph: () => void;
  onAtomUpdated?: (atom: AtomWithTags) => void;
}

function AtomReaderContent({
  atom, highlightText, initialEditing,
  onDismiss, onDelete, onTagClick, onRelatedAtomClick, onViewGraph, onAtomUpdated,
}: AtomReaderContentProps) {
  const readerTheme = useUIStore(s => s.readerTheme);
  const retryTagging = useAtomsStore(s => s.retryTagging);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);

  // Inline editor
  const {
    isEditing, isTransitioning, editContent, editSourceUrl, editTags, saveStatus, cursorOffset,
    startEditing, stopEditing, setEditContent, setEditSourceUrl, setEditTags, saveNow,
  } = useInlineEditor({ atom, onAtomUpdated });

  const setReaderEditState = useUIStore(s => s.setReaderEditState);
  const isTaggingInFlight = atom.tagging_status === 'pending' || atom.tagging_status === 'processing';

  const handleAutoTag = useCallback(async () => {
    await retryTagging(atom.id);
    onAtomUpdated?.({ ...atom, tagging_status: 'pending' });
  }, [retryTagging, atom, onAtomUpdated]);

  // Sync editing state to UI store so MainView titlebar can read it
  useEffect(() => {
    setReaderEditState(isEditing, saveStatus);
  }, [isEditing, saveStatus, setReaderEditState]);

  // Preserve content position (not raw scrollTop) across the view↔edit
  // flip. View and edit have different total heights so pixel preservation
  // mis-aligns; instead, capture the topmost visible block (image by src or
  // text block by prefix) and its y-offset, then after the toggle scroll so
  // the same block ends up at the same y-offset in the new mode.
  interface TogglePosition {
    scrollTop: number;
    targetText: string | null;
    targetImageSrc: string | null;
    targetOffsetY: number;
  }
  const pendingPositionRef = useRef<TogglePosition | null>(null);

  const normalizeForMatch = useCallback((s: string): string => {
    return s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[\\*_`#~]/g, '')
      // Strip leading list marker: "- ", "* ", "+ ", "1. " — edit mode shows
      // these as raw text, view mode renders them as <li> bullets so they
      // never appear in the text content. Without stripping, the signature
      // "- 878 — Jean-Baptiste Mardelle" wouldn't match view's "878 —
      // Jean-Baptiste Mardelle" and content-position preserve falls back to
      // raw scrollTop preservation (which drifts ~400px in list-heavy areas).
      .replace(/^(?:[-*+]|\d+\.)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const contentRoot = useCallback((): Element | null => {
    if (isEditing) return editorRef.current?.view?.contentDOM ?? null;
    return articleRef.current;
  }, [isEditing]);

  const capturePosition = useCallback((): TogglePosition => {
    const container = scrollContainerRef.current;
    const root = contentRoot();
    const scrollTop = container?.scrollTop ?? 0;
    const empty = { scrollTop, targetText: null, targetImageSrc: null, targetOffsetY: 0 };
    if (!container || !root) return empty;
    const containerRect = container.getBoundingClientRect();
    for (const child of Array.from(root.children)) {
      const rect = child.getBoundingClientRect();
      if (rect.bottom <= containerRect.top + 4) continue;
      if (rect.top >= containerRect.bottom) break;
      // Image blocks — use the <img>'s own rect (view wraps it in a span
      // with a 2em top-margin; the visible image starts below that). In
      // edit mode CM inserts `<img class="cm-widgetBuffer">` elements
      // around widgets, so we must select the real image explicitly.
      const img =
        child.tagName === 'IMG' && (child as HTMLElement).className === 'cm-md-img'
          ? (child as HTMLImageElement)
          : (child.querySelector?.('img.cm-md-img, .markdown-image-wrapper img') as HTMLImageElement | null);
      if (img?.src) {
        const imgRect = img.getBoundingClientRect();
        return {
          scrollTop,
          targetText: null,
          targetImageSrc: img.src,
          targetOffsetY: imgRect.top - containerRect.top,
        };
      }
      const normalized = normalizeForMatch(child.textContent ?? '');
      if (normalized.length < 8) continue;
      return {
        scrollTop,
        targetText: normalized.slice(0, 60),
        targetImageSrc: null,
        targetOffsetY: rect.top - containerRect.top,
      };
    }
    return empty;
  }, [contentRoot, normalizeForMatch]);

  const scrollElementToOffset = useCallback((el: Element, offsetY: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const rect = (el as HTMLElement).getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    container.scrollTop += rect.top - containerRect.top - offsetY;
  }, []);

  const findTargetElement = useCallback(
    (pending: TogglePosition, nudgeCm = false): HTMLElement | null => {
      if (isEditing) {
        const view = editorRef.current?.view;
        if (!view) return null;
        if (pending.targetImageSrc) {
          const hit = Array.from(view.contentDOM.querySelectorAll('img.cm-md-img')).find(
            (i) => (i as HTMLImageElement).src === pending.targetImageSrc
          ) as HTMLElement | undefined;
          if (hit) return hit;
          if (nudgeCm) {
            const source = view.state.doc.toString();
            const escaped = pending.targetImageSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)?`).exec(source);
            if (match) {
              view.dispatch({ effects: EditorView.scrollIntoView(match.index, { y: 'nearest' }) });
            }
          }
          return null;
        }
        if (pending.targetText) {
          for (const child of Array.from(view.contentDOM.children)) {
            const normalized = normalizeForMatch(child.textContent ?? '');
            if (
              normalized.length >= 8 &&
              normalized.startsWith(pending.targetText.slice(0, Math.min(40, normalized.length)))
            ) {
              return child as HTMLElement;
            }
          }
          if (nudgeCm) {
            const source = view.state.doc.toString();
            const words = pending.targetText.split(' ').filter((w) => w.length > 0);
            for (let start = 0; start + 4 <= words.length; start++) {
              const phrase = words.slice(start, start + 4).join(' ');
              if (phrase.length < 15) continue;
              const idx = source.indexOf(phrase);
              if (idx >= 0) {
                view.dispatch({ effects: EditorView.scrollIntoView(idx, { y: 'nearest' }) });
                break;
              }
            }
          }
          return null;
        }
        return null;
      }
      const root = articleRef.current;
      if (!root) return null;
      if (pending.targetImageSrc) {
        const hit = Array.from(root.querySelectorAll('img')).find(
          (i) => (i as HTMLImageElement).src === pending.targetImageSrc
        ) as HTMLImageElement | undefined;
        return (hit ?? null) as HTMLElement | null;
      }
      if (pending.targetText) {
        // Walk all block-level candidates including list items, not just
        // direct article children — otherwise targeting "Jean-Baptiste
        // Mardelle" would find `<ul>` (whose textContent begins with "878 —"
        // from the first item) and scroll that instead.
        const candidates = Array.from(
          root.querySelectorAll(
            'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figure'
          )
        );
        const prefix = pending.targetText.slice(0, 40);
        let bestMatch: HTMLElement | null = null;
        let bestScore = 0;
        for (const el of candidates) {
          const text = normalizeForMatch(el.textContent ?? '');
          if (text.length < 8) continue;
          if (!text.startsWith(prefix.slice(0, Math.min(40, text.length)))) continue;
          const score = prefix.length / Math.max(1, text.length);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = el as HTMLElement;
          }
        }
        if (bestMatch) return bestMatch;
      }
      return null;
    },
    [isEditing, normalizeForMatch]
  );

  const restoreByPosition = useCallback(
    (pending: TogglePosition, nudgeCm: boolean): boolean => {
      if (!scrollContainerRef.current) return false;
      const target = findTargetElement(pending, nudgeCm);
      if (!target) return false;
      scrollElementToOffset(target, pending.targetOffsetY);
      return true;
    },
    [findTargetElement, scrollElementToOffset]
  );

  useEffect(() => {
    readerEditorActions.current = {
      startEditing: (offset?: number) => {
        pendingPositionRef.current = capturePosition();
        startEditing(offset);
      },
      stopEditing: async () => {
        pendingPositionRef.current = capturePosition();
        await stopEditing();
      },
      undo: () => { const v = editorRef.current?.view; if (v) undo(v); },
      redo: () => { const v = editorRef.current?.view; if (v) redo(v); },
    };
    return () => { readerEditorActions.current = null; };
  }, [startEditing, stopEditing, capturePosition]);

  useLayoutEffect(() => {
    const pending = pendingPositionRef.current;
    if (!pending) return;
    pendingPositionRef.current = null;
    const el = scrollContainerRef.current;
    if (!el) return;
    let frame = 0;
    const tryRestore = () => {
      const restored = restoreByPosition(pending, frame === 0);
      if (!restored && frame === 0) el.scrollTop = pending.scrollTop;
      if (frame++ < 5) requestAnimationFrame(tryRestore);
    };
    requestAnimationFrame(tryRestore);
  }, [isEditing, restoreByPosition]);

  // Start in editing mode if requested
  useEffect(() => {
    if (initialEditing) startEditing();
  }, [initialEditing, startEditing]);

  // Fade-in on mount
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Initial highlight state
  const [initialHighlight, setInitialHighlight] = useState<string | null>(null);
  const [targetChunkIndex, setTargetChunkIndex] = useState<number | null>(null);

  // Progressive rendering
  const chunks = useMemo(() => chunkMarkdown(atom.content, CHUNK_SIZE), [atom.content]);
  const [renderedChunkCount, setRenderedChunkCount] = useState(INITIAL_CHUNKS);
  const isFullyRendered = renderedChunkCount >= chunks.length;

  useEffect(() => {
    if (isFullyRendered) return;
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => {
        setRenderedChunkCount(prev => Math.min(prev + CHUNKS_PER_BATCH, chunks.length));
      }, { timeout: 100 });
      return () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(() => {
        setRenderedChunkCount(prev => Math.min(prev + CHUNKS_PER_BATCH, chunks.length));
      }, CHUNK_DELAY);
      return () => clearTimeout(id);
    }
  }, [renderedChunkCount, chunks.length, isFullyRendered]);

  useEffect(() => { setRenderedChunkCount(INITIAL_CHUNKS); }, [atom.id]);

  // Calculate target chunk from highlightText
  useEffect(() => {
    if (highlightText && atom.content) {
      const offset = atom.content.indexOf(highlightText);
      if (offset !== -1) {
        const chunkIndex = findChunkIndexForOffset(atom.content, offset, CHUNK_SIZE);
        setTargetChunkIndex(chunkIndex);
        setInitialHighlight(highlightText.slice(0, 50).trim());
      }
    } else {
      setInitialHighlight(null);
      setTargetChunkIndex(null);
    }
  }, [highlightText, atom.content]);

  // Scroll to highlight
  useEffect(() => {
    if (targetChunkIndex === null || initialHighlight === null) return;
    if (targetChunkIndex >= renderedChunkCount) {
      setRenderedChunkCount(targetChunkIndex + 1);
      return;
    }
    const scrollTimeout = setTimeout(() => {
      const mark = document.querySelector('[data-initial-highlight]');
      if (mark && scrollContainerRef.current) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    const clearTimer = setTimeout(() => {
      setInitialHighlight(null);
      setTargetChunkIndex(null);
    }, 5000);
    return () => { clearTimeout(scrollTimeout); clearTimeout(clearTimer); };
  }, [targetChunkIndex, renderedChunkCount, initialHighlight]);

  // Content search
  const {
    isOpen: isSearchOpen, query: searchQuery, searchedQuery,
    currentIndex, totalMatches,
    setQuery: setSearchQuery, openSearch, closeSearch, goToNext, goToPrevious, processChildren,
  } = useContentSearch(atom.content);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+S: immediate save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isEditing) saveNow();
        return;
      }
      // Cmd+F: search (only when not editing — CodeMirror handles its own search)
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (!isEditing) {
          e.preventDefault();
          openSearch();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (showDeleteModal || isSearchOpen) return;
        if (isEditing) {
          e.preventDefault();
          void stopEditing();
          return;
        }
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openSearch, showDeleteModal, isSearchOpen, onDismiss, isEditing, saveNow, stopEditing]);

  // Highlight helpers
  const highlightInitialText = useCallback((text: string): ReactNode => {
    if (!initialHighlight || !text) return text;
    const idx = text.toLowerCase().indexOf(initialHighlight.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark data-initial-highlight="true" className="initial-highlight">
          {text.slice(idx, idx + initialHighlight.length)}
        </mark>
        {text.slice(idx + initialHighlight.length)}
      </>
    );
  }, [initialHighlight]);

  const processInitialHighlight = useCallback((children: ReactNode): ReactNode => {
    if (typeof children === 'string') return highlightInitialText(children);
    if (Array.isArray(children)) return children.map((child, i) => <span key={i}>{processInitialHighlight(child)}</span>);
    return children;
  }, [highlightInitialText]);

  const wrapWithHighlight = useCallback((children: ReactNode): ReactNode => {
    if (initialHighlight) return processInitialHighlight(children);
    if (isSearchOpen && searchQuery.trim()) return processChildren(children);
    return children;
  }, [isSearchOpen, searchQuery, processChildren, initialHighlight, processInitialHighlight]);

  const markdownComponents = useMemo(() => ({
    p: ({ children }: { children?: ReactNode }) => <p>{wrapWithHighlight(children)}</p>,
    li: ({ children }: { children?: ReactNode }) => <li>{wrapWithHighlight(children)}</li>,
    td: ({ children }: { children?: ReactNode }) => <td>{wrapWithHighlight(children)}</td>,
    th: ({ children }: { children?: ReactNode }) => <th>{wrapWithHighlight(children)}</th>,
    strong: ({ children }: { children?: ReactNode }) => <strong>{wrapWithHighlight(children)}</strong>,
    em: ({ children }: { children?: ReactNode }) => <em>{wrapWithHighlight(children)}</em>,
    del: ({ children }: { children?: ReactNode }) => <del>{wrapWithHighlight(children)}</del>,
    h1: ({ children }: { children?: ReactNode }) => <h1>{wrapWithHighlight(children)}</h1>,
    h2: ({ children }: { children?: ReactNode }) => <h2>{wrapWithHighlight(children)}</h2>,
    h3: ({ children }: { children?: ReactNode }) => <h3>{wrapWithHighlight(children)}</h3>,
    h4: ({ children }: { children?: ReactNode }) => <h4>{wrapWithHighlight(children)}</h4>,
    h5: ({ children }: { children?: ReactNode }) => <h5>{wrapWithHighlight(children)}</h5>,
    h6: ({ children }: { children?: ReactNode }) => <h6>{wrapWithHighlight(children)}</h6>,
    blockquote: ({ children }: { children?: ReactNode }) => <blockquote>{wrapWithHighlight(children)}</blockquote>,
    code: ({ className, children }: { className?: string; children?: ReactNode }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) return <code className={className}>{wrapWithHighlight(children)}</code>;
      return <code>{wrapWithHighlight(children)}</code>;
    },
    pre: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      // If the link wraps an image, render the image unwrapped
      const childArray = Array.isArray(children) ? children : [children];
      if (childArray.some((c: any) => c?.type === MarkdownImage || c?.props?.src)) {
        return <>{children}</>;
      }
      return (
        <a href={href} onClick={(e) => { e.preventDefault(); if (href) openExternalUrl(href).catch(console.error); }} className="cursor-pointer">
          {wrapWithHighlight(children)}
        </a>
      );
    },
    img: ({ src, alt }: { src?: string; alt?: string }) => <MarkdownImage src={src} alt={alt} />,
  }), [wrapWithHighlight]);

  // Focus CodeMirror and set cursor position after mount
  // Poll briefly because the view may not be ready on the first frame
  useEffect(() => {
    if (!isEditing || cursorOffset === null) return;
    let attempts = 0;
    const tryFocus = () => {
      const view = editorRef.current?.view;
      if (view) {
        const pos = Math.min(cursorOffset, view.state.doc.length);
        view.focus();
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      } else if (attempts < 10) {
        attempts++;
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }, [isEditing, cursorOffset]);

  // Dev: expose the editor view for e2e harness scripts.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      (window as any).__cmView = editorRef.current?.view ?? null;
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [isEditing]);

  const stopEditingRef = useRef(stopEditing);
  stopEditingRef.current = stopEditing;

  const editorExtensions = useMemo(() => getEditorExtensions(), []);

  // Document-level capture listener — fires before any element in the DOM tree
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();
        void stopEditingRef.current();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isEditing]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } catch (error) {
      console.error('Failed to delete atom:', error);
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const proseClasses = `prose ${readerTheme === 'dark' ? 'prose-invert' : ''} max-w-none prose-headings:text-[var(--color-text-primary)] prose-p:text-[var(--color-text-primary)] prose-a:text-[var(--color-text-primary)] prose-a:underline prose-a:decoration-[var(--color-border-hover)] prose-a:hover:decoration-current prose-strong:text-[var(--color-text-primary)] prose-code:text-[var(--color-accent-light)] prose-code:bg-[var(--color-bg-card)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-[var(--color-bg-card)] prose-pre:border prose-pre:border-[var(--color-border)] prose-blockquote:border-l-[var(--color-accent)] prose-blockquote:text-[var(--color-text-secondary)] prose-li:text-[var(--color-text-primary)] prose-hr:border-[var(--color-border)]`;

  return (
    <div
      data-reader-theme={readerTheme}
      className={`h-full flex flex-col bg-[var(--color-bg-main)] transition-opacity duration-300 ease-out ${revealed ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Scrollable content area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-auto-hide">
        {/* Search bar (only when not editing — CodeMirror has built-in search) */}
        {!isEditing && isSearchOpen && (
          <div className="max-w-2xl mx-auto px-6">
            <SearchBar
              query={searchQuery}
              searchedQuery={searchedQuery}
              onQueryChange={setSearchQuery}
              currentIndex={currentIndex}
              totalMatches={totalMatches}
              onNext={goToNext}
              onPrevious={goToPrevious}
              onClose={closeSearch}
            />
          </div>
        )}

        {/* Content area */}
        <div className="max-w-6xl mx-auto px-6 py-6 lg:flex lg:gap-10">
          {/* Prose column */}
          <div className={`flex-1 min-w-0 transition-[filter,opacity] duration-200 ${
            isTransitioning ? 'blur-[2px] opacity-60' : ''
          }`}>
            {isEditing ? (
              <div className={`max-w-3xl ${proseClasses}`}>
                <CodeMirror
                  ref={editorRef}
                  value={editContent}
                  onChange={setEditContent}
                  extensions={editorExtensions}
                  theme="none"
                  autoFocus
                  placeholder="Write your note in Markdown..."
                  className="min-h-[300px]"
                  basicSetup={{
                    lineNumbers: false,
                    highlightActiveLineGutter: false,
                    highlightActiveLine: false,
                    foldGutter: false,
                    bracketMatching: false,
                    closeBrackets: false,
                  }}
                />
              </div>
            ) : (
              <article
                ref={articleRef}
                className={`max-w-3xl ${proseClasses}`}
              >
                {chunks.slice(0, renderedChunkCount).map((chunk, index) => (
                  <MemoizedMarkdownChunk key={index} content={chunk} components={markdownComponents} />
                ))}

                <div className="h-8">
                  {!isFullyRendered && (
                    <div className="flex items-center gap-2 text-[var(--color-text-tertiary)]">
                      <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                      <span className="text-sm">Loading...</span>
                    </div>
                  )}
                </div>
              </article>
            )}
          </div>

          {/* Metadata sidebar — right side on lg+ screens */}
          <div className="hidden lg:block w-80 shrink-0 border border-[var(--color-border)] rounded-lg p-4 self-start">
            {/* Source URL */}
            {isEditing ? (
              <div className="mb-4">
                <Input
                  value={editSourceUrl}
                  onChange={(e) => setEditSourceUrl(e.target.value)}
                  placeholder="Source URL (optional)"
                  className="text-xs"
                />
              </div>
            ) : atom.source_url ? (
              <div className="mb-4">
                <a
                  href={atom.source_url}
                  onClick={(e) => { e.preventDefault(); openExternalUrl(atom.source_url!).catch(console.error); }}
                  className="inline-block text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] bg-[var(--color-bg-card)] px-2 py-0.5 rounded-full cursor-pointer transition-colors"
                >
                  {atom.source || (() => { try { return new URL(atom.source_url!).hostname.replace(/^www\./, ''); } catch { return atom.source_url; } })()}
                </a>
              </div>
            ) : null}

            {/* Tags */}
            {isEditing ? (
              <div className="mb-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {editTags.map((tag) => (
                    <TagChip
                      key={tag.id}
                      name={tag.name}
                      size="sm"
                      onRemove={() => setEditTags(editTags.filter(t => t.id !== tag.id))}
                    />
                  ))}
                  <button
                    onClick={() => setShowTagSelector(!showTagSelector)}
                    className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors px-1.5 py-0.5 rounded border border-dashed border-[var(--color-border)]"
                  >
                    +
                  </button>
                </div>
                {showTagSelector && (
                  <TagSelector selectedTags={editTags} onTagsChange={setEditTags} />
                )}
              </div>
            ) : atom.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {atom.tags.map((tag) => (
                  <TagChip
                    key={tag.id}
                    name={tag.name}
                    size="sm"
                    onClick={() => onTagClick(tag.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="mb-4 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)]/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--color-text-primary)]">No tags yet</p>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      Run tagging for this atom manually.
                    </p>
                  </div>
                  <button
                    onClick={() => { void handleAutoTag(); }}
                    disabled={isTaggingInFlight}
                    className="shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isTaggingInFlight ? 'Tagging...' : 'Auto-tag'}
                  </button>
                </div>
              </div>
            )}

            {/* Dates */}
            <div className="text-xs text-[var(--color-text-tertiary)] space-y-0.5">
              {atom.published_at && <p>{formatDate(atom.published_at)}</p>}
              <p>{formatDate(atom.updated_at)}</p>
            </div>

            {/* Neighborhood graph — always visible */}
            {atom.embedding_status !== 'failed' && (
              <div className="mt-4">
                <MiniGraphPreview atomId={atom.id} onExpand={onViewGraph} />
              </div>
            )}

            {/* Related atoms — collapsible */}
            {atom.embedding_status !== 'failed' && (
              <SidebarRelatedAtoms atomId={atom.id} onAtomClick={onRelatedAtomClick} />
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Atom"
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        confirmVariant="danger"
        onConfirm={handleDelete}
      >
        <p>Are you sure you want to delete this atom? This action cannot be undone.</p>
      </Modal>
    </div>
  );
}

function SidebarRelatedAtoms({ atomId, onAtomClick }: { atomId: string; onAtomClick: (id: string) => void }) {
  const [relatedAtoms, setRelatedAtoms] = useState<SimilarAtomResult[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Reset when atomId changes so we re-fetch for the new atom
  useEffect(() => {
    setRelatedAtoms([]);
    setHasLoaded(false);
  }, [atomId]);

  useEffect(() => {
    if (!isCollapsed && !hasLoaded) {
      setIsLoading(true);
      getTransport().invoke<SimilarAtomResult[]>('find_similar_atoms', { atomId, limit: 5, threshold: 0.7 })
        .then((results) => { setRelatedAtoms(results); setHasLoaded(true); })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [atomId, isCollapsed, hasLoaded]);

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center justify-between w-full text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <span>Related atoms</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} strokeWidth={2} />
      </button>
      {!isCollapsed && (
        <div className="mt-2 space-y-1.5">
          {isLoading ? (
            <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
          ) : relatedAtoms.length > 0 ? (
            relatedAtoms.map((result) => (
              <button
                key={result.id}
                onClick={() => onAtomClick(result.id)}
                className="w-full text-left p-2 rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                <p className="text-xs text-[var(--color-text-primary)] line-clamp-2">
                  {result.title || 'Untitled'}
                </p>
                <span className="text-[10px] text-[var(--color-accent)]">
                  {Math.round(result.similarity_score * 100)}% similar
                </span>
              </button>
            ))
          ) : hasLoaded ? (
            <div className="text-xs text-[var(--color-text-tertiary)]">No similar atoms found</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
