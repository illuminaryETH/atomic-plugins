import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

type TextSegment = {
  startOffset: number;
  endOffset: number;
  startPos: number;
};

export type AtomicEditorSearchState = {
  query: string;
  currentIndex: number;
  matchCount: number;
  decorations: DecorationSet;
};

type AtomicEditorSearchMeta = {
  query?: string;
  currentIndex?: number;
};

export const atomicEditorSearchPluginKey = new PluginKey<AtomicEditorSearchState>(
  'atomic-editor-search'
);

function buildTextSegments(doc: ProseMirrorNode): { text: string; segments: TextSegment[] } {
  let text = '';
  const segments: TextSegment[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const startOffset = text.length;
    text += node.text;
    segments.push({
      startOffset,
      endOffset: text.length,
      startPos: pos + 1,
    });
  });

  return { text, segments };
}

function buildDecorations(
  doc: ProseMirrorNode,
  query: string,
  currentIndex: number
): { decorations: DecorationSet; matchCount: number; currentIndex: number } {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      decorations: DecorationSet.empty,
      matchCount: 0,
      currentIndex: 0,
    };
  }

  const { text, segments } = buildTextSegments(doc);
  if (!text) {
    return {
      decorations: DecorationSet.empty,
      matchCount: 0,
      currentIndex: 0,
    };
  }

  const haystack = text.toLocaleLowerCase();
  const needle = normalizedQuery.toLocaleLowerCase();
  const matches: Array<{ start: number; end: number }> = [];

  let searchFrom = 0;
  while (searchFrom <= haystack.length - needle.length) {
    const foundAt = haystack.indexOf(needle, searchFrom);
    if (foundAt === -1) break;
    matches.push({ start: foundAt, end: foundAt + needle.length });
    searchFrom = foundAt + Math.max(needle.length, 1);
  }

  if (matches.length === 0) {
    return {
      decorations: DecorationSet.empty,
      matchCount: 0,
      currentIndex: 0,
    };
  }

  const clampedIndex = Math.min(Math.max(currentIndex, 0), matches.length - 1);
  const decorations: Decoration[] = [];

  matches.forEach((match, matchIndex) => {
    segments.forEach((segment) => {
      const overlapStart = Math.max(match.start, segment.startOffset);
      const overlapEnd = Math.min(match.end, segment.endOffset);
      if (overlapStart >= overlapEnd) return;

      const from = segment.startPos + (overlapStart - segment.startOffset);
      const to = segment.startPos + (overlapEnd - segment.startOffset);

      decorations.push(
        Decoration.inline(from, to, {
          class: 'search-highlight',
          'data-search-match-index': String(matchIndex),
          ...(matchIndex === clampedIndex ? { 'data-current': 'true' } : {}),
        })
      );
    });
  });

  return {
    decorations: DecorationSet.create(doc, decorations),
    matchCount: matches.length,
    currentIndex: clampedIndex,
  };
}

function createSearchState(
  doc: ProseMirrorNode,
  query: string,
  currentIndex: number
): AtomicEditorSearchState {
  const result = buildDecorations(doc, query, currentIndex);
  return {
    query,
    currentIndex: result.currentIndex,
    matchCount: result.matchCount,
    decorations: result.decorations,
  };
}

export function createAtomicEditorSearchPlugin() {
  return new Plugin<AtomicEditorSearchState>({
    key: atomicEditorSearchPluginKey,
    state: {
      init: (_, state) => createSearchState(state.doc, '', 0),
      apply(tr, pluginState, _, newState) {
        const meta = tr.getMeta(atomicEditorSearchPluginKey) as AtomicEditorSearchMeta | undefined;
        const nextQuery = meta?.query ?? pluginState.query;
        const nextIndex = meta?.currentIndex ?? pluginState.currentIndex;

        if (!meta && !tr.docChanged) {
          return pluginState;
        }

        return createSearchState(newState.doc, nextQuery, nextIndex);
      },
    },
    props: {
      decorations(state) {
        return atomicEditorSearchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

export function setAtomicEditorSearch(viewState: EditorState, query: string, currentIndex = 0) {
  return viewState.tr.setMeta(atomicEditorSearchPluginKey, {
    query,
    currentIndex,
  } satisfies AtomicEditorSearchMeta);
}

export function getAtomicEditorSearchState(state: EditorState) {
  return atomicEditorSearchPluginKey.getState(state);
}
