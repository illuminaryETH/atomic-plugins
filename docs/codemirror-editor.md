# The Atomic CodeMirror editor

This document describes the philosophy, architecture, and working theory of
Atomic's CodeMirror 6 editor — the editor that replaced Milkdown/ProseMirror
for atom editing and now powers `AtomReader` in production.

It is not an inventory of every function. It is the set of decisions you
need to hold in your head before you change anything, because the surface
area is small but each piece is load-bearing.

## Why CM6 at all

Milkdown (ProseMirror under the hood) gave us a polished WYSIWYG surface
but could not virtualize. ProseMirror's state model requires the entire
document tree to be present in memory and mounted as DOM on every render.
For atoms that run to hundreds of pages that is a non-starter — open time
grows linearly with document size, scrolling jitters under layout churn,
and memory pressure becomes real.

CodeMirror 6 virtualizes natively. It renders only the viewport, the
parser (`@lezer/markdown`) is incremental, and the whole system is built
around decorations that compose cleanly. The tradeoff is that CM6 is
a text editor at heart — "WYSIWYG" in CM6 means carefully choreographed
decorations layered over a raw text buffer, not a rich-content model
like ProseMirror's.

## The core invariant: raw markdown is the source of truth

**The document text in `state.doc` is always plain markdown.** Every
decoration is view-only. This is the single rule the whole design follows
from, and it is worth stating twice:

- What you see on screen may differ from the raw text (hidden syntax
  tokens, rendered bullet characters, checkbox widgets, rendered
  images, WYSIWYG tables, etc.).
- What you copy, what gets saved, what another editor would parse is
  always the underlying markdown.

This invariant is why cross-block selection "just works" (the browser
selection maps to doc positions, and copy reads raw markdown from those
positions), why collaborative editing and diffing can be bolted on later
without rethinking the view layer, and why we can trust that what the
user sees matches what's persisted.

## The second invariant: no layout shifts

This was the lesson of Phase 1 — we briefly shipped a "block" preview
mode that replaced each block with a rendered HTML widget, and every
cursor move between blocks caused a height change as the clicked block
unfolded to raw and the leaving block refolded. Measured at ~0.1 CLS per
10 cursor moves in our Playwright probe; in practice it felt like the UI
was vibrating under the user.

The current mode ("inline live preview") avoids layout shifts by making
line heights depend **only on CSS class**, not on whether syntax tokens
are visible. A heading line styled `.cm-atomic-h1` is ~1.35em whether
the `# ` prefix is currently hidden or revealed. Active and inactive
states toggle token visibility via `Decoration.replace({})`, which removes
characters from flow without changing the enclosing line's measured
height.

Measured CLS for the same 10 cursor-moves test in inline mode: ~0.003,
and essentially all of it is the cursor caret redrawing — the structure
isn't shifting.

## Package layout

The editor lives as its own workspace package, `@atomic/editor`, so it
can be reused, open-sourced, and evolved without tangling with the
Atomic app's other moving parts.

```
packages/editor/
    package.json              npm workspace, peer-deps every CM6 module
    src/
        index.ts              public API (AtomicCodeMirrorEditor + types)
        AtomicCodeMirrorEditor.tsx  React shell + imperative handle
        inline-preview.ts     main decoration engine (ViewPlugin)
        image-blocks.ts       block image widgets (StateField)
        table-widget.ts       WYSIWYG tables (StateField)
        edit-helpers.ts       bracket / emphasis auto-pairing
        atomic-theme.ts       theme + syntax highlighting
        code-languages.ts     fenced-code grammar registry
        styles/
            inline-preview.css  all editor CSS in one file

src/
    index.css                 maps app tokens → --atomic-editor-* vars
                              and imports @atomic/editor/styles.css
    components/atoms/AtomReader.tsx  lazy-loads AtomicCodeMirrorEditor
    components/editor-harness/
        EditorHarnessPage.tsx isolated dev route at /editor-harness
        sample-content.ts     deterministic fixtures

scripts/test-editor-harness.mjs   Playwright probes
```

The app consumes the package via `import { AtomicCodeMirrorEditor } from
'@atomic/editor'` and `import '@atomic/editor/styles.css'`. The package
has no hard dependencies — every CM6 module is a peer — so the bundler
resolves a single copy of each module across the app. Two copies of CM6
in the same bundle silently break state-field identity checks; peer-deps
are what prevent that.

## `AtomicCodeMirrorEditor`

A React wrapper around a single `EditorView`. Teardown on unmount;
document identity (`documentId ?? markdownSource`) keys the view so
cursor / undo state from a previous atom can't bleed into the next one.

The component exposes an imperative handle via `editorHandleRef`:
`focus`, `undo`, `redo`, `openSearch(query?)`, `closeSearch`,
`isSearchOpen`, `getMarkdown`, `getContentDOM`. `AtomReader` drives
those from titlebar buttons and document-level keydown handlers.

