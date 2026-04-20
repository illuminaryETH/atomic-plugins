//! End-to-end pipeline tests.
//!
//! One atom creation → chunk → embed (via mock HTTP) → build semantic edges
//! → auto-tag (via mock HTTP). Verifies every persisted artifact at the end.
//!
//! The same test body runs against both storage backends:
//!   - SQLite: always runs (uses a tempfile DB).
//!   - Postgres: runs only when `ATOMIC_TEST_DATABASE_URL` is set and the
//!     `postgres` feature is on.

mod support;

use atomic_core::{AtomicCore, CreateAtomRequest, UpdateAtomRequest};
use support::{
    await_pipeline, event_collector, setup_core, Backend, MockAiServer,
    EDGE_SIMILARITY_THRESHOLD,
};

#[tokio::test]
async fn full_pipeline_sqlite() {
    run_full_pipeline(Backend::Sqlite).await;
}

#[cfg(feature = "postgres")]
#[tokio::test]
async fn full_pipeline_postgres() {
    if std::env::var("ATOMIC_TEST_DATABASE_URL").is_err() {
        eprintln!("full_pipeline_postgres: skipping (ATOMIC_TEST_DATABASE_URL not set)");
        return;
    }
    run_full_pipeline(Backend::Postgres).await;
}

async fn run_full_pipeline(backend: Backend) {
    let mock = MockAiServer::start().await;
    let handle = setup_core(backend, &mock.base_url())
        .await
        .expect("test harness setup");
    let core = &handle.core;

    // Two atoms sharing most vocabulary. The bag-of-words mock embedder
    // lands them at overlapping positions so their cosine similarity clears
    // the 0.5 edge threshold. Keep both short so they produce a single
    // chunk each — simplifies assertions and keeps the request count
    // predictable.
    let atom_a = create_and_await(
        core,
        "quantum mechanics is the study of particles and waves at atomic scales",
    )
    .await;
    let atom_b = create_and_await(
        core,
        "quantum physics explores particles waves and the strange behavior of atomic systems",
    )
    .await;

    // --- Embedding phase: status flipped to complete on both atoms ---
    let fetched_a = core.get_atom(&atom_a).await.unwrap().expect("atom_a persisted");
    let fetched_b = core.get_atom(&atom_b).await.unwrap().expect("atom_b persisted");
    assert_eq!(
        fetched_a.atom.embedding_status, "complete",
        "atom_a embedding should be complete"
    );
    assert_eq!(
        fetched_b.atom.embedding_status, "complete",
        "atom_b embedding should be complete"
    );

    // --- Tagging phase: the mock returned Physics→Topics, and the pipeline
    // wired the extracted tag up to the atom. The tag row must also carry
    // the correct parent linkage.
    assert!(
        !fetched_a.tags.is_empty(),
        "atom_a should have at least one tag after tagging: {:?}",
        fetched_a.tags
    );
    let physics_tag = fetched_a
        .tags
        .iter()
        .find(|t| t.name == "Physics")
        .expect("expected a Physics tag applied to atom_a");
    let topics = core
        .get_all_tags()
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.tag.name == "Topics")
        .expect("Topics category should exist");
    assert_eq!(
        physics_tag.parent_id,
        Some(topics.tag.id.clone()),
        "Physics should hang off Topics, got parent_id {:?}",
        physics_tag.parent_id
    );

    // --- Semantic edge phase: an edge between A and B crosses the 0.5
    // threshold. With B created second, the edge is stored source=B→A.
    let edges = core
        .get_semantic_edges(EDGE_SIMILARITY_THRESHOLD)
        .await
        .unwrap();
    let edge = edges.iter().find(|e| {
        (e.source_atom_id == atom_a && e.target_atom_id == atom_b)
            || (e.source_atom_id == atom_b && e.target_atom_id == atom_a)
    });
    let edge = edge.unwrap_or_else(|| {
        panic!(
            "expected a semantic edge between atom_a ({atom_a}) and atom_b ({atom_b}); \
             got {} edges total: {:?}",
            edges.len(),
            edges
        )
    });
    assert!(
        edge.similarity_score >= EDGE_SIMILARITY_THRESHOLD,
        "edge similarity should clear the threshold, got {}",
        edge.similarity_score
    );
}

