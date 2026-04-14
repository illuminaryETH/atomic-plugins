import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Root } from 'protobufjs';
import { descriptor } from './apple-notes/descriptor';
import { NoteConverter } from './apple-notes/convert-note';
import {
  AppleNotesImportError,
  buildFolderHierarchy,
  importAppleNotesWithDeps,
  type AppleNotesAccount,
  type AppleNotesData,
  type AppleNotesDeps,
  type AppleNotesFolder,
  type AppleNotesImportProgress,
  type AppleNotesNote,
} from './import-apple-notes';

const protoRoot = Root.fromJSON(descriptor);
const DocumentType = protoRoot.lookupType(NoteConverter.protobufType);

/**
 * Encode a tiny Apple Notes document proto into raw bytes and return it
 * base64-encoded (matches the shape the Rust backend returns).
 */
function encodeNote(noteText: string): string {
  const attr = { length: noteText.length };
  const message = DocumentType.create({
    name: 'n',
    note: { noteText, attributeRun: [attr], version: 1 },
  });
  const bytes = DocumentType.encode(message).finish();
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function note(overrides: Partial<AppleNotesNote> = {}): AppleNotesNote {
  return {
    pk: 1,
    identifier: 'uuid-1',
    title: 'Title',
    folderPk: 100,
    creationDate: 1_700_000_000_000,
    modificationDate: 1_700_000_001_000,
    isPasswordProtected: false,
    protobufBase64: encodeNote('Title\nhello body content'),
    ...overrides,
  };
}

function folder(overrides: Partial<AppleNotesFolder> = {}): AppleNotesFolder {
  return {
    pk: 100,
    title: 'Notes',
    parentPk: null,
    accountPk: 10,
    identifier: 'DefaultFolder-CloudKit',
    folderType: 0,
    ...overrides,
  };
}

function account(overrides: Partial<AppleNotesAccount> = {}): AppleNotesAccount {
  return { pk: 10, name: 'iCloud', uuid: 'acct-uuid', ...overrides };
}

function makeDeps(data: AppleNotesData): AppleNotesDeps & {
  createCalls: { atoms: unknown[] }[];
  tagCalls: { folderTags: unknown[]; flat: unknown[] }[];
} {
  const createCalls: { atoms: unknown[] }[] = [];
  const tagCalls: { folderTags: unknown[]; flat: unknown[] }[] = [];
  let tagCounter = 0;
  return {
    readAppleNotes: async () => data,
    bulkCreate: async (atoms) => {
      createCalls.push({ atoms });
      return { atoms: [], count: atoms.length, skipped: 0 };
    },
    resolveTags: async (folderTags, flat) => {
      tagCalls.push({ folderTags, flat });
      return folderTags.map(() => {
        tagCounter++;
        return `tag-${tagCounter}`;
      });
    },
    createCalls,
    tagCalls,
  };
}


beforeEach(() => {
  vi.restoreAllMocks();
});

describe('buildFolderHierarchy', () => {
  const accountsByPk = new Map([[10, account()]]);

  it('returns empty when the folder is the implicit DefaultFolder', () => {
    const folders = [folder({ pk: 100, identifier: 'DefaultFolder-xyz' })];
    expect(buildFolderHierarchy(100, folders, accountsByPk, false)).toEqual([]);
  });

  it('walks parent chain and returns a leaf tag', () => {
    const folders = [
      folder({ pk: 1, title: 'Projects', identifier: 'A', parentPk: null }),
      folder({ pk: 2, title: 'Work', identifier: 'B', parentPk: 1 }),
      folder({ pk: 3, title: 'Tasks', identifier: 'C', parentPk: 2 }),
    ];
    const result = buildFolderHierarchy(3, folders, accountsByPk, false);
    expect(result).toEqual([{ name: 'Tasks', parentPath: ['Projects', 'Work'] }]);
  });

  it('prepends account name when multi-account', () => {
    const folders = [folder({ pk: 1, title: 'Ideas', identifier: 'A', parentPk: null })];
    const result = buildFolderHierarchy(1, folders, accountsByPk, true);
    expect(result).toEqual([{ name: 'Ideas', parentPath: ['iCloud'] }]);
  });
});

describe('importAppleNotesWithDeps', () => {
  it('imports a simple note and reports counts', async () => {
    const data: AppleNotesData = {
      accounts: [account()],
      folders: [folder()],
      notes: [note()],
    };
    const deps = makeDeps(data);
    const result = await importAppleNotesWithDeps({}, deps);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(deps.createCalls).toHaveLength(1);
    const atoms = deps.createCalls[0].atoms as {
      content: string;
      sourceUrl: string;
      skipIfSourceExists: boolean;
    }[];
    expect(atoms).toHaveLength(1);
    expect(atoms[0].sourceUrl).toBe('applenotes:note/UUID-1?ownerIdentifier=acct-uuid');
    expect(atoms[0].skipIfSourceExists).toBe(true);
    expect(atoms[0].content.startsWith('# ')).toBe(true);
  });

  it('skips password-protected notes', async () => {
    const data: AppleNotesData = {
      accounts: [account()],
      folders: [folder()],
      notes: [note({ isPasswordProtected: true, protobufBase64: null })],
    };
    const deps = makeDeps(data);
    const result = await importAppleNotesWithDeps({}, deps);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(deps.createCalls).toHaveLength(0);
  });

  it('skips notes in trash folders unless importTrashed is set', async () => {
    const trashFolder = folder({ pk: 200, identifier: 'Trash', folderType: 1 });
    const data: AppleNotesData = {
      accounts: [account()],
      folders: [trashFolder],
      notes: [note({ folderPk: 200 })],
    };

    const skipped = await importAppleNotesWithDeps({}, makeDeps(data));
    expect(skipped.imported).toBe(0);
    expect(skipped.skipped).toBe(1);

    const kept = await importAppleNotesWithDeps({ importTrashed: true }, makeDeps(data));
    expect(kept.imported).toBe(1);
  });

  it('skips smart folders regardless of options', async () => {
    const smart = folder({ pk: 300, identifier: 'Smart', folderType: 3 });
    const data: AppleNotesData = {
      accounts: [account()],
      folders: [smart],
      notes: [note({ folderPk: 300 })],
    };
    const result = await importAppleNotesWithDeps({ importTrashed: true }, makeDeps(data));
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('records protobuf-decompression failures as errors, not skips', async () => {
    const data: AppleNotesData = {
      accounts: [account()],
      folders: [folder()],
      notes: [note({ protobufBase64: null })],
    };
    const result = await importAppleNotesWithDeps({}, makeDeps(data));
    expect(result.imported).toBe(0);
    expect(result.errors).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('calls resolveTags with a folder hierarchy when importTags is on', async () => {
    const folders = [
      folder({ pk: 1, title: 'Projects', identifier: 'A', parentPk: null }),
      folder({ pk: 2, title: 'Work', identifier: 'B', parentPk: 1 }),
    ];
    const data: AppleNotesData = {
      accounts: [account()],
      folders,
      notes: [note({ folderPk: 2 })],
    };
    const deps = makeDeps(data);
    await importAppleNotesWithDeps({ importTags: true }, deps);
    expect(deps.tagCalls).toHaveLength(1);
    expect(deps.tagCalls[0].folderTags).toEqual([
      { name: 'Work', parentPath: ['Projects'] },
    ]);
  });

  it('emits progress events for each note', async () => {
    const data: AppleNotesData = {
      accounts: [account()],
      folders: [folder()],
      notes: [note({ pk: 1, title: 'A' }), note({ pk: 2, title: 'B' })],
    };
    const progress: AppleNotesImportProgress[] = [];
    await importAppleNotesWithDeps(
      { onProgress: (p) => progress.push({ ...p }) },
      makeDeps(data),
    );
    const importingEvents = progress.filter((p) => p.status === 'importing');
    const files = importingEvents.map((p) => p.currentFile);
    expect(files).toContain('A');
    expect(files).toContain('B');
  });

  it('surfaces readAppleNotes errors to the caller', async () => {
    const deps: AppleNotesDeps = {
      readAppleNotes: async () => {
        throw new AppleNotesImportError('permissionDenied', 'nope');
      },
      bulkCreate: async () => ({ atoms: [], count: 0, skipped: 0 }),
      resolveTags: async () => [],
    };
    await expect(importAppleNotesWithDeps({}, deps)).rejects.toBeInstanceOf(AppleNotesImportError);
  });

  it('batches bulk creates in groups of 50', async () => {
    const notes: AppleNotesNote[] = [];
    for (let i = 1; i <= 120; i++) notes.push(note({ pk: i, title: `n${i}` }));
    const data: AppleNotesData = {
      accounts: [account()],
      folders: [folder()],
      notes,
    };
    const deps = makeDeps(data);
    const result = await importAppleNotesWithDeps({}, deps);
    expect(result.imported).toBe(120);
    expect(deps.createCalls).toHaveLength(3);
    expect((deps.createCalls[0].atoms as unknown[]).length).toBe(50);
    expect((deps.createCalls[1].atoms as unknown[]).length).toBe(50);
    expect((deps.createCalls[2].atoms as unknown[]).length).toBe(20);
  });
});
