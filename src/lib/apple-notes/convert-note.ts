/**
 * Protobuf-to-markdown converter for Apple Notes attribute runs.
 *
 * Adapted from obsidian-importer (MIT, Three Planets Software). Changes from
 * the original:
 *   - No dependency on Obsidian's `AppleNotesImporter`, `App`, `TFile`, or
 *     `app.fileManager`. All external lookups go through `ConverterContext`.
 *   - File-backed attachments (drawings, scans, media) become inline
 *     placeholder text — Atomic doesn't have vault files.
 *   - Internal note links render as `[[Note Title]]` using the resolver
 *     callback on the context, falling back to the raw identifier.
 *   - `contains` replaced with standard `String.prototype.includes`.
 */

import { TableConverter } from './convert-table';
import {
  ANAlignment,
  ANAttachment,
  ANAttributeRun,
  ANBaseline,
  ANColor,
  ANConverter,
  ANDocument,
  ANFontWeight,
  ANFragmentPair,
  ANMultiRun,
  ANNote,
  ANStyleType,
  ANTableObject,
  type ConverterContext,
} from './models';

const FRAGMENT_SPLIT = /(^\s+|(?:\s+)?\n(?:\s+)?|\s+$)/;
const NOTE_URI = /applenotes:note\/([-0-9a-f]+)(?:\?ownerIdentifier=.*)?/;

const DEFAULT_EMOJI = '.AppleColorEmojiUI';
const LIST_STYLES: ANStyleType[] = [
  ANStyleType.DottedList,
  ANStyleType.DashedList,
  ANStyleType.NumberedList,
  ANStyleType.Checkbox,
];

export class NoteConverter extends ANConverter {
  ctx: ConverterContext;
  note: ANNote;

  listNumber = 0;
  listIndent = 0;
  multiRun: ANMultiRun = ANMultiRun.None;

  static protobufType = 'ciofecaforensics.Document';

  constructor(ctx: ConverterContext, document: ANDocument | ANTableObject) {
    super();
    this.ctx = ctx;
    this.note = (document as ANDocument).note;
  }

  parseTokens(): ANFragmentPair[] {
    let i = 0;
    let offsetStart = 0;
    let offsetEnd = 0;
    const tokens: ANFragmentPair[] = [];

    while (i < this.note.attributeRun.length) {
      let attr: ANAttributeRun;
      let attrText = '';
      let nextIsSame = true;

      // First, merge tokens with the same attributes.
      do {
        attr = this.note.attributeRun[i];
        offsetEnd = offsetEnd + attr.length;
        attrText += this.note.noteText.substring(offsetStart, offsetEnd);

        offsetStart = offsetEnd;
        nextIsSame =
          i === this.note.attributeRun.length - 1
            ? false
            : attrEquals(attr, this.note.attributeRun[i + 1]);

        i++;
      } while (nextIsSame);

      // Then split by whitespace/newline boundaries so markdown formatting
      // doesn't straddle line breaks (Obsidian/CommonMark can't parse it).
      for (const fragment of attrText.split(FRAGMENT_SPLIT)) {
        if (!fragment) continue;
        tokens.push({ attr, fragment });
      }
    }

    return tokens;
  }

  async format(table = false, parentNoteSourceUrl = ''): Promise<string> {
    const fragments = this.parseTokens();
    let firstLineSkip = !table && this.ctx.omitFirstLine && this.note.noteText.includes('\n');
    let converted = '';

    for (let j = 0; j < fragments.length; j++) {
      const { attr, fragment } = fragments[j];

      if (firstLineSkip) {
        if (fragment.includes('\n') || attr.attachmentInfo) {
          firstLineSkip = false;
        } else {
          continue;
        }
      }

      attr.fragment = fragment;
      attr.atLineStart = j === 0 ? true : fragments[j - 1]?.fragment.includes('\n');

      converted += this.formatMultiRun(attr);

      if (!/\S/.test(attr.fragment) || this.multiRun === ANMultiRun.Monospaced) {
        converted += attr.fragment;
      } else if (attr.attachmentInfo) {
        converted += await this.formatAttachment(attr, parentNoteSourceUrl);
      } else if (
        attr.superscript ||
        attr.underlined ||
        attr.color ||
        attr.font ||
        this.multiRun === ANMultiRun.Alignment
      ) {
        converted += this.formatHtmlAttr(attr);
      } else {
        converted += this.formatAttr(attr);
      }
    }

    if (this.multiRun !== ANMultiRun.None) converted += this.formatMultiRun({} as ANAttributeRun);
    return converted.trim();
  }