async fn create_and_await(core: &AtomicCore, content: &str) -> String {
    let (cb, mut rx) = event_collector();
    let created = core
        .create_atom(
            CreateAtomRequest {
                content: content.to_string(),
                ..Default::default()
            },
            cb,
        )
        .await
        .expect("create_atom")
        .expect("atom was inserted (not skipped)");
    await_pipeline(&mut rx, &created.atom.id).await;
    created.atom.id
}

// ==================== Update lifecycle ====================

#[tokio::test]
async fn update_lifecycle_sqlite() {
    run_update_lifecycle(Backend::Sqlite).await;
}

#[cfg(feature = "postgres")]
#[tokio::test]
async fn update_lifecycle_postgres() {
    if std::env::var("ATOMIC_TEST_DATABASE_URL").is_err() {
        eprintln!("update_lifecycle_postgres: skipping (ATOMIC_TEST_DATABASE_URL not set)");
        return;
    }
    run_update_lifecycle(Backend::Postgres).await;
}

/// Editing an atom's content must re-run both halves of the pipeline:
/// embeddings/chunks/edges and auto-tagging. This test swaps vocabulary
/// completely, verifies the old semantic edge disappears, and proves the
/// tagger actually ran again by expecting a new content-derived tag.
async fn run_update_lifecycle(backend: Backend) {
    let mock = MockAiServer::start().await;
    let handle = setup_core(backend, &mock.base_url())
        .await
        .expect("test harness setup");
    let core = &handle.core;

    // Vocabulary A — atoms a and b land near each other.
    let a = create_and_await(core, "quantum mechanics particles waves atomic scales").await;
    let b = create_and_await(core, "quantum waves physics atomic particles systems").await;

    // Sanity: edge exists before update so the delete-after-update
    // assertion is actually meaningful.
    let initial_edges = core
        .get_semantic_edges(EDGE_SIMILARITY_THRESHOLD)
        .await
        .unwrap();
    assert!(
        initial_edges.iter().any(|e| involves(e, &a, &b)),
        "expected edge between a and b before update; got {:?}",
        initial_edges
    );

    // Replace a's content with disjoint vocabulary. The bag-of-words embedder
    // will place it far from b, so the old edge must be cleaned up.
    let (cb, mut rx) = event_collector();
    let new_content = "biology cells organisms dna evolution".to_string();
    core.update_atom(
        &a,
        UpdateAtomRequest {
            content: new_content.clone(),
            source_url: None,
            published_at: None,
            tag_ids: None,
        },
        cb,
    )
    .await
    .expect("update_atom");
    await_pipeline(&mut rx, &a).await;

    let a_after = core.get_atom(&a).await.unwrap().expect("a still exists");
    assert_eq!(a_after.atom.content, new_content);
    assert_eq!(a_after.atom.embedding_status, "complete");
    assert_eq!(a_after.atom.tagging_status, "complete");
    assert!(
        a_after.tags.iter().any(|t| t.name == "Physics"),
        "tags should be preserved across update; got {:?}",
        a_after.tags
    );
    assert!(
        a_after.tags.iter().any(|t| t.name == "Biology"),
        "updated content should trigger a fresh tagging pass; got {:?}",
        a_after.tags
    );

    let edges_after = core
        .get_semantic_edges(EDGE_SIMILARITY_THRESHOLD)
        .await
        .unwrap();
    assert!(
        !edges_after
            .iter()
            .any(|e| e.source_atom_id == a || e.target_atom_id == a),
        "no edges should reference a after its vocabulary swap; got {:?}",
        edges_after
    );
}

#[tokio::test]
async fn draft_save_then_finalize_sqlite() {
    run_draft_save_then_finalize(Backend::Sqlite).await;
}

#[cfg(feature = "postgres")]
#[tokio::test]
async fn draft_save_then_finalize_postgres() {
    if std::env::var("ATOMIC_TEST_DATABASE_URL").is_err() {
        eprintln!("draft_save_then_finalize_postgres: skipping (ATOMIC_TEST_DATABASE_URL not set)");
        return;
    }
    run_draft_save_then_finalize(Backend::Postgres).await;
}

