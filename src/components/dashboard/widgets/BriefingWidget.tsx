import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { SigmaCanvas } from '../../canvas/SigmaCanvas';
import { CitationPopover } from '../../wiki/CitationPopover';
import { BriefingContent } from './BriefingContent';
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
  const suggestedArticles = useWikiStore(s => s.suggestedArticles);
  const articles = useWikiStore(s => s.articles);
  const openReader = useUIStore(s => s.openReader);
  const setViewMode = useUIStore(s => s.setViewMode);
  const isMobile = useIsMobile();

  const latest = useBriefingStore(s => s.latest);
  const isRunning = useBriefingStore(s => s.isRunning);
  const fetchLatest = useBriefingStore(s => s.fetchLatest);
  const runNow = useBriefingStore(s => s.runNow);

  // Load on mount and re-fetch whenever the backend emits briefing-ready.
  useEffect(() => {
    fetchLatest();
    const unsub = getTransport().subscribe('briefing-ready', () => {
      fetchLatest();
    });
    return () => unsub();
  }, [fetchLatest]);

  const handleOpenCanvas = () => setViewMode('canvas');

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
    const newAtoms24h = atoms.filter(a => withinHours(a.updated_at, 24)).length;
    const newAtoms7d = atoms.filter(a => withinHours(a.updated_at, 24 * 7)).length;
    const latestAtom = atoms[0] ?? null;
    return { newAtoms24h, newAtoms7d, latestAtom, wikiCount: articles.length };
  }, [atoms, articles]);

  const now = new Date();
  const hello = greeting(now);

  const fallbackSummary = useMemo(() => {
    if (stats.newAtoms24h > 0) {
      return `You captured ${stats.newAtoms24h} new atom${stats.newAtoms24h === 1 ? '' : 's'} in the last 24 hours. Your first briefing will generate automatically.`;
    }
    if (stats.newAtoms7d > 0) {
      return `Quiet day. ${stats.newAtoms7d} atom${stats.newAtoms7d === 1 ? '' : 's'} added this week.`;
    }
    return 'Your knowledge base is quiet. Add an atom to get the flywheel turning.';
  }, [stats]);

  const chips: string[] = [
    `${stats.newAtoms24h} new today`,
    `${stats.newAtoms7d} this week`,
    `${stats.wikiCount} wiki${stats.wikiCount === 1 ? '' : 's'}`,
    `${suggestedArticles.length} suggested`,
  ];

  // ===== Render =====

  const hasBriefing = latest !== null;
  const eyebrowLabel = hasBriefing
    ? `TODAY'S BRIEFING · ${formatRelativeDate(latest!.briefing.created_at).toUpperCase()}`
    : formatToday(now);

  return (
    <div className="pb-2">
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
          {eyebrowLabel}
        </div>
        <button
          onClick={() => runNow()}
          disabled={isRunning}
          title="Regenerate briefing now"
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          <RefreshCw className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} strokeWidth={2} />
        </button>
      </div>

      {/* Desktop: canvas floats right so the briefing copy wraps alongside it.
          Rendered only on desktop to avoid mounting Sigma twice. */}
      {!isMobile && (
        <div className="float-right ml-8 mb-2 w-80 aspect-[4/3]">
          <SigmaCanvas mode="preview" onPreviewClick={handleOpenCanvas} />
        </div>
      )}

      <h1 className="text-3xl md:text-4xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-4">
        {hasBriefing ? `${hello}.` : `${hello}.`}
      </h1>

      {/* Mobile: canvas stacks full-width between title and content so it
          never appears above the title. */}
      {isMobile && (
        <div className="my-4 w-full aspect-[16/10]">
          <SigmaCanvas mode="preview" onPreviewClick={handleOpenCanvas} />
        </div>
      )}

      {hasBriefing ? (
        <BriefingContent
          content={latest!.briefing.content}
          citations={latest!.citations}
          onCitationClick={handleCitationClick}
        />
      ) : (
        <p className="text-base md:text-lg text-[var(--color-text-secondary)] leading-relaxed">
          {fallbackSummary}
        </p>
      )}

      {!hasBriefing && (
        <div className="mt-5 text-[13px] text-[var(--color-text-tertiary)] tabular-nums">
          {chips.join('  ·  ')}
        </div>
      )}

      {!hasBriefing && stats.latestAtom && (
        <button
          onClick={() => openReader(stats.latestAtom!.id)}
          className="mt-4 inline-flex items-center gap-2 text-[13px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors group"
        >
          <span className="text-[var(--color-text-tertiary)]">Most recent</span>
          <span className="text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent-light)] truncate max-w-[16rem] md:max-w-sm">
            {stats.latestAtom.title || 'Untitled'}
          </span>
          <ChevronRight className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" strokeWidth={2} />
        </button>
      )}

      {hasBriefing && (
        <div className="mt-4 text-[12px] text-[var(--color-text-tertiary)]">
          Covers {latest!.briefing.atom_count} new atom{latest!.briefing.atom_count === 1 ? '' : 's'}
        </div>
      )}

      {/* Clear the float so any following sibling (layout-level gap) doesn't collide */}
      <div className="md:clear-right" />

      {/* Citation popover — shared with wiki, tolerates the BriefingCitation shape
          because CitationForPopover only requires {citation_index, atom_id, excerpt}. */}
      {activeCitation && anchorRect && (
        <CitationPopover
          citation={activeCitation}
          anchorRect={anchorRect}
          onClose={closePopover}
          onViewAtom={(atomId) => {
            closePopover();
            openReader(atomId);
          }}
        />
      )}
    </div>
  );
}