  /** Open/close multi-line constructs (code fences, alignment wrappers, list sentinels). */
  formatMultiRun(attr: ANAttributeRun): string {
    const styleType = attr.paragraphStyle?.styleType;
    let prefix = '';

    switch (this.multiRun) {
      case ANMultiRun.List:
        if (
          (attr.paragraphStyle?.indentAmount === 0 && !LIST_STYLES.includes(styleType!)) ||
          isBlockAttachment(attr)
        ) {
          this.multiRun = ANMultiRun.None;
        }
        break;

      case ANMultiRun.Monospaced:
        if (styleType !== ANStyleType.Monospaced) {
          this.multiRun = ANMultiRun.None;
          prefix += '```\n';
        }
        break;

      case ANMultiRun.Alignment:
        if (!attr.paragraphStyle?.alignment) {
          this.multiRun = ANMultiRun.None;
          prefix += '</p>\n';
        }
        break;
    }

    if (this.multiRun === ANMultiRun.None) {
      if (styleType === ANStyleType.Monospaced) {
        this.multiRun = ANMultiRun.Monospaced;
        prefix += '\n```\n';
      } else if (LIST_STYLES.includes(styleType as ANStyleType)) {
        this.multiRun = ANMultiRun.List;
        if (attr.paragraphStyle?.indentAmount) prefix += '\n- &nbsp;\n';
      } else if (attr.paragraphStyle?.alignment) {
        this.multiRun = ANMultiRun.Alignment;
        const val = this.convertAlign(attr?.paragraphStyle?.alignment);
        prefix += `\n<p style="text-align:${val};margin:0">`;
      }
    }

    return prefix;
  }

  /** HTML-based formatting for attributes that plain markdown can't express (colors, fonts, sup/sub). */
  formatHtmlAttr(attr: ANAttributeRun): string {
    if (attr.strikethrough) attr.fragment = `<s>${attr.fragment}</s>`;
    if (attr.underlined) attr.fragment = `<u>${attr.fragment}</u>`;

    if (attr.superscript === ANBaseline.Super) attr.fragment = `<sup>${attr.fragment}</sup>`;
    if (attr.superscript === ANBaseline.Sub) attr.fragment = `<sub>${attr.fragment}</sub>`;

    let style = '';

    switch (attr.fontWeight) {
      case ANFontWeight.Bold:
        attr.fragment = `<b>${attr.fragment}</b>`;
        break;
      case ANFontWeight.Italic:
        attr.fragment = `<i>${attr.fragment}</i>`;
        break;
      case ANFontWeight.BoldItalic:
        attr.fragment = `<b><i>${attr.fragment}</i></b>`;
        break;
    }

    if (attr.font?.fontName && attr.font.fontName !== DEFAULT_EMOJI) {
      style += `font-family:${attr.font.fontName};`;
    }
    if (attr.font?.pointSize) style += `font-size:${attr.font.pointSize}pt;`;
    if (attr.color) style += `color:${this.convertColor(attr.color)};`;

    if (attr.link && !NOTE_URI.test(attr.link)) {
      if (style) style = ` style="${style}"`;
      attr.fragment = `<a href="${attr.link}" rel="noopener" target="_blank"${style}>${attr.fragment}</a>`;
    } else if (style) {
      attr.fragment = `<span style="${style}">${attr.fragment}</span>`;
    }

    return attr.atLineStart ? this.formatParagraph(attr) : attr.fragment;
  }

  formatAttr(attr: ANAttributeRun): string {
    // Escape square brackets so free-text content doesn't accidentally look
    // like a wikilink.
    attr.fragment = attr.fragment.replace(/([\[\]])/g, '\\$1');

    switch (attr.fontWeight) {
      case ANFontWeight.Bold:
        attr.fragment = `**${attr.fragment}**`;
        break;
      case ANFontWeight.Italic:
        attr.fragment = `*${attr.fragment}*`;
        break;
      case ANFontWeight.BoldItalic:
        attr.fragment = `***${attr.fragment}***`;
        break;
    }

    if (attr.strikethrough) attr.fragment = `~~${attr.fragment}~~`;
    if (attr.link && attr.link !== attr.fragment) {
      if (NOTE_URI.test(attr.link)) {
        attr.fragment = `[[${attr.fragment}]]`;
      } else {
        attr.fragment = `[${attr.fragment}](${attr.link})`;
      }
    }

    return attr.atLineStart ? this.formatParagraph(attr) : attr.fragment;
  }

  formatParagraph(attr: ANAttributeRun): string {
    const indent = '\t'.repeat(attr.paragraphStyle?.indentAmount || 0);
    const styleType = attr.paragraphStyle?.styleType;
    let prelude = attr.paragraphStyle?.blockquote ? '> ' : '';

    if (
      this.listNumber !== 0 &&
      (styleType !== ANStyleType.NumberedList ||
        this.listIndent !== attr.paragraphStyle?.indentAmount)
    ) {
      this.listIndent = attr.paragraphStyle?.indentAmount || 0;
      this.listNumber = 0;
    }

    switch (styleType) {
      case ANStyleType.Title:
        return `${prelude}# ${attr.fragment}`;
      case ANStyleType.Heading:
        return `${prelude}## ${attr.fragment}`;
      case ANStyleType.Subheading:
        return `${prelude}### ${attr.fragment}`;
      case ANStyleType.DashedList:
      case ANStyleType.DottedList:
        return `${prelude}${indent}- ${attr.fragment}`;
      case ANStyleType.NumberedList:
        this.listNumber++;
        return `${prelude}${indent}${this.listNumber}. ${attr.fragment}`;
      case ANStyleType.Checkbox: {
        const box = attr.paragraphStyle!.checklist?.done ? '[x]' : '[ ]';
        return `${prelude}${indent}- ${box} ${attr.fragment}`;
      }
    }

    if (this.multiRun === ANMultiRun.List) prelude += indent;
    return `${prelude}${attr.fragment}`;
  }

