import { wikiLinks, type WikiLinkSuggestion } from '@atomic-editor/editor';
import type { Extension } from '@codemirror/state';

export type AtomLinkSuggestionSource = 'recent' | 'title' | 'content' | 'hybrid';

export interface AtomLinkSuggestion {
  id: string;
  title: string;
  snippet?: string | null;
  source?: AtomLinkSuggestionSource;
}

export interface ResolvedAtomLinkTarget {
  id: string;
  title: string;
  snippet?: string | null;
}

export interface AtomLinkExtensionConfig {
  currentAtomId?: string;
  suggestAtoms: (query: string) => Promise<AtomLinkSuggestion[]>;
  resolveAtom?: (id: string) => Promise<ResolvedAtomLinkTarget | null>;
  openAtom?: (id: string, opts?: { newTab?: boolean }) => void;
  maxSuggestions?: number;
}

/// The CodeMirror wikiLinks extension's `onOpen` callback only receives the
/// link target (the atom id) — not the click event. To support cmd/ctrl+click
/// → "open in new tab", we capture a mousedown listener at document level
/// and stash whether the modifier was held. `onOpen` synchronously fires from
/// the same click event, so the flag stays fresh.
let lastModifierWasHeld = false;
let lastModifierAt = 0;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'mousedown',
    (e) => {
      lastModifierWasHeld = e.metaKey || e.ctrlKey;
      lastModifierAt = Date.now();
    },
    { capture: true },
  );
}

/// Read & clear the modifier flag from the most recent mousedown. Stale
/// after ~500ms so a long-held modifier from a forgotten gesture doesn't
/// poison later clicks.
export function consumeAtomLinkClickModifier(): boolean {
  if (Date.now() - lastModifierAt > 500) return false;
  const v = lastModifierWasHeld;
  lastModifierWasHeld = false;
  return v;
}

export function atomLinkExtension(config: AtomLinkExtensionConfig): Extension[] {
  return [
    wikiLinks({
      suggest: async (query) => {
        const suggestions = await config.suggestAtoms(query);
        return suggestions
          .filter((suggestion) => suggestion.id !== config.currentAtomId)
          .map((suggestion) => ({
            target: suggestion.id,
            label: displayTitle(suggestion.title),
            detail: suggestion.source ? sourceLabel(suggestion.source) : undefined,
            boost: suggestion.source === 'title' || suggestion.source === 'recent' ? 20 : 0,
          }));
      },
      resolve: config.resolveAtom
        ? async (target) => {
            if (!isUuidTarget(target)) return null;
            const atom = await config.resolveAtom!(target);
            if (!atom) {
              return { target, label: 'Missing atom', status: 'missing' };
            }
            return { target, label: displayTitle(atom.title), status: 'resolved' };
          }
        : undefined,
      onOpen: config.openAtom
        ? (target: string) => {
            const newTab = consumeAtomLinkClickModifier();
            config.openAtom!(target, { newTab });
          }
        : undefined,
      openOnClick: true,
      serializeSuggestion,
      shouldResolve: isUuidTarget,
      maxSuggestions: config.maxSuggestions,
    }),
  ];
}

function isUuidTarget(target: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.trim());
}

function serializeSuggestion(suggestion: WikiLinkSuggestion): string {
  return `${suggestion.target}|${escapeLabel(suggestion.label)}]]`;
}

function sourceLabel(source: AtomLinkSuggestionSource): string {
  switch (source) {
    case 'recent':
      return 'Recent';
    case 'title':
      return 'Title';
    case 'content':
      return 'Content';
    case 'hybrid':
      return 'Related';
  }
}

function displayTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled atom';
}

function escapeLabel(label: string): string {
  return label.replace(/[\]\|]/g, ' ').replace(/\s+/g, ' ').trim();
}
