import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useKeyboard } from '../../hooks/useKeyboard';
import { getTransport } from '../../lib/transport';
import { chunkMarkdown } from '../../lib/markdown';
import type { AtomWithTags } from '../../stores/atoms';
import { TagChip } from '../tags/TagChip';
import { formatDate } from '../../lib/date';

interface AtomPreviewPopoverProps {
  atomId: string;
  anchorRect: { top: number; left: number; bottom: number; width: number };
  onClose: () => void;
  onViewAtom: (atomId: string, opts?: { newTab?: boolean }) => void;
}

const POPOVER_WIDTH = 480;
const POPOVER_MAX_HEIGHT = 360;
const CHUNK_SIZE = 4000;
const INITIAL_CHUNKS = 1;
const CHUNKS_PER_BATCH = 2;

const remarkPluginsStable = [remarkGfm];

const MemoizedChunk = memo(function MemoizedChunk({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPluginsStable}>
      {content}
    </ReactMarkdown>
  );
});

function calculatePosition(
  anchorRect: { top: number; left: number; bottom: number; width: number },
  popoverHeight: number,
  popoverWidth: number
): { top: number; left: number } {
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;

  let top: number;
  if (spaceBelow >= popoverHeight + 12 || spaceBelow >= spaceAbove) {
    top = anchorRect.bottom + 12;
  } else {
    top = anchorRect.top - popoverHeight - 12;
  }

  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));

  top = Math.max(8, Math.min(top, window.innerHeight - popoverHeight - 8));

  return { top, left };
}

