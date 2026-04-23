import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

// Must match the Private Use Area markers emitted by the backend's FTS5
// `snippet()` call in crates/atomic-core/src/storage/sqlite/search.rs.
export const MATCH_START = '\u{E000}';
export const MATCH_END = '\u{E001}';

const MDAST_DROP = new Set([
  'html',
  'yaml',
  'definition',
  'image',
  'imageReference',
  'footnoteReference',
]);

const MDAST_BLOCK = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'footnoteDefinition',
]);

const MDAST_VALUE = new Set(['text', 'inlineCode', 'code']);

const containsMarker = (s: unknown): s is string =>
  typeof s === 'string' && s.includes(MATCH_START);

function walkMdast(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as {
    type: string;
    value?: string;
    url?: string;
    alt?: string;
    children?: unknown[];
  };
  if (n.type === 'break' || n.type === 'thematicBreak') {
    out.push(' ');
    return;
  }
  if (MDAST_VALUE.has(n.type)) {
    if (typeof n.value === 'string') out.push(n.value);
    return;
  }
  // Normally-dropped nodes still surface their text when an FTS marker lands
  // inside — otherwise a match in an image path or raw HTML attribute
  // disappears from the snippet and the user sees a sub-row with no bolding.
  if (MDAST_DROP.has(n.type)) {
    if (containsMarker(n.alt)) out.push(n.alt);
    if (containsMarker(n.url)) {
      if (out.length > 0 && !out[out.length - 1].endsWith(' ')) out.push(' ');
      out.push(n.url);
    }
    if (containsMarker(n.value)) {
      if (out.length > 0 && !out[out.length - 1].endsWith(' ')) out.push(' ');
      out.push(n.value);
    }
    return;
  }
  if (Array.isArray(n.children)) {
    const before = out.length;
    for (const child of n.children) walkMdast(child, out);
    // For links, fall back to surfacing the URL only if the anchor text
    // didn't already carry the match — keeps regular in-text matches from
    // being double-bolded while ensuring URL-only matches still appear.
    if ((n.type === 'link' || n.type === 'linkReference') && containsMarker(n.url)) {
      const childrenHadMarker = out.slice(before).some(containsMarker);
      if (!childrenHadMarker) {
        out.push(' ');
        out.push(n.url!);
      }
    }
    if (MDAST_BLOCK.has(n.type)) out.push(' ');
  }
}

/**
 * Strip dangling markdown fragments left behind when a snippet window cuts
 * into the middle of `[text](url)` or `[text]` syntax. These get parsed as
 * plain text by the markdown AST (since the opening bracket is missing) and
 * would otherwise leak raw punctuation into the display.
 *
 * Marker-aware: if an orphan fragment contains an FTS match marker, we keep
 * the fragment and just strip the stray brackets/parens — dropping it would
 * lose the match the user came to see.
 */
function cleanTruncationArtifacts(s: string): string {
  const defuseBrackets = (frag: string) => frag.replace(/[[\]()]/g, ' ');
  const sanitizePrefix = (match: string) => {
    if (match.includes(MATCH_START)) return defuseBrackets(match);
    const space = match.indexOf(' ');
    return space >= 0 ? match.slice(0, space + 1) : '';
  };
  const sanitizeSuffix = (match: string) =>
    match.includes(MATCH_START) ? defuseBrackets(match) : '';
  return s
    .replace(/^[^[]*?\]\([^)]*\)/, sanitizePrefix)
    .replace(/\]\([^)]*$/, sanitizeSuffix)
    .replace(/\[[^\]]*$/, sanitizeSuffix)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a markdown fragment and return its text content as plaintext.
 * The FTS5 match markers (`MATCH_START` / `MATCH_END`) are plain characters
 * in text nodes, so they survive the round-trip as long as the match didn't
 * fall inside dropped content like a URL or image path.
 */
export function markdownToPlainText(source: string): string {
  let tree: unknown;
  try {
    tree = fromMarkdown(source, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
  } catch {
    return cleanTruncationArtifacts(source);
  }
  const out: string[] = [];
  walkMdast(tree, out);
  return cleanTruncationArtifacts(out.join(''));
}

/**
 * Strip markers from a plaintext string. Useful when passing a per-match
 * window to a downstream consumer (like the wiki reader's substring search)
 * that doesn't understand the PUA markers.
 */
export function stripMatchMarkers(source: string): string {
  let out = '';
  for (const ch of source) {
    if (ch !== MATCH_START && ch !== MATCH_END) out += ch;
  }
  return out;
}