  async formatAttachment(attr: ANAttributeRun, _parentNoteSourceUrl: string): Promise<string> {
    const info = attr.attachmentInfo;
    if (!info) return '';

    const lookup = await this.ctx.lookupAttachment(info.attachmentIdentifier);

    switch (info.typeUti) {
      case ANAttachment.Hashtag:
      case ANAttachment.Mention:
        return lookup?.altText ?? '';

      case ANAttachment.InternalLink: {
        if (!lookup?.tokenContentIdentifier) return '';
        const title = await this.resolveInternalLinkTitle(lookup.tokenContentIdentifier);
        return title ? `[[${title}]]` : '';
      }

      case ANAttachment.Table: {
        if (!lookup?.mergeableDataHex) return '';
        const converter = this.ctx.decodeData(lookup.mergeableDataHex, TableConverter);
        return await converter.format();
      }

      case ANAttachment.UrlCard:
        if (lookup?.title && lookup.urlString) {
          return `[**${lookup.title}**](${lookup.urlString})`;
        }
        return lookup?.urlString ? `<${lookup.urlString}>` : '';

      case ANAttachment.Scan:
      case ANAttachment.ModifiedScan:
      case ANAttachment.DrawingLegacy:
      case ANAttachment.DrawingLegacy2:
      case ANAttachment.Drawing: {
        const handwriting =
          this.ctx.includeHandwriting && lookup?.handwritingSummary
            ? `\n> [!Handwriting]-\n> ${lookup.handwritingSummary.replace(/\n/g, '\n> ')}\n`
            : '';
        return `${handwriting}\n*(attachment: ${labelForUti(info.typeUti)})*\n`;
      }

      default: {
        const filename = lookup?.filename ? ` — ${lookup.filename}` : '';
        return `\n*(attachment: ${labelForUti(info.typeUti)}${filename})*\n`;
      }
    }
  }

  async resolveInternalLinkTitle(uri: string): Promise<string | null> {
    const match = uri.match(NOTE_URI);
    const identifier = match ? match[1] : uri;
    return await this.ctx.resolveInternalLinkTitle(identifier.toUpperCase());
  }

  convertColor(color: ANColor): string {
    let hexcode = '#';
    for (const channel of Object.values(color)) {
      const v = Number(channel);
      if (!Number.isFinite(v)) continue;
      hexcode += Math.floor(v * 255).toString(16).padStart(2, '0');
    }
    return hexcode;
  }

  convertAlign(alignment: ANAlignment | undefined): string {
    switch (alignment) {
      case ANAlignment.Centre:
        return 'center';
      case ANAlignment.Right:
        return 'right';
      case ANAlignment.Justify:
        return 'justify';
      default:
        return 'left';
    }
  }
}

function labelForUti(uti: string | ANAttachment): string {
  switch (uti) {
    case ANAttachment.Drawing:
    case ANAttachment.DrawingLegacy:
    case ANAttachment.DrawingLegacy2:
      return 'drawing';
    case ANAttachment.Scan:
    case ANAttachment.ModifiedScan:
      return 'scan';
    default:
      return String(uti);
  }
}

function isBlockAttachment(attr: ANAttributeRun): boolean {
  if (!attr.attachmentInfo) return false;
  return !String(attr.attachmentInfo.typeUti).includes('com.apple.notes.inlinetextattachment');
}

function attrEquals(a: ANAttributeRun, b: ANAttributeRun): boolean {
  // protobufjs attaches `$type` with the reflection schema for message fields.
  // We compare both sides' `$type` when present, then recurse into child
  // messages; otherwise compare primitive values directly.
  if (!b) return false;
  const aType = (a as unknown as { $type?: { fieldsArray: { name: string }[] } }).$type;
  const bType = (b as unknown as { $type?: unknown }).$type;
  if (!aType || aType !== bType) return false;

  for (const field of aType.fieldsArray) {
    if (field.name === 'length') continue;

    const aVal = (a as Record<string, unknown>)[field.name];
    const bVal = (b as Record<string, unknown>)[field.name];

    const aHasType = typeof aVal === 'object' && aVal !== null && '$type' in (aVal as object);
    const bHasType = typeof bVal === 'object' && bVal !== null && '$type' in (bVal as object);

    if (aHasType && bHasType) {
      if (!attrEquals(aVal as ANAttributeRun, bVal as ANAttributeRun)) return false;
    } else if (aVal !== bVal) {
      return false;
    }
  }

  return true;
}
