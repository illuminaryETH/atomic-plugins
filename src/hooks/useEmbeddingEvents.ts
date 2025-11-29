import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAtomsStore } from '../stores/atoms';
import { useTagsStore } from '../stores/tags';
import { useUIStore } from '../stores/ui';
import type { AtomWithTags } from '../stores/atoms';

interface EmbeddingCompletePayload {
  atom_id: string;
  status: 'complete' | 'failed';
  error?: string;
  tags_extracted: string[];
  new_tags_created: string[];
}

export function useEmbeddingEvents() {
  const updateAtomStatus = useAtomsStore((s) => s.updateAtomStatus);
  const fetchTags = useTagsStore((s) => s.fetchTags);
  const fetchAtoms = useAtomsStore((s) => s.fetchAtoms);
  const addAtomToStore = useAtomsStore((s) => s.addAtom);
  const addLoadingOperation = useUIStore((s) => s.addLoadingOperation);
  const removeLoadingOperation = useUIStore((s) => s.removeLoadingOperation);

  useEffect(() => {
    // Listen for atom-created events (from HTTP API / browser extension)
    const unlistenAtomCreated = listen<AtomWithTags>('atom-created', (event) => {
      console.log('Atom created via HTTP API:', event.payload);
      addAtomToStore(event.payload);
    });

    // Listen for embedding-complete events
    const unlistenEmbeddingComplete = listen<EmbeddingCompletePayload>('embedding-complete', (event) => {
      console.log('Embedding complete event:', event.payload);
      updateAtomStatus(event.payload.atom_id, event.payload.status);

      // If new tags were created, refresh the tag tree
      if (event.payload.new_tags_created && event.payload.new_tags_created.length > 0) {
        console.log('New tags created:', event.payload.new_tags_created);
        const opId = `fetch-tags-${Date.now()}`;
        addLoadingOperation(opId, 'Refreshing tags...');
        fetchTags().finally(() => removeLoadingOperation(opId));
      }

      // If tags were extracted, refresh atoms to show updated tags
      if (event.payload.tags_extracted && event.payload.tags_extracted.length > 0) {
        console.log('Tags extracted:', event.payload.tags_extracted);
        const opId = `fetch-atoms-${Date.now()}`;
        addLoadingOperation(opId, 'Updating atoms...');
        fetchAtoms().finally(() => removeLoadingOperation(opId));
      }
    });

    return () => {
      unlistenAtomCreated.then(fn => fn());
      unlistenEmbeddingComplete.then(fn => fn());
    };
  }, [updateAtomStatus, fetchTags, fetchAtoms, addAtomToStore, addLoadingOperation, removeLoadingOperation]);
}