Props and their intent live in the interface JSDoc — the notable ones:

- `markdownSource` — initial content; the editor owns the doc after mount.
- `onMarkdownChange` — fires for every doc mutation, including internal
  ones (checkbox toggles, tight-list continuations).
- `initialSearchText` — opens the search panel pre-filled, for landing
  the user on a search hit.
- `onLinkClick` — called when the reader taps the external-link icon
  rendered next to a link; the app wires this to `openExternalUrl`.

## `inline-preview.ts` — the decoration engine

Three pieces, each with a specific reason to exist.

1. **`previewFrozenField`** — a boolean `StateField` tracking whether
   decoration rebuilds are paused. Toggled via a `setFrozen` effect
   from the freeze plugin.

2. **`freezeMousePlugin`** — a `ViewPlugin` with a capture-phase
   `pointerdown` listener on `view.dom` and a `pointerup` listener
   on `window`. On pointerdown inside the content DOM, it dispatches
   `setFrozen(true)`. On pointerup, after a ~100ms tail, it dispatches
   `setFrozen(false)`.

   The freeze exists because clicking a heading used to reveal its
   `# ` prefix immediately — which shifted the heading text rightward
   under the user's cursor mid-click, sometimes promoting the click
   into a micro-drag selection. Now the reveal waits until the click
   has fully resolved.

   The capture-phase listener matters: `@codemirror/lang-markdown`'s
   own pointerdown handler runs bubble-phase and dispatches selection
   changes. Without capture, CM6 can rebuild decorations before we
   freeze, and the reveal fires anyway. The content-DOM filter matters
   too: without it, a scrollbar drag engages the freeze and stops
   decoration rebuilds for the whole drag — deep content stays raw
   until mouseup.

3. **`inlinePreviewPlugin`** — a `ViewPlugin` whose `decorations` facet
   drives the display. Rebuilds on doc change, viewport change,
   selection change, or focus change, subject to the freeze flag. The
   build function:

   - Computes `activeLines` from the current selection (and only when
     the view has focus; without that guard a cold load with an
     implicit `cursor(0)` would always leave line 1 active).
   - Calls `ensureSyntaxTree(state, view.viewport.to, 50)` to push the
     incremental parser through the visible region. This is what fixes
     "content past the initial parse window renders as raw text until
     you click to nudge the parser" — a `StateField` can't see the
     viewport, so decorations built from one never ask for enough
     tree coverage. That's why decoration sourcing is a plugin, not a
     state field.
   - Walks the tree scoped to the viewport (`iterate({from, to, ...})`),
     which also makes the walk O(visible blocks) instead of O(whole doc).
   - Two passes in practice: the first indexes task-list positions and
     expands active lines through fenced code blocks; the second emits
     line classes, inline marks, hide decorations, and widgets.

## What we hide, what we style, what we replace

- **Line classes** (applied unconditionally based on block type):
  `cm-atomic-h1`..`h6`, `cm-atomic-blockquote`, `cm-atomic-fenced-code`,
  `cm-atomic-hr`, `cm-atomic-task-done`.
  These set font size / weight / decoration. No height changes between
  active and inactive states because the class doesn't care about
  cursor position.

- **Inline content marks** (applied unconditionally to content between
  syntax tokens): `cm-atomic-strong`, `cm-atomic-em`,
  `cm-atomic-inline-code`, `cm-atomic-strike`, `cm-atomic-link`. The
  link mark also renders an "open externally" icon via a `::after`
  pseudo-element; only the icon's hit region is clickable, since the
  link text itself is editable prose.

- **Hide decorations** (applied only on inactive lines): `HeaderMark`,
  `EmphasisMark`, `CodeMark`, `CodeInfo`, `LinkMark`, `URL`,
  `LinkTitle`, `StrikethroughMark`, `QuoteMark`, and `Escape`. Header
  and quote marks swallow a trailing space so the hidden-state line
  doesn't read indented. `Escape` hides only the leading backslash —
  RSS-ingested text full of `\.` and `\,` reads clean until focused.

- **Widgets** (always-on replacements): `•` for bullet `ListMark`,
  a checkbox for `TaskMarker`, horizontal-rule rendering via a CSS
  `::after` rule on the line, rendered images below each image source
  line (see `image-blocks.ts`), and full WYSIWYG tables (see
  `table-widget.ts`).

## `image-blocks.ts` — block image widgets

Images can't be emitted from a `ViewPlugin` because CM6 requires block
decorations to come from a `StateField` or a mandatory facet. The image
state field lives alongside the inline preview plugin; CM6 composes the
two decoration sets at render time.

