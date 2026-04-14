/**
 * Apple Notes table (CRDT) → markdown.
 *
 * Adapted from obsidian-importer (MIT, Three Planets Software). The original
 * imported the `Buffer` Node global for hex encoding; we use a plain loop.
 */

import { NoteConverter } from './convert-note';
import {
  ANConverter,
  ANMergableDataProto,
  ANMergeableDataObject,
  ANTableKey,
  ANTableObject,
  ANTableType,
  ANTableUuidMapping,
  type ConverterContext,
} from './models';

export class TableConverter extends ANConverter {
  ctx: ConverterContext;
  table: ANMergeableDataObject;

  keys: ANTableKey[];
  types: ANTableType[];
  uuids: string[];

  objects: ANTableObject[];

  rowCount = 0;
  rowLocations: ANTableUuidMapping = {};

  columnCount = 0;
  columnLocations: ANTableUuidMapping = {};

  static protobufType = 'ciofecaforensics.MergableDataProto';

  constructor(ctx: ConverterContext, proto: ANMergableDataProto) {
    super();
    this.ctx = ctx;
    this.table = proto.mergableDataObject;

    const data = this.table.mergeableDataObjectData;
    this.keys = data.mergeableDataObjectKeyItem;
    this.types = data.mergeableDataObjectTypeItem;
    this.uuids = data.mergeableDataObjectUuidItem.map(uuidToString);
    this.objects = data.mergeableDataObjectEntry;
  }

  async parse(): Promise<string[][] | null> {
    const root = this.objects.find(
      (e) => e.customMap && this.types[(e.customMap as { type: number }).type] === ANTableType.ICTable,
    );
    if (!root) return null;

    let cellData: ANTableObject | null = null;

    for (const entry of (root.customMap as { mapEntry: { key: number; value: { objectIndex: number } }[] }).mapEntry) {
      const object = this.objects[entry.value.objectIndex];

      switch (this.keys[entry.key]) {
        case ANTableKey.Rows:
          [this.rowLocations, this.rowCount] = this.findLocations(object);
          break;
        case ANTableKey.Columns:
          [this.columnLocations, this.columnCount] = this.findLocations(object);
          break;
        case ANTableKey.CellColumns:
          cellData = object;
          break;
      }
    }

    if (!cellData) return null;
    return await this.computeCells(cellData);
  }

  findLocations(object: ANTableObject): [ANTableUuidMapping, number] {
    const ordering: string[] = [];
    const indices: ANTableUuidMapping = {};

    const orderedSet = object.orderedSet as {
      ordering: {
        array: { attachment: { uuid: Uint8Array }[] };
        contents: { element: { key: unknown; value: unknown }[] };
      };
    };

    for (const element of orderedSet.ordering.array.attachment) {
      ordering.push(uuidToString(element.uuid));
    }

    for (const element of orderedSet.ordering.contents.element) {
      const key = this.getTargetUuid(element.key);
      const value = this.getTargetUuid(element.value);
      indices[value] = ordering.indexOf(key);
    }

    return [indices, ordering.length];
  }

  async computeCells(cellData: ANTableObject): Promise<string[][]> {
    const result: string[][] = Array(this.rowCount)
      .fill(0)
      .map(() => Array(this.columnCount).fill(''));

    const dict = cellData.dictionary as {
      element: { key: unknown; value: { objectIndex: number } }[];
    };

    for (const column of dict.element) {
      const columnLocation = this.columnLocations[this.getTargetUuid(column.key)];
      const rowData = this.objects[column.value.objectIndex];
      const rowDict = rowData.dictionary as
        | { element: { key: unknown; value: { objectIndex: number } }[] }
        | undefined;
      if (!rowDict) continue;

      for (const row of rowDict.element) {
        const rowLocation = this.rowLocations[this.getTargetUuid(row.key)];
        const rowContent = this.objects[row.value.objectIndex];
        if (rowLocation === undefined || !rowContent) continue;

        const converter = new NoteConverter(this.ctx, rowContent);
        const cell = await converter.format(true);
        // Escape the characters that would break a markdown table cell.
        result[rowLocation][columnLocation] = cell.replace(/\n/g, '<br>').replace(/\|/g, '&#124;');
      }
    }

    return result;
  }

  async format(): Promise<string> {
    const table = await this.parse();
    if (!table) return '';

    let converted = '\n';
    for (let i = 0; i < table.length; i++) {
      converted += `| ${table[i].join(' | ')} |\n`;
      if (i === 0) converted += `|${' -- |'.repeat(table[0].length)}\n`;
    }
    return converted + '\n';
  }

  getTargetUuid(entry: unknown): string {
    const reference = this.objects[(entry as { objectIndex: number }).objectIndex];
    const uuidIndex = (reference.customMap as {
      mapEntry: { value: { unsignedIntegerValue: number } }[];
    }).mapEntry[0].value.unsignedIntegerValue;
    return this.uuids[uuidIndex];
  }
}

function uuidToString(uuid: Uint8Array): string {
  let s = '';
  for (const byte of uuid) s += byte.toString(16).padStart(2, '0');
  return s;
}