export function AtomPreviewPopover({ atomId, anchorRect, onClose, onViewAtom }: AtomPreviewPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [atom, setAtom] = useState<AtomWithTags | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const initialPosition = calculatePosition(anchorRect, POPOVER_MAX_HEIGHT, POPOVER_WIDTH);
  const [position, setPosition] = useState(initialPosition);
  // Once the user drags, stop re-anchoring to the node.
  const hasBeenDraggedRef = useRef(false);
  // When the atom switches (user clicked a different node), allow re-anchoring once.
  useEffect(() => { hasBeenDraggedRef.current = false; }, [atomId]);

  useKeyboard('Escape', onClose, true);

  // Click outside dismisses the popover and unselects the node on the canvas.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Fetch atom data
  useEffect(() => {
    setIsLoading(true);
    getTransport().invoke<AtomWithTags | null>('get_atom_by_id', { id: atomId })
      .then((result) => {
        setAtom(result);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch atom for preview:', err);
        setIsLoading(false);
      });
  }, [atomId]);

  // Refine position after render — but not after the user has manually dragged.
  useLayoutEffect(() => {
    if (hasBeenDraggedRef.current) return;
    if (!popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    setPosition(calculatePosition(anchorRect, rect.height, rect.width));
  }, [anchorRect, atom, isLoading, isCollapsed]);

  // Drag handle on the header — mousedown starts drag, window mousemove updates,
  // mouseup ends. Clamps to viewport so the popover can't be dragged off-screen.
  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = position.top;
    const startLeft = position.left;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const width = popoverRef.current?.offsetWidth ?? POPOVER_WIDTH;
      const height = popoverRef.current?.offsetHeight ?? POPOVER_MAX_HEIGHT;
      const nextLeft = Math.max(8, Math.min(startLeft + dx, window.innerWidth - width - 8));
      const nextTop = Math.max(8, Math.min(startTop + dy, window.innerHeight - height - 8));
      hasBeenDraggedRef.current = true;
      setPosition({ top: nextTop, left: nextLeft });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [position.top, position.left]);

  const handleViewAtom = (e: React.MouseEvent) => {
    onViewAtom(atomId, { newTab: e.metaKey || e.ctrlKey });
    onClose();
  };

  // Progressive rendering: chunk content, render first chunk immediately, load rest incrementally
  const chunks = useMemo(
    () => (atom ? chunkMarkdown(atom.content, CHUNK_SIZE) : []),
    [atom]
  );
  const [renderedChunkCount, setRenderedChunkCount] = useState(INITIAL_CHUNKS);
  const isFullyRendered = renderedChunkCount >= chunks.length;

  // Reset when atom changes
  useEffect(() => { setRenderedChunkCount(INITIAL_CHUNKS); }, [atom?.id]);

  // Progressively load remaining chunks
  useEffect(() => {
    if (isFullyRendered) return;
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => {
        setRenderedChunkCount((prev) => Math.min(prev + CHUNKS_PER_BATCH, chunks.length));
      }, { timeout: 100 });
      return () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(() => {
        setRenderedChunkCount((prev) => Math.min(prev + CHUNKS_PER_BATCH, chunks.length));
      }, 32);
      return () => clearTimeout(id);
    }
  }, [renderedChunkCount, chunks.length, isFullyRendered]);

  return createPortal(
    <div
      ref={popoverRef}
      data-modal="true"
      className="fixed z-[100] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg shadow-xl"
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH, maxWidth: 'calc(100vw - 16px)' }}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
            <Loader2 className="animate-spin h-4 w-4" strokeWidth={2} />
            <span className="text-sm">Loading...</span>
          </div>
        </div>
      ) : !atom ? (
        <div className="py-6 text-center text-sm text-[var(--color-text-secondary)]">
          Atom not found
        </div>
      ) : (
        <>
          {/* Header: drag handle + title + metadata + collapse/close controls */}
          <div
            onMouseDown={handleDragStart}
            className={`px-4 py-3 flex items-start gap-2 select-none cursor-grab active:cursor-grabbing ${isCollapsed ? '' : 'border-b border-[var(--color-border)]'}`}
          >
            <div className="flex-1 min-w-0">
              <h3 className={`text-sm font-medium text-[var(--color-text-primary)] ${isCollapsed ? 'truncate' : 'line-clamp-2'}`}>
                {atom.title || 'Untitled'}
              </h3>
              {!isCollapsed && (
                <div className="flex items-center gap-2 mt-1">
                  {atom.source_url && (
                    <span className="text-[10px] text-[var(--color-text-tertiary)] bg-[var(--color-bg-main)] px-1.5 py-0.5 rounded-full truncate max-w-[200px]">
                      {atom.source || (() => { try { return new URL(atom.source_url!).hostname.replace(/^www\./, ''); } catch { return atom.source_url; } })()}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {formatDate(atom.updated_at)}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
              <button
                onClick={() => setIsCollapsed((v) => !v)}
                className="p-1 rounded hover:bg-[var(--color-bg-main)] text-[var(--color-text-secondary)]"
                title={isCollapsed ? 'Expand' : 'Collapse'}
              >
                {isCollapsed
                  ? <ChevronDown className="w-4 h-4" strokeWidth={2} />
                  : <ChevronUp className="w-4 h-4" strokeWidth={2} />}
              </button>
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-[var(--color-bg-main)] text-[var(--color-text-secondary)]"
                title="Close"
              >
                <X className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>

          {!isCollapsed && (
            <>
              {/* Content preview */}
              <div className="px-4 py-3 prose prose-invert prose-sm max-w-none [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_h4]:text-xs [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h4]:m-0 [&_p]:text-xs [&_li]:text-xs [&_pre]:text-[10px] [&_code]:text-[10px] [&_blockquote]:text-xs max-h-[200px] overflow-y-auto">
                {chunks.slice(0, renderedChunkCount).map((chunk, i) => (
                  <MemoizedChunk key={i} content={chunk} />
                ))}
              </div>

              {/* Tags */}
              {atom.tags.length > 0 && (
                <div className="px-4 pt-1 pb-2 flex flex-wrap gap-1">
                  {atom.tags.slice(0, 5).map((tag) => (
                    <TagChip key={tag.id} name={tag.name} size="xs" />
                  ))}
                  {atom.tags.length > 5 && (
                    <span className="text-[10px] text-[var(--color-text-tertiary)] self-center">
                      +{atom.tags.length - 5} more
                    </span>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="px-4 py-2 border-t border-[var(--color-border)]">
                <button
                  onClick={handleViewAtom}
                  className="flex items-center gap-1 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors"
                >
                  Open in reader
                  <ArrowRight className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