For each `Image` node, the field emits a block widget with `side: 1` at
`line.to`, so the image renders immediately below its source line.
Images inside tables are skipped — the table widget renders them inline
in the cells. Clicking an image dispatches a selection change to land
the caret inside the source line, which reveals the raw markdown for
editing.

Size invariants: the `<img>` has `display: block; max-width: 100%;
height: auto` so it fits the reading column without upscaling beyond
natural size. Small images render at their own size, left-aligned.

## `table-widget.ts` — WYSIWYG tables

Tables give up on the "source-as-DOM" invariant at the row level: a
Table node's entire range is replaced with an interactive `<table>`
widget. Each cell is a small DOM tree owning a `.cm-atomic-table-cell-
source` (contenteditable `<div>` holding the raw markdown) and, when
the cell contains `![alt](url)`, a `.cm-atomic-table-cell-preview`
strip rendering the image below.

The widget's `eq()` is structure-only (row × column count), so CM6
keeps the existing DOM across per-keystroke dispatches and the caret
survives edits. Cell input re-serializes the whole table and replaces
the current source range — the range is resolved fresh via `posAtDOM
+ tree walk` every time, because earlier edits shift the bounds.

Interaction contract:

- Tab / Shift-Tab move between cells. Tab past the last cell appends
  a new row and lands on its first cell.
- Right-click opens a menu with Insert row above/below, Delete row,
  Insert column left/right, Delete column. The last column is floored
  so lezer can still parse the remnant as a Table.
- Inside an image cell, the raw `![alt](url)` hides when focus leaves
  the cell — only the image shows at rest, matching the block-image
  invariant outside tables. Focus the cell (click anywhere in it,
  including the image, or Tab in) to bring the source back.
- Backspace at the line immediately after a table selects the whole
  table as an atomic unit instead of merging content into the last row.

## The tight-Enter override

`@codemirror/lang-markdown` ships `insertNewlineContinueMarkup` as its
default Enter handler. It inspects the syntax tree to decide whether the
list it's continuing is "loose" (CommonMark: blank lines between items)
and, if so, inserts a blank line into the continuation to preserve the
loose style.

In inline live-preview mode loose and tight lists look identical, so the
distinction doesn't earn its weight. Worse, lezer often classifies a
newly-typed list item as loose when it sits near an existing list — the
user ends up with a spurious blank line between their two new items.

`insertTightListItem` in `inline-preview.ts` overrides Enter at
`Prec.highest`. Bound behavior:

- Inside a `BulletList`, always emit `\n<indent><marker> ` (tight).
- Inside a task item, emit `\n<indent><marker> [ ] ` — fresh tasks
  start unchecked, even if you pressed Enter on a checked item.
- On an empty continuation (`- ` with nothing after, or `- [ ] ` with
  nothing after), replace the line with just its indent, which exits
  the list the user expects.

## Bracket / emphasis auto-pairing

