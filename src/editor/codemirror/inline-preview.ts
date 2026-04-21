import { syntaxTree } from '@codemirror/language';
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

// Inline preview — the Obsidian "Live Preview" model.
//
// Goals:
//   1. No layout shifts between active/inactive state. The raw markdown
//      source is always the DOM text; we only apply line-level CSS
//      classes (setting font-size / weight unconditionally) and hide
//      syntax tokens on inactive lines via empty Decoration.replace.
//      Line heights are driven by CSS class, not by token visibility.
//
//   2. No reveal during mouse interaction. Clicking a heading places the
//      cursor on its line, which would normally "reveal" the `# ` prefix
//      — and that reveal shifts the heading text rightward under the
//      user's cursor, sometimes turning a click into a micro-drag.
//      Obsidian sidesteps this by delaying the reveal until the mouse
//      has been released for a moment; we do the same via a freeze flag.

const FREEZE_TAIL_MS = 100;

// ---- freeze plumbing -----------------------------------------------------

const setFrozen = StateEffect.define<boolean>();

const previewFrozenField = StateField.define<boolean>({
  create: () => false,
  update(prev, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFrozen)) return effect.value;
    }
    return prev;
  },
});

// Tracks mouse state on the editor and drives the freeze flag. We listen
// on the content DOM for pointerdown and on the window for pointerup —
// users can release outside the editor after a drag, and we'd miss the
// up event if we listened on the content DOM only.
const freezeMousePlugin = ViewPlugin.fromClass(
  class {
    private down = false;
    private releaseTimer: number | null = null;
    private readonly onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.down = true;
      if (this.releaseTimer != null) {
        window.clearTimeout(this.releaseTimer);
        this.releaseTimer = null;
      }
      if (!this.view.state.field(previewFrozenField)) {
        this.view.dispatch({ effects: setFrozen.of(true) });
      }
    };
    private readonly onUp = () => {
      if (!this.down) return;
      this.down = false;
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
      this.releaseTimer = window.setTimeout(() => {
        this.releaseTimer = null;
        if (!this.view.state.field(previewFrozenField)) return;
        try {
          this.view.dispatch({ effects: setFrozen.of(false) });
        } catch {
          // view destroyed while timer was pending.
        }
      }, FREEZE_TAIL_MS);
    };

    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener('pointerdown', this.onDown);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
    }

    update(_: ViewUpdate) {
      // No-op — we don't drive freeze off doc changes.
    }

    destroy() {
      this.view.contentDOM.removeEventListener('pointerdown', this.onDown);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
    }
  },
);

// ---- decoration building --------------------------------------------------

const LINE_CLASS_BY_BLOCK: Record<string, string> = {
  ATXHeading1: 'cm-atomic-h1',
  ATXHeading2: 'cm-atomic-h2',
  ATXHeading3: 'cm-atomic-h3',
  ATXHeading4: 'cm-atomic-h4',
  ATXHeading5: 'cm-atomic-h5',
  ATXHeading6: 'cm-atomic-h6',
  SetextHeading1: 'cm-atomic-h1',
  SetextHeading2: 'cm-atomic-h2',
  Blockquote: 'cm-atomic-blockquote',
  FencedCode: 'cm-atomic-fenced-code',
};

// Node names whose characters we want invisible when the cursor isn't on
// their line. Every hit contributes a Decoration.replace with no widget,
// which hides the range without affecting layout.
const HIDEABLE_SYNTAX = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'URL',
  'LinkTitle',
  'StrikethroughMark',
  'QuoteMark',
]);

// Inline content nodes that get a class applied unconditionally.
const INLINE_MARK_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-atomic-strong',
  Emphasis: 'cm-atomic-em',
  InlineCode: 'cm-atomic-inline-code',
  Strikethrough: 'cm-atomic-strike',
  Link: 'cm-atomic-link',
};

function buildInlineDecorations(state: EditorState): DecorationSet {
  const { doc } = state;
  const ranges: Range<Decoration>[] = [];

  const activeLines = new Set<number>();
  for (const r of state.selection.ranges) {
    const firstLine = doc.lineAt(r.from).number;
    const lastLine = doc.lineAt(r.to).number;
    for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
  }

  const tree = syntaxTree(state);
  tree.iterate({
    enter: (node) => {
      const lineClass = LINE_CLASS_BY_BLOCK[node.name];
      if (lineClass) {
        const firstLine = doc.lineAt(node.from);
        const lastLine = doc.lineAt(node.to);
        for (let n = firstLine.number; n <= lastLine.number; n++) {
          const line = doc.line(n);
          ranges.push(Decoration.line({ class: lineClass }).range(line.from));
        }
      }

      const markClass = INLINE_MARK_CLASS[node.name];
      if (markClass && node.from < node.to) {
        ranges.push(Decoration.mark({ class: markClass }).range(node.from, node.to));
      }

      if (HIDEABLE_SYNTAX.has(node.name) && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;
        if (!activeLines.has(lineNum)) {
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        }
      }
    },
  });

  return Decoration.set(ranges, true);
}

const inlinePreviewField = StateField.define<DecorationSet>({
  create: (state) => buildInlineDecorations(state),
  update(deco, tr) {
    const prevFrozen = tr.startState.field(previewFrozenField);
    const nextFrozen = tr.state.field(previewFrozenField);
    const justUnfroze = prevFrozen && !nextFrozen;

    // While frozen, keep whatever was last shown. This is what prevents
    // mousedown-triggered selection changes from revealing syntax tokens
    // mid-click and shifting layout under the cursor.
    if (nextFrozen && !justUnfroze) return deco;

    if (justUnfroze || tr.docChanged || tr.selection) {
      return buildInlineDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const inlinePreviewExtension: Extension = [
  previewFrozenField,
  inlinePreviewField,
  freezeMousePlugin,
];
