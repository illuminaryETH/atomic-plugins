import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUIStore } from '../stores/ui';
import { parseLocation } from './routes';
import { setNavigateFn } from './navigate-ref';

/// Glue between react-router-dom (URL) and Zustand (UI store).
///
/// Responsibilities:
///   1. Expose the live `navigate` function to non-React code via
///      `setNavigateFn` so store actions can write URLs.
///   2. Reconcile the store to the URL on every location change. URL is the
///      source of truth for routed state (viewMode, selectedTagId,
///      readerState, wikiReaderState). The store is the source of truth for
///      UI-only state (editing, saveStatus, panel widths, etc.).
///
/// The "URL → store" direction is the tricky one: we read location, compute
/// what the store *should* look like, and `set` any diffs. This runs on both
/// programmatic `navigate()` calls and real browser back/forward, so both
/// produce identical store state.
export function RouterBridge() {
  const location = useLocation();
  const navigate = useNavigate();

  // Publish the live navigate fn to the module-scope ref so store actions
  // can use it.
  useEffect(() => {
    setNavigateFn(navigate);
  }, [navigate]);

  useEffect(() => {
    const parsed = parseLocation(location.pathname, location.search);
    const store = useUIStore.getState();

    if (parsed.kind === 'view') {
      // Leaving any overlay — clear reader/wiki state if present.
      const needsClear =
        store.readerState.atomId !== null ||
        store.wikiReaderState.tagId !== null ||
        store.overlayNav.stack.length > 0;

      if (needsClear || store.viewMode !== parsed.viewMode || store.selectedTagId !== parsed.tagId) {
        useUIStore.setState({
          viewMode: parsed.viewMode,
          selectedTagId: parsed.tagId,
          readerState: { atomId: null, highlightText: null, editing: false, saveStatus: 'idle' },
          wikiReaderState: { tagId: null, tagName: null },
          overlayNav: { stack: [], index: -1 },
          localGraph: { ...store.localGraph, isOpen: false },
          // Restore the left panel if we auto-collapsed it on overlay open.
          // Mirrors the pre-routing behavior in `overlayBack`/`overlayDismiss`.
          ...(store.leftPanelOpenBeforeReader
            ? { leftPanelOpen: true, leftPanelOpenBeforeReader: false }
            : {}),
        });
      }
    } else if (parsed.kind === 'reader') {
      // Open atom overlay. Preserve `editing` if we're navigating to the same
      // atom the reader is already showing (e.g. React re-render with no URL
      // change) — otherwise a fresh atom starts in view mode.
      const sameAtom = store.readerState.atomId === parsed.atomId;
      const prevStack = store.overlayNav.stack;
      const lastEntry = prevStack[store.overlayNav.index];
      const alreadyTopOfStack =
        lastEntry && lastEntry.type === 'reader' && lastEntry.atomId === parsed.atomId;

      useUIStore.setState({
        selectedTagId: parsed.tagId,
        readerState: {
          atomId: parsed.atomId,
          highlightText: sameAtom ? store.readerState.highlightText : null,
          editing: sameAtom ? store.readerState.editing : false,
          saveStatus: sameAtom ? store.readerState.saveStatus : 'idle',
        },
        wikiReaderState: { tagId: null, tagName: null },
        // MainView gives `localGraph.isOpen` priority over reader in its
        // dispatch — so we must close it here or chevron-back from graph
        // to reader leaves the graph visible.
        localGraph: { ...store.localGraph, isOpen: false },
        overlayNav: alreadyTopOfStack
          ? store.overlayNav
          : {
              stack: [...prevStack.slice(0, store.overlayNav.index + 1), { type: 'reader', atomId: parsed.atomId }],
              index: store.overlayNav.index + 1,
            },
        // Auto-collapse left panel on first overlay open (desktop), matching
        // the pre-routing behavior.
        ...(store.overlayNav.index === -1 && store.leftPanelOpen
          ? { leftPanelOpen: false, leftPanelOpenBeforeReader: true }
          : {}),
      });
    } else if (parsed.kind === 'graph') {
      const prevStack = store.overlayNav.stack;
      const lastEntry = prevStack[store.overlayNav.index];
      const alreadyTopOfStack =
        lastEntry && lastEntry.type === 'graph' && lastEntry.atomId === parsed.atomId;

      useUIStore.setState({
        selectedTagId: parsed.tagId,
        readerState: { atomId: null, highlightText: null, editing: false, saveStatus: 'idle' },
        wikiReaderState: { tagId: null, tagName: null },
        localGraph: {
          isOpen: true,
          centerAtomId: parsed.atomId,
          depth: store.localGraph.depth,
          // Reset graph-internal nav history when entering via URL — that
          // history is ephemeral and belongs to this graph session.
          navigationHistory: [parsed.atomId],
        },
        overlayNav: alreadyTopOfStack
          ? store.overlayNav
          : {
              stack: [
                ...prevStack.slice(0, store.overlayNav.index + 1),
                { type: 'graph', atomId: parsed.atomId },
              ],
              index: store.overlayNav.index + 1,
            },
        ...(store.overlayNav.index === -1 && store.leftPanelOpen
          ? { leftPanelOpen: false, leftPanelOpenBeforeReader: true }
          : {}),
      });
    } else if (parsed.kind === 'wiki-reader') {
      const prevStack = store.overlayNav.stack;
      const lastEntry = prevStack[store.overlayNav.index];
      const alreadyTopOfStack =
        lastEntry && lastEntry.type === 'wiki' && lastEntry.tagId === parsed.tagId;

      useUIStore.setState({
        wikiReaderState: {
          tagId: parsed.tagId,
          tagName: parsed.tagName ?? store.wikiReaderState.tagName,
        },
        readerState: { atomId: null, highlightText: null, editing: false, saveStatus: 'idle' },
        // Close the graph if it was showing — MainView prioritizes graph
        // over wiki in its render dispatch.
        localGraph: { ...store.localGraph, isOpen: false },
        overlayNav: alreadyTopOfStack
          ? store.overlayNav
          : {
              stack: [
                ...prevStack.slice(0, store.overlayNav.index + 1),
                { type: 'wiki', tagId: parsed.tagId, tagName: parsed.tagName ?? '' },
              ],
              index: store.overlayNav.index + 1,
            },
        ...(store.overlayNav.index === -1 && store.leftPanelOpen
          ? { leftPanelOpen: false, leftPanelOpenBeforeReader: true }
          : {}),
      });
    }
  }, [location.pathname, location.search]);

  return null;
}