async fn run_draft_save_then_finalize(backend: Backend) {
    let mock = MockAiServer::start().await;
    let handle = setup_core(backend, &mock.base_url())
        .await
        .expect("test harness setup");
    let core = &handle.core;

    let atom_id = create_and_await(core, "quantum mechanics particles waves atomic scales").await;

    core.update_atom_content_only(
        &atom_id,
        UpdateAtomRequest {
            content: "biology cells organisms dna evolution".to_string(),
            source_url: None,
            published_at: None,
            tag_ids: None,
        },
    )
    .await
    .expect("draft save should succeed");

    let after_draft = core.get_atom(&atom_id).await.unwrap().expect("atom exists");
    assert_eq!(after_draft.atom.embedding_status, "pending");
    assert_eq!(after_draft.atom.tagging_status, "pending");

    let (cb, mut rx) = event_collector();
    core.process_atom_pipeline(&atom_id, cb)
        .await
        .expect("finalize pipeline");
    await_pipeline(&mut rx, &atom_id).await;

    let finalized = core.get_atom(&atom_id).await.unwrap().expect("atom exists");
    assert_eq!(finalized.atom.embedding_status, "complete");
    assert_eq!(finalized.atom.tagging_status, "complete");
    assert!(
        finalized.tags.iter().any(|t| t.name == "Biology"),
        "finalized draft should have fresh biology tag: {:?}",
        finalized.tags
    );
}

// ==================== Delete cascade ====================

#[tokio::test]
async fn delete_cascade_sqlite() {
    run_delete_cascade(Backend::Sqlite).await;
}

#[cfg(feature = "postgres")]
#[tokio::test]
async fn delete_cascade_postgres() {
    if std::env::var("ATOMIC_TEST_DATABASE_URL").is_err() {
        eprintln!("delete_cascade_postgres: skipping (ATOMIC_TEST_DATABASE_URL not set)");
        return;
    }
    run_delete_cascade(Backend::Postgres).await;
}

/// Deleting an atom must cascade: the atom row, its chunk/embedding rows, and
/// every semantic edge it participates in. Tags survive — they're shared
/// state and may be attached to other atoms.
async fn run_delete_cascade(backend: Backend) {
    let mock = MockAiServer::start().await;
    let handle = setup_core(backend, &mock.base_url())
        .await
        .expect("test harness setup");
    let core = &handle.core;

    let a = create_and_await(core, "apple banana cherry mango lychee").await;
    let b = create_and_await(core, "apple banana cherry dragonfruit lychee").await;

    // Capture the Physics tag id off one of the atoms before deletion so we
    // can check the tag row itself survives. `get_all_tags` only returns
    // top-level rows with children nested inside — simpler to grab the
    // applied tag straight from the atom.
    let a_before = core.get_atom(&a).await.unwrap().expect("a persisted");
    let physics_id = a_before
        .tags
        .iter()
        .find(|t| t.name == "Physics")
        .expect("Physics tag should be applied to a")
        .id
        .clone();

    let initial_edges = core
        .get_semantic_edges(EDGE_SIMILARITY_THRESHOLD)
        .await
        .unwrap();
    assert!(
        initial_edges.iter().any(|e| involves(e, &a, &b)),
        "expected edge between a and b before delete; got {:?}",
        initial_edges
    );

    core.delete_atom(&a).await.expect("delete_atom");

    // Atom row gone; other atoms untouched.
    assert!(core.get_atom(&a).await.unwrap().is_none(), "a should be gone");
    assert!(
        core.get_atom(&b).await.unwrap().is_some(),
        "b should survive deletion of a"
    );

    // Edges referencing a are cascaded out on both sides of the relation.
    let edges_after = core
        .get_semantic_edges(EDGE_SIMILARITY_THRESHOLD)
        .await
        .unwrap();
    assert!(
        !edges_after
            .iter()
            .any(|e| e.source_atom_id == a || e.target_atom_id == a),
        "no edges should reference the deleted atom; got {:?}",
        edges_after
    );

    // Physics tag is shared state — still present, now only linked to b.
    let remaining = core
        .get_atoms_by_tag(&physics_id)
        .await
        .expect("get_atoms_by_tag");
    let ids: Vec<String> = remaining.iter().map(|a| a.atom.id.clone()).collect();
    assert_eq!(
        ids,
        vec![b.clone()],
        "Physics tag should list only b after a is deleted; got {:?}",
        ids
    );
}

fn involves(edge: &atomic_core::SemanticEdge, a: &str, b: &str) -> bool {
    (edge.source_atom_id == a && edge.target_atom_id == b)
        || (edge.source_atom_id == b && edge.target_atom_id == a)
}