`closeBrackets()` pairs `(`, `[`, `{`, `"`, `'`, `*`, `_`, `` ` `` by
default; we extend the markdown language's data facet to include the
markdown-specific symmetric delimiters. `extendEmphasisPair` in
`edit-helpers.ts` adds one special case: typing `*` inside an empty
`*|*` (or `_|_`) promotes the pair to `**|**` — the Obsidian ergonomic
for typing bold quickly without thinking about doubled strokes.

## `atomic-theme.ts`

Two CM6 extensions:

- An `EditorView.theme()` with visual / selection / scrollbar styling
  tied to `--atomic-editor-*` custom properties. The app maps its
  design tokens onto those in `src/index.css`, so the editor follows
  the app's theme without any JS bridge.
- A `HighlightStyle` + `syntaxHighlighting` pairing that colors
  markdown tokens via `@lezer/highlight` tags. Syntax coloring is
  deliberately muted — the big visual weight comes from the line
  classes in inline-preview, not from token color.

## `code-languages.ts`

The language registry for fenced-code blocks. Each language's `load()`
is a dynamic import so Rollup splits each grammar into its own chunk
and users only download the ones they open.

## Search

The editor wires `@codemirror/search` with a custom panel factory that
tags the panel's root as `.atomic-editor-search-panel` and exposes the
expected inputs (find, replace, case / regex / word toggles).
`AtomReader` drives open / close / isOpen through the imperative
handle; Ctrl/Cmd+F from anywhere in the reader opens the panel, and
the reader's Escape handler closes it before falling through to
dismiss.

## The harness

`/editor-harness` is not a pretty UI — it's a dev surface. It exists so
we can test the editor against very large documents without touching
`AtomReader`. The sample content generator (`sample-content.ts`) is
deterministic (seeded mulberry32), so screenshots and probe outputs
are stable across runs.

`scripts/test-editor-harness.mjs` drives Chromium through Playwright
and measures things the eye can't easily reason about: CLS during
idle, scroll, click, typing, and cursor ping-pong; selection and copy
behavior; freeze timing; table widget + in-cell image behavior;
backslash-escape hiding; task-list interaction. When iterating on the
editor, run it after every change — it catches regressions in under
ten seconds.

## Next steps

The editor is live in `AtomReader` and has shipped through normal use
for typical atoms. The next work — in rough priority order — is
knowledge-base integration: features that make an atom behave less
like an isolated markdown document and more like a node in a graph.

### 1. Block definitions

Today every atom is one document. The knowledge graph's finest
granularity is the whole atom. We want **block-addressable content**:
give any heading, paragraph, or list item a stable identifier so other
atoms (and wikis, and chat) can link directly to it.

Likely shape:

- Obsidian-style suffix syntax: `^block-id` at the end of a block
  implicitly defines it. Optional leading `{#slug}` on a heading does
  the same.
- Emit a decoration for the identifier (muted pill, click-to-copy the
  reference form) and hide the raw `^id` on inactive lines.
- Persist a (atom_id, block_id) → (start, end) index so resolvers
  across the app can find the target cheaply. Where this index lives
  is itself a question — probably a per-atom sidecar table, rebuilt
  when `onMarkdownChange` fires.

### 2. Block references

Once blocks have stable identifiers, other atoms can quote them:
`![[other-atom#block-id]]` embeds that block's rendered content
inline. Shape:

- Parse the reference in `inline-preview.ts` as a new node kind (or
  detect it post-hoc via a regex over inline text — lezer-markdown
  doesn't have native wiki-link parsing).
- Render an embed widget that fetches the target block through the
  atomic-core transport and shows it. Cache aggressively; the
  transport already exposes atom-by-id lookups.
- Decide the editing affordance: is the embed read-only (the user
  edits the source block in its home atom), or does it surface an
  "open source" button? Read-only is simpler and honors the "one
  canonical home per block" invariant.

### 3. Footnotes

Markdown footnotes (`[^1]` plus a `[^1]: ...` definition elsewhere in
the doc) are non-trivial: the reference and the definition are
separated by arbitrary content, and the rendered view wants a
hoverable popover or a jump-to-definition affordance.

Shape:

- lezer-markdown's GFM extension includes footnote nodes; verify the
  `markdown({ base: markdownLanguage })` config emits them. If not,
  add the extension.
- Reference rendering: a small superscript widget with the footnote
  number. Hover or click opens a popover with the definition's
  rendered body. On inactive lines, hide the raw `[^1]` markdown;
  reveal on focus.
- Definition rendering: muted styling on the definition line(s); hide
  the `[^1]: ` prefix on inactive lines.
- Numbering is lexical (by position, or by explicit label), so the
  render needs to cache a label-to-ordinal map rebuilt on doc change.

### 4. Internal links to other atoms

Cross-atom links are the backbone of a knowledge graph. Right now
atoms have no affordance for linking to each other; everything is
semantic similarity or tag membership.

Shape:

- Syntax: Obsidian-style `[[atom-title]]` with optional
  `[[atom-title|display text]]` aliasing. Parsing via a
  post-processing scan (lezer-markdown has no native support).
- Decoration: an inline mark + a distinct color/icon so internal
  links read visibly different from external URLs. Click navigates
  to that atom in the reader.
- Autocomplete: typing `[[` opens an atom-title completer (CM6
  autocomplete facet, queries the atom store). Selecting an item
  inserts the link and closes the completer.
- Resolution: titles are user-facing but not unique. The stored form
  could be the title with a disambiguator, or we could store a UUID
  and render the title from it. The latter is more robust but makes
  the raw markdown less portable. Decide with the user.
- Backlinks: once internal links exist, reverse lookup ("what atoms
  link here?") becomes a meaningful panel in the reader. Not part of
  the editor itself, but falls out of this work.

### 5. Carryover items

Lower priority than the four above, kept as reminders:

- **Selection toolbar.** A floating bold/italic/code/link toolbar on
  text selection. Milkdown had one; it's a small CM6 view plugin.
- **HTML-paste → markdown.** Intercept `paste` events with HTML
  content and convert via Turndown (or similar) before insertion.
  Currently raw HTML tags land in the doc.
- **Mobile touch polish.** CM6 handles touch natively, but widgets
  (checkbox toggle, image click-to-reveal, table cell focus) were
  built for pointer events. Sweep through once we have real usage
  data from Capacitor.
- **Milkdown code removal.** `src/components/editor/AtomicMilkdownEditor
  .tsx`, `src/editor/milkdown/`, and `src/styles/crepe-atomic-
  theme.css` are orphan now. Delete them along with their package
  deps once we're confident the CM6 swap doesn't need to roll back.
