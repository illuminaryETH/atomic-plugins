import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getTransport } from '../lib/transport';
import { useAtomsStore } from '../stores/atoms';
import { useTagsStore } from '../stores/tags';
import { useUIStore } from '../stores/ui';
import { useEmbeddingProgressStore, phaseKind } from '../stores/embedding-progress';
import type { AtomWithTags } from '../stores/atoms';

// Embedding complete - fast, no tags (just embedding status update)
interface EmbeddingCompletePayload {
  atom_id: string;
  status: 'complete' | 'failed';
  error?: string;
}

// Tagging complete - slower, has tag info
interface TaggingCompletePayload {
  atom_id: string;
  status: 'complete' | 'failed' | 'skipped';
  error?: string;
  tags_extracted: string[];
  new_tags_created: string[];
}

// Embeddings reset - when provider/model changes and all atoms need re-embedding
interface EmbeddingsResetPayload {
  pending_count: number;
  reason: string;
}

// Batch progress - aggregate progress for bulk embedding pipeline
interface BatchProgressPayload {
  batch_id: string;
  phase: string;
  completed: number;
  total: number;
}

const DEBOUNCE_MS = 2000;
const STATUS_BATCH_MS = 500;

export function useEmbeddingEvents() {
  // Batching refs for embedding status updates
  const pendingStatusUpdates = useRef<Array<{atomId: string, status: string}>>([]);
  const statusBatchTimer = useRef<ReturnType<typeof setTimeout>>();

  // Debounce refs for tag/atom refetches
  const needsAtomRefresh = useRef(false);
  const needsTagRefresh = useRef(false);
  const refetchDebounceTimer = useRef<ReturnType<typeof setTimeout>>();

  // Periodic check timer for clearing the progress overlay. Rearmed on every
  // event; on firing it decides whether to clear, keep waiting, or force-clear
  // a stuck pipeline (e.g. a tagging job that never emits its final event).
  const progressCleanupTimer = useRef<ReturnType<typeof setTimeout>>();

  // If counts haven't moved for this long, assume the pipeline is stuck or
  // emitted fewer completion events than atoms and force-clear the overlay
  // so the user isn't staring at "99 / 100" forever.
  const PROGRESS_STALE_MS = 15_000;
  const PROGRESS_CHECK_INTERVAL_MS = 3_000;

  const checkProgressCleanup = () => {
    const { embedding, tagging, clearAll } = useEmbeddingProgressStore.getState();
    if (!embedding && !tagging) return;

    const embeddingSettled = !embedding || embedding.completed >= embedding.pending;
    const taggingSettled = !tagging || tagging.completed >= tagging.pending;
    if (embeddingSettled && taggingSettled) {
      clearAll();
      return;
    }

    const lastActivity = Math.max(
      embedding?.lastUpdatedAt ?? 0,
      tagging?.lastUpdatedAt ?? 0,
    );
    if (Date.now() - lastActivity >= PROGRESS_STALE_MS) {
      clearAll();
      return;
    }

    // Not settled yet and not stale — keep polling.
    progressCleanupTimer.current = setTimeout(checkProgressCleanup, PROGRESS_CHECK_INTERVAL_MS);
  };

  // Schedule a grace-period check. Any event re-arms this, so sequential bulk
  // operations stay visible as one continuous overlay session.
  const schedulePipelineCleanup = () => {
    clearTimeout(progressCleanupTimer.current);
    progressCleanupTimer.current = setTimeout(checkProgressCleanup, PROGRESS_CHECK_INTERVAL_MS);
  };

  // Shared helper: record N new atoms flowing into the pipeline. Always bumps
  // the embedding denominator. Bumps the tagging denominator only if we've
  // already observed tagging activity this session — otherwise the store's
  // `markTaggingSeen` will retroactively catch tagging.pending up to
  // embedding.pending the first time a tagging event lands.
  const recordAtomsEnqueued = (n: number) => {
    if (n <= 0) return;
    const store = useEmbeddingProgressStore.getState();
    store.addPending('embedding', n);
    if (store.taggingSeen) {
      store.addPending('tagging', n);
    }
    schedulePipelineCleanup();
  };

  // Setup event listeners once on mount
  // Use getState() inside callbacks to get latest store functions
  // This avoids re-registering listeners when store state changes
  useEffect(() => {
    const transport = getTransport();

    // Listen for atom-created events (from HTTP API / browser extension).
    // Each event represents one atom entering the embedding pipeline — use
    // these to drive the progress overlay's denominator so bulk imports show
    // the full N upfront instead of ticking up per backend batch.
    const unsubAtomCreated = transport.subscribe<AtomWithTags>('atom-created', (payload) => {
      console.log('Atom created via HTTP API:', payload);
      useAtomsStore.getState().addAtom(payload);
      recordAtomsEnqueued(1);
    });

    // Listen for ingestion-complete events (URL ingest / feed polling)
    // Fetch the full atom by ID since the event only contains the atom_id
    const unsubIngestionComplete = transport.subscribe<{ atom_id: string }>('ingestion-complete', (payload) => {
      transport.invoke('get_atom', { id: payload.atom_id })
        .then((atom) => useAtomsStore.getState().addAtom(atom as AtomWithTags))
        .catch((e: unknown) => console.error('Failed to fetch ingested atom:', e));
      recordAtomsEnqueued(1);
    });

    // Listen for embedding-complete events (fast, embedding only)
    // Batch these: collect status updates and flush every STATUS_BATCH_MS
    const unsubEmbeddingComplete = transport.subscribe<EmbeddingCompletePayload>('embedding-complete', (payload) => {
      if (payload.status === 'failed') {
        toast.error('Embedding failed', { id: 'embedding-failure', description: payload.error });
      }

      // Advance the embedding progress numerator (both 'complete' and 'failed'
      // count as "done" for overlay purposes — the atom has left the pipeline).
      useEmbeddingProgressStore.getState().addCompleted('embedding', 1);
      schedulePipelineCleanup();

      pendingStatusUpdates.current.push({
        atomId: payload.atom_id,
        status: payload.status,
      });

      clearTimeout(statusBatchTimer.current);
      statusBatchTimer.current = setTimeout(() => {
        const updates = pendingStatusUpdates.current;
        if (updates.length > 0) {
          pendingStatusUpdates.current = [];
          useAtomsStore.getState().batchUpdateAtomStatuses(updates);
        }
      }, STATUS_BATCH_MS);
    });

    // Listen for tagging-complete events (slower, has tag info)
    // Debounce these: accumulate and do a single refetch after events settle
    const unsubTaggingComplete = transport.subscribe<TaggingCompletePayload>('tagging-complete', (payload) => {
      if (payload.status === 'failed') {
        console.error(`Tagging failed for atom ${payload.atom_id}:`, payload.error);
        toast.error('Tagging failed', { id: 'tagging-failure', description: payload.error });
      }

      // First tagging event of the session: flip taggingSeen and catch the
      // denominator up to the embedding denominator, so atoms enqueued before
      // we knew tagging was active still get counted. Then advance the
      // numerator (complete/failed/skipped all count as done).
      const progressStore = useEmbeddingProgressStore.getState();
      progressStore.markTaggingSeen();
      progressStore.addCompleted('tagging', 1);
      schedulePipelineCleanup();

      // If new tags were created, we need to refresh the tag tree
      if (payload.new_tags_created && payload.new_tags_created.length > 0) {
        needsTagRefresh.current = true;
      }

      // Always refresh atoms — tagging_status changed on the server
      // (complete, failed, or skipped), even if zero tags were extracted
      needsAtomRefresh.current = true;

      // Reset debounce timer — wait for events to settle before fetching
      clearTimeout(refetchDebounceTimer.current);
      refetchDebounceTimer.current = setTimeout(() => {
        const { addLoadingOperation, removeLoadingOperation } = useUIStore.getState();

        if (needsAtomRefresh.current) {
          needsAtomRefresh.current = false;
          const opId = `fetch-atoms-${Date.now()}`;
          addLoadingOperation(opId, 'Updating atoms...');
          useAtomsStore.getState().fetchAtoms().finally(() => removeLoadingOperation(opId));
        }

        if (needsTagRefresh.current) {
          needsTagRefresh.current = false;
          const opId = `fetch-tags-${Date.now()}`;
          addLoadingOperation(opId, 'Refreshing tags...');
          useTagsStore.getState().fetchTags().finally(() => removeLoadingOperation(opId));
        }
      }, DEBOUNCE_MS);
    });

    // Listen for ingestion failure events
    const unsubIngestionFailed = transport.subscribe<{ request_id: string; url: string; error: string }>('ingestion-failed', (payload) => {
      toast.error('Ingestion failed', { id: `ingestion-failed-${payload.request_id}`, description: `${payload.url}: ${payload.error}` });
    });

    const unsubIngestionFetchFailed = transport.subscribe<{ url: string; request_id: string; error: string }>('ingestion-fetch-failed', (payload) => {
      toast.error('Failed to fetch URL', { id: `fetch-failed-${payload.request_id}`, description: `${payload.url}: ${payload.error}` });
    });

    const unsubFeedPollFailed = transport.subscribe<{ feed_id: string; error: string }>('feed-poll-failed', (payload) => {
      toast.error('Feed poll failed', { id: `feed-poll-failed-${payload.feed_id}`, description: payload.error });
    });

    // Listen for batch progress events (bulk embedding pipeline).
    // Counts (numerator/denominator) are driven by atom-level events; these
    // events are used purely to surface the current phase label (chunking,
    // storing, finalizing, etc.) for whichever kind they apply to.
    const unsubBatchProgress = transport.subscribe<BatchProgressPayload>('batch-progress', (payload) => {
      const kind = phaseKind(payload.phase);
      if (kind) {
        const progressStore = useEmbeddingProgressStore.getState();
        // A `tagging`-phase event is also a signal that tagging is active —
        // flip the flag and catch up the denominator if this is the first one.
        if (kind === 'tagging') {
          progressStore.markTaggingSeen();
        }
        progressStore.setPhase(kind, payload.phase);
        schedulePipelineCleanup();
      }
    });

    // Listen for embeddings-reset events (provider/model change triggers re-embedding)
    const unsubEmbeddingsReset = transport.subscribe<EmbeddingsResetPayload>('embeddings-reset', (payload) => {
      console.log('Embeddings reset event:', payload);
      const { addLoadingOperation, removeLoadingOperation } = useUIStore.getState();
      // Re-fetch atoms to show updated pending status
      const opId = `fetch-atoms-reset-${Date.now()}`;
      addLoadingOperation(opId, `Re-embedding ${payload.pending_count} atoms...`);
      useAtomsStore.getState().fetchAtoms().finally(() => removeLoadingOperation(opId));
    });

    return () => {
      clearTimeout(statusBatchTimer.current);
      clearTimeout(refetchDebounceTimer.current);
      clearTimeout(progressCleanupTimer.current);
      unsubAtomCreated();
      unsubIngestionComplete();
      unsubEmbeddingComplete();
      unsubTaggingComplete();
      unsubIngestionFailed();
      unsubIngestionFetchFailed();
      unsubFeedPollFailed();
      unsubBatchProgress();
      unsubEmbeddingsReset();
    };
  }, []); // Empty deps - only run once on mount
}
