/**
 * Types and enums for Apple Notes protobuf structures.
 * Adapted from obsidian-importer (MIT, Three Planets Software), stripped of
 * Obsidian App/vault dependencies.
 */

import type { Message } from 'protobufjs';

export abstract class ANConverter {
  static protobufType: string;
  abstract format(table?: boolean, parentNoteSourceUrl?: string): Promise<string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ANConverterType<T extends ANConverter> = {
  new (ctx: ConverterContext, x: any): T;
  protobufType: string;
};

/**
 * Passed to every converter. Lets `NoteConverter` look up internal-link
 * destinations and table/scan attachment blobs without depending on the
 * importer class directly.
 */
export interface ConverterContext {
  /** Include OCR-extracted handwriting text alongside drawings. */
  includeHandwriting: boolean;
  /** True when the first line of the note body should be dropped (it's the title). */
  omitFirstLine: boolean;
  /** Decode a hex-encoded, compressed protobuf blob into the requested converter. */
  decodeData<T extends ANConverter>(hexOrBytes: string | Uint8Array, converterType: ANConverterType<T>): T;
  /**
   * Look up a row's data for an inline attachment (hashtag, mention, URL card,
   * table blob, internal link target). Implementations return what the
   * obsidian-importer `database.get` SQL returned — a small record of columns.
   * Returning `null` signals "not found" and the converter will fall back to a
   * placeholder.
   */
  lookupAttachment(identifier: string): Promise<AttachmentLookupResult | null>;
  /** Resolve an Apple Notes internal link (`applenotes:note/<uuid>`) into a wikilink-style target. */
  resolveInternalLinkTitle(identifier: string): Promise<string | null>;
}

export interface AttachmentLookupResult {
  /** Display alt text for hashtag/mention attachments (from `zalttext`). */
  altText?: string;
  /** For internal-link tokens — the identifier the link points at. */
  tokenContentIdentifier?: string;
  /** Hex-encoded blob for table / scan attachments (`zmergeabledata1`). */
  mergeableDataHex?: string;
  /** For URL cards. */
  title?: string;
  urlString?: string;
  /** For drawings/scans we fall back to a placeholder, plus optional OCR text. */
  handwritingSummary?: string;
  /** For arbitrary media — filename is used to generate a placeholder label. */
  filename?: string;
  /** Type UTI string for display in "unknown attachment" placeholder. */
  typeUti?: string;
}

export type ANFragmentPair = {
  attr: ANAttributeRun;
  fragment: string;
};

export enum ANMultiRun {
  None,
  Monospaced,
  Alignment,
  List,
}

export type ANTableUuidMapping = Record<string, number>;

export interface ANDocument extends Message {
  name: string;
  note: ANNote;
}

export interface ANNote extends Message {
  attributeRun: ANAttributeRun[];
  noteText: string;
  version: number;
}

export interface ANAttributeRun extends Message {
  [member: string]: unknown;

  length: number;
  paragraphStyle?: ANParagraphStyle;
  font?: ANFont;
  fontWeight?: ANFontWeight;
  underlined?: boolean;
  strikethrough?: number;
  superscript?: ANBaseline;
  link?: string;
  color?: ANColor;
  attachmentInfo?: ANAttachmentInfo;

  // internal additions, not part of the protobufs
  fragment: string;
  atLineStart: boolean;
}

export interface ANParagraphStyle extends Message {
  styleType?: ANStyleType;
  alignment?: ANAlignment;
  indentAmount?: number;
  checklist?: ANChecklist;
  blockquote?: number;
}

export enum ANStyleType {
  Default = -1,
  Title = 0,
  Heading = 1,
  Subheading = 2,
  Monospaced = 4,
  DottedList = 100,
  DashedList = 101,
  NumberedList = 102,
  Checkbox = 103,
}

export enum ANAlignment {
  Left = 0,
  Centre = 1,
  Right = 2,
  Justify = 3,
}

export interface ANChecklist extends Message {
  done: number;
  uuid: string;
}

export interface ANFont extends Message {
  fontName?: string;
  pointSize?: number;
  fontHints?: number;
}

export enum ANFontWeight {
  Regular = 0,
  Bold = 1,
  Italic = 2,
  BoldItalic = 3,
}

export enum ANBaseline {
  Sub = -1,
  Default = 0,
  Super = 1,
}

export interface ANColor extends Message {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export enum ANFolderType {
  Default = 0,
  Trash = 1,
  Smart = 3,
}

export interface ANAttachmentInfo extends Message {
  attachmentIdentifier: string;
  typeUti: string | ANAttachment;
}

export enum ANAttachment {
  Drawing = 'com.apple.paper',
  DrawingLegacy = 'com.apple.drawing',
  DrawingLegacy2 = 'com.apple.drawing.2',
  Hashtag = 'com.apple.notes.inlinetextattachment.hashtag',
  Mention = 'com.apple.notes.inlinetextattachment.mention',
  InternalLink = 'com.apple.notes.inlinetextattachment.link',
  ModifiedScan = 'com.apple.paper.doc.scan',
  Scan = 'com.apple.notes.gallery',
  Table = 'com.apple.notes.table',
  UrlCard = 'public.url',
}

export interface ANMergableDataProto extends Message {
  mergableDataObject: ANMergeableDataObject;
}

export interface ANMergeableDataObject extends Message {
  mergeableDataObjectData: ANDataStore;
}

export interface ANDataStore extends Message {
  mergeableDataObjectKeyItem: ANTableKey[];
  mergeableDataObjectTypeItem: ANTableType[];
  mergeableDataObjectUuidItem: Uint8Array[];
  mergeableDataObjectEntry: ANTableObject[];
}

export interface ANTableObject extends Message {
  customMap: unknown;
  dictionary: unknown;
  orderedSet: unknown;
  note: ANNote;
}

export enum ANTableKey {
  Identity = 'identity',
  Direction = 'crTableColumnDirection',
  Self = 'self',
  Rows = 'crRows',
  UUIDIndex = 'UUIDIndex',
  Columns = 'crColumns',
  CellColumns = 'cellColumns',
}

export enum ANTableType {
  Number = 'com.apple.CRDT.NSNumber',
  String = 'com.apple.CRDT.NSString',
  Uuid = 'com.apple.CRDT.NSUUID',
  Tuple = 'com.apple.CRDT.CRTuple',
  MultiValueLeast = 'com.apple.CRDT.CRRegisterMultiValueLeast',
  MultiValue = 'com.apple.CRDT.CRRegisterMultiValue',
  Tree = 'com.apple.CRDT.CRTree',
  Node = 'com.apple.CRDT.CRTreeNode',
  Table = 'com.apple.notes.CRTable',
  ICTable = 'com.apple.notes.ICTable',
}
