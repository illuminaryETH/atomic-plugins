import { describe, it, expect } from 'vitest';
import { Root } from 'protobufjs';
import { descriptor } from './descriptor';
import { NoteConverter } from './convert-note';
import {
  ANStyleType,
  ANFontWeight,
  type ANDocument,
  type ConverterContext,
} from './models';

const root = Root.fromJSON(descriptor);
const DocumentType = root.lookupType(NoteConverter.protobufType);

function buildContext(overrides: Partial<ConverterContext> = {}): ConverterContext {
  return {
    includeHandwriting: false,
    omitFirstLine: false,
    decodeData: () => {
      throw new Error('decodeData not expected in these tests');
    },
    lookupAttachment: async () => null,
    resolveInternalLinkTitle: async () => null,
    ...overrides,
  };
}

/**
 * Build a Document proto message with a single Note whose attributeRun
 * lengths cover the given noteText. Each `runs` entry carries the formatting
 * we want applied to its slice.
 */
function makeDocument(
  noteText: string,
  runs: { length: number; fontWeight?: ANFontWeight; styleType?: ANStyleType; indentAmount?: number; done?: number; link?: string }[],
): ANDocument {
  const attributeRun = runs.map((r) => {
    const attr: Record<string, unknown> = { length: r.length };
    if (r.fontWeight !== undefined) attr.fontWeight = r.fontWeight;
    if (r.link !== undefined) attr.link = r.link;
    const para: Record<string, unknown> = {};
    if (r.styleType !== undefined) para.styleType = r.styleType;
    if (r.indentAmount !== undefined) para.indentAmount = r.indentAmount;
    if (r.done !== undefined) para.checklist = { done: r.done, uuid: 'u' };
    if (Object.keys(para).length > 0) attr.paragraphStyle = para;
    return attr;
  });
  const payload = { note: { noteText, attributeRun, version: 1 }, name: 'test' };
  const err = DocumentType.verify(payload);
  if (err) throw new Error(`proto verify failed: ${err}`);
  const message = DocumentType.create(payload);
  return message as unknown as ANDocument;
}

describe('NoteConverter', () => {
  it('emits plain text for an unstyled single-run note', async () => {
    const doc = makeDocument('hello world', [{ length: 11 }]);
    const conv = new NoteConverter(buildContext(), doc);
    expect(await conv.format()).toBe('hello world');
  });

  it('formats bold with ** pairs', async () => {
    const doc = makeDocument('hello', [{ length: 5, fontWeight: ANFontWeight.Bold }]);
    const conv = new NoteConverter(buildContext(), doc);
    expect(await conv.format()).toBe('**hello**');
  });

  it('renders a title as an h1', async () => {
    const doc = makeDocument('My Title', [{ length: 8, styleType: ANStyleType.Title }]);
    const conv = new NoteConverter(buildContext(), doc);
    expect(await conv.format()).toBe('# My Title');
  });

  it('renders dashed list items with "- " prefix', async () => {
    const doc = makeDocument('item a\nitem b', [
      { length: 7, styleType: ANStyleType.DashedList },
      { length: 6, styleType: ANStyleType.DashedList },
    ]);
    const conv = new NoteConverter(buildContext(), doc);
    const out = await conv.format();
    expect(out).toContain('- item a');
    expect(out).toContain('- item b');
  });

  it('renders checkboxes with [ ] and [x]', async () => {
    const doc = makeDocument('todo\ndone', [
      { length: 5, styleType: ANStyleType.Checkbox, done: 0 },
      { length: 4, styleType: ANStyleType.Checkbox, done: 1 },
    ]);
    const conv = new NoteConverter(buildContext(), doc);
    const out = await conv.format();
    expect(out).toContain('- [ ] todo');
    expect(out).toContain('- [x] done');
  });

  it('numbers NumberedList items in sequence', async () => {
    // Apple Notes always sets indentAmount explicitly (often 0). Omitting it
    // here would make the converter's "indent changed → reset counter" check
    // trip on `0 !== undefined`.
    const doc = makeDocument('a\nb\nc', [
      { length: 2, styleType: ANStyleType.NumberedList, indentAmount: 0 },
      { length: 2, styleType: ANStyleType.NumberedList, indentAmount: 0 },
      { length: 1, styleType: ANStyleType.NumberedList, indentAmount: 0 },
    ]);
    const conv = new NoteConverter(buildContext(), doc);
    const out = await conv.format();
    expect(out).toMatch(/1\. a/);
    expect(out).toMatch(/2\. b/);
    expect(out).toMatch(/3\. c/);
  });

  it('wraps monospaced runs in ``` fences', async () => {
    const doc = makeDocument('code', [{ length: 4, styleType: ANStyleType.Monospaced }]);
    const conv = new NoteConverter(buildContext(), doc);
    const out = await conv.format();
    expect(out.startsWith('```')).toBe(true);
    expect(out.endsWith('```')).toBe(true);
    expect(out).toContain('code');
  });

  it('drops the first line when omitFirstLine is true and body has a newline', async () => {
    const doc = makeDocument('Title\nBody content', [{ length: 18 }]);
    const conv = new NoteConverter(buildContext({ omitFirstLine: true }), doc);
    const out = await conv.format();
    expect(out).not.toContain('Title');
    expect(out).toContain('Body content');
  });

  it('keeps the whole content when omitFirstLine is true but the note has no newline', async () => {
    const doc = makeDocument('Only Title', [{ length: 10 }]);
    const conv = new NoteConverter(buildContext({ omitFirstLine: true }), doc);
    expect(await conv.format()).toBe('Only Title');
  });

  it('escapes square brackets in plain text', async () => {
    const doc = makeDocument('see [foo]', [{ length: 9 }]);
    const conv = new NoteConverter(buildContext(), doc);
    expect(await conv.format()).toBe('see \\[foo\\]');
  });

  it('renders external links as markdown anchors', async () => {
    const doc = makeDocument('click', [{ length: 5, link: 'https://example.com' }]);
    const conv = new NoteConverter(buildContext(), doc);
    expect(await conv.format()).toBe('[click](https://example.com)');
  });

  it('converts applenotes:note internal links to wikilinks', async () => {
    const doc = makeDocument('other', [{ length: 5, link: 'applenotes:note/abc' }]);
    const conv = new NoteConverter(buildContext(), doc);
    expect(await conv.format()).toBe('[[other]]');
  });
});
