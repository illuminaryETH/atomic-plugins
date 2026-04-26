import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { SigmaCanvas } from '../../canvas/SigmaCanvas';
import { CitationPopover } from '../../wiki/CitationPopover';
import { BriefingContent } from './BriefingContent';
import { CaptureOptions } from '../CaptureOptions';
import { useIsMobile } from '../../../hooks';
import { useAtomsStore } from '../../../stores/atoms';
import { useWikiStore } from '../../../stores/wiki';
import { useUIStore } from '../../../stores/ui';
import { useCanvasStore } from '../../../stores/canvas';
import { useBriefingStore, type BriefingCitation } from '../../../stores/briefing';
import { getTransport } from '../../../lib/transport';
import { formatRelativeDate } from '../../../lib/date';

function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function withinHours(iso: string, hours: number): boolean {
  return Date.now() - new Date(iso).getTime() < hours * 60 * 60 * 1000;
}

function formatToday(date: Date): string {
  return date
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();
}

export function BriefingWidget() {
  const atoms = useAtomsStore(s => s.atoms);
  const createAtom = useAtomsStore(s => s.createAtom);
  const suggestedArticles = useWikiStore(s => s.suggestedArticles);
  const articles = useWikiStore(s => s.articles);
  const openReader = useUIStore(s => s.openReader);
  const openReaderEditing = useUIStore(s => s.openReaderEditing);
  const setViewMode = useUIStore(s => s.setViewMode);
  const isMobile = useIsMobile();

  const handleCreateAtom = async () => {
    try {
      const atom = await createAtom('');
      openReaderEditing(atom.id);
    } catch (err) {
      console.error('Failed to create atom:', err);
    }
  };

  const active = useBriefingStore(s => s.active);
  const history = useBriefingStore(s => s.history);
  const activeIndex = useBriefingStore(s => s.activeIndex);
  const isLoading = useBriefingStore(s => s.isLoading);
  const isRunning = useBriefingStore(s => s.isRunning);
  const fetchLatest = useBriefingStore(s => s.fetchLatest);
  const navigate = useBriefingStore(s => s.navigate);
  const runNow = useBriefingStore(s => s.runNow);

  // Load on mount and re-fetch whenever the backend emits briefing-ready.
  useEffect(() => {
    fetchLatest();
    const unsub = getTransport().subscribe('briefing-ready', () => {
      fetchLatest();
    });
    return () => unsub();
  }, [fetchLatest]);

  // The mini-canvas now renders only this briefing's referenced atoms (plus
  // their 1-hop neighbors), so deduplicate citation atom IDs into a stable
  // array we hand to SigmaCanvas.
  const briefingAtomIds = useMemo(() => {
    if (!active) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of active.citations) {
      if (seen.has(c.atom_id)) continue;
      seen.add(c.atom_id);
      out.push(c.atom_id);
    }
    return out;
  }, [active]);

  const handleMiniNodeClick = (atomId: string) => {
    // Open the main canvas focused on the clicked atom. SigmaCanvas consumes
    // pendingFocusAtomId on mount and animates the camera + opens the popover,
    // so by the time the user sees the canvas it's already on that atom.
    const store = useCanvasStore.getState();
    store.setPendingCamera(null);
    store.setPendingFocusAtomId(atomId);
    setViewMode('canvas');
  };

  // Citation popover state
  const [activeCitation, setActiveCitation] = useState<BriefingCitation | null>(null);
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number; bottom: number; width: number } | null>(null);

  const handleCitationClick = (citation: BriefingCitation, element: HTMLElement) => {
    // Drive the preview canvas (the Sigma instance rendered inside this widget)
    // to zoom to the referenced atom. No-op if the preview controller hasn't
    // registered yet (still loading).
    useCanvasStore.getState().previewController?.focusAtom(citation.atom_id);

    // Open the popover anchored to the clicked citation
    const rect = element.getBoundingClientRect();
    setActiveCitation(citation);
    setAnchorRect({ top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width });
  };

  const closePopover = () => {
    setActiveCitation(null);
    setAnchorRect(null);
  };

  // ===== Fallback stub used when no briefing exists yet =====

  const stats = useMemo(() => {
    const newAtoms24h = atoms.filter(a => withinHours(a.created_at, 24)).length;
    const newAtoms7d = atoms.filter(a => withinHours(a.created_at, 24 * 7)).length;
    return { newAtoms24h, newAtoms7d, wikiCount: articles.length };
  }, [atoms, articles]);

  const now = new Date();
  const hello = greeting(now);

  const chips: string[] = [
    `${stats.newAtoms24h} new today`,
    `${stats.newAtoms7d} this week`,
    `${stats.wikiCount} wiki${stats.wikiCount === 1 ? '' : 's'}`,
    `${suggestedArticles.length} suggested`,
  ];

  // ===== Render =====

  const hasBriefing = active !== null;
  const canGoNewer = activeIndex > 0;
  const canGoOlder = activeIndex < history.length - 1;
  const eyebrowLabel = hasBriefing
    ? `BRIEFING · ${formatRelativeDate(active!.briefing.created_at).toUpperCase()}`
    : formatToday(now);

  return (
    <div className="pb-2">
      <div className="flex items-center gap-2 mb-3">
        {hasBriefing && (
          <>
            <button
              onClick={() => navigate(1)}
              disabled={!canGoOlder || isLoading}
              title="Older briefing"
              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={2} />
            </button>
            <button
              onClick={() => navigate(-1)}
              disabled={!canGoNewer || isLoading}
              title="Newer briefing"
              className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={2} />
            </button>
          </>
        )}
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
          {eyebrowLabel}
        </div>
        <button
          onClick={() => runNow()}
          disabled={isRunning}
          title="Regenerate briefing now"
          className="ml-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          <RefreshCw className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} strokeWidth={2} />
        </button>
      </div>

      {/* Desktop: canvas floats right so the briefing copy wraps alongside it.
          Rendered only on desktop to avoid mounting Sigma twice. Skipped in the
          no-briefing state — a near-empty graph reads as a broken widget. */}
      {!isMobile && hasBriefing && (
        <div className="float-right ml-2 mb-2 w-96 aspect-[4/3]">
          <SigmaCanvas
            mode="preview"
            filterAtomIds={briefingAtomIds}
            onPreviewNodeClick={handleMiniNodeClick}
          />
        </div>
      )}

      <h1 className="text-3xl md:text-4xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-4">
        {hello}.
      </h1>

      {/* Mobile: canvas stacks full-width between title and content so it
          never appears above the title. */}
      {isMobile && hasBriefing && (
        <div className="my-4 w-full aspect-[16/10]">
          <SigmaCanvas
            mode="preview"
            filterAtomIds={briefingAtomIds}
            onPreviewNodeClick={handleMiniNodeClick}
          />
        </div>
      )}

      {hasBriefing ? (
        <BriefingContent
          content={active!.briefing.content}
          citations={active!.citations}
          onCitationClick={handleCitationClick}
        />
      ) : (
        <button
          onClick={handleCreateAtom}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-accent)] text-white text-sm font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          Capture another atom
        </button>
      )}

      {!hasBriefing && (
        <div className="mt-5 text-[13px] text-[var(--color-text-tertiary)] tabular-nums">
          {chips.join('  ·  ')}
        </div>
      )}

      {hasBriefing && (
        <div className="mt-4 text-[12px] text-[var(--color-text-tertiary)]">
          Covers {active!.briefing.atom_count} new atom{active!.briefing.atom_count === 1 ? '' : 's'}
        </div>
      )}

      {/* Clear the float so any following sibling (layout-level gap) doesn't collide */}
      <div className="md:clear-right" />

      {/* When there's no briefing yet, surface every capture/import path below
          the primary CTA so a first-time user can pick whichever source best
          fits their knowledge base. */}
      {!hasBriefing && <CaptureOptions />}

      {/* Citation popover — shared with wiki, tolerates the BriefingCitation shape
          because CitationForPopover only requires {citation_index, atom_id, excerpt}. */}
      {activeCitation && anchorRect && (
        <CitationPopover
          citation={activeCitation}
          anchorRect={anchorRect}
          onClose={closePopover}
          onViewAtom={(atomId, highlightText) => {
            closePopover();
            openReader(atomId, highlightText);
          }}
        />
      )}
    </div>
  );
}
