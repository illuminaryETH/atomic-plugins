use std::collections::HashMap;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use atomic_core::{AtomicCore, CreateAtomRequest, EmbeddingEvent};
use tempfile::TempDir;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::dataset::BenchDataset;
use crate::mock_ai::MockAiServer;
use crate::report::{JsonlReporter, MetricRecord, RunContext};

type EventRx = UnboundedReceiver<EmbeddingEvent>;

pub async fn run(
    ctx: &RunContext,
    dataset: &BenchDataset,
    reporter: &mut JsonlReporter,
    keep_db: bool,
) -> Result<()> {
    let run_start = Instant::now();
    let mock = MockAiServer::start().await;
    let tempdir = TempDir::new().context("create benchmark tempdir")?;
    let db_path = tempdir.path().join("atomic-bench.db");
    let core = AtomicCore::open_or_create(&db_path).context("open benchmark database")?;

    configure_core(&core, &mock.base_url()).await?;

    reporter.emit(&MetricRecord::new(
        ctx,
        "dataset.atoms_total",
        dataset.atoms.len() as f64,
        "count",
    ))?;

    let tag_ids = create_fixture_tags(&core, dataset).await?;
    let mut created_atom_ids = Vec::with_capacity(dataset.atoms.len());

    for atom in &dataset.atoms {
        let atom_start = Instant::now();
        let (on_event, mut rx) = event_collector();
        let created = core
            .create_atom(
                CreateAtomRequest {
                    content: atom.content.clone(),
                    source_url: atom.source_url.clone(),
                    tag_ids: atom
                        .tags
                        .iter()
                        .filter_map(|name| tag_ids.get(name).cloned())
                        .collect(),
                    ..Default::default()
                },
                on_event,
            )
            .await
            .context("create atom")?
            .ok_or_else(|| anyhow!("atom creation was unexpectedly skipped"))?;

        await_pipeline(&mut rx, &created.atom.id).await?;
        created_atom_ids.push(created.atom.id.clone());

        reporter.emit(
            &MetricRecord::new(
                ctx,
                "pipeline.atom_complete_ms",
                atom_start.elapsed().as_secs_f64() * 1000.0,
                "ms",
            )
            .with_label("fixture_atom_id", &atom.id)
            .with_label("atom_id", &created.atom.id),
        )?;
    }

    let graph_start = Instant::now();
    core.process_graph_maintenance()
        .await
        .context("process graph maintenance")?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "graph.maintenance_ms",
        graph_start.elapsed().as_secs_f64() * 1000.0,
        "ms",
    ))?;

    let status = core
        .get_pipeline_status()
        .await
        .context("get pipeline status")?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "pipeline.embedding_complete",
        status.complete as f64,
        "count",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "pipeline.embedding_failed",
        status.failed_count as f64,
        "count",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "pipeline.tagging_complete",
        status.tagging_complete as f64,
        "count",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "pipeline.tagging_failed",
        status.tagging_failed_count as f64,
        "count",
    ))?;

    let edges = core
        .get_semantic_edges(0.3)
        .await
        .context("get semantic edges")?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "graph.semantic_edges_total",
        edges.len() as f64,
        "count",
    ))?;

    let canvas_start = Instant::now();
    let canvas = core
        .compute_and_get_canvas_data()
        .await
        .context("compute canvas data")?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "canvas.compute_ms",
        canvas_start.elapsed().as_secs_f64() * 1000.0,
        "ms",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "canvas.nodes_total",
        canvas.atoms.len() as f64,
        "count",
    ))?;

    reporter.emit(&MetricRecord::new(
        ctx,
        "provider.embedding_requests_total",
        mock.embedding_request_count() as f64,
        "count",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "provider.chat_requests_total",
        mock.chat_request_count() as f64,
        "count",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "run.duration_ms",
        run_start.elapsed().as_secs_f64() * 1000.0,
        "ms",
    ))?;

    if keep_db {
        reporter.emit(
            &MetricRecord::new(ctx, "run.kept_database", 1.0, "bool")
                .with_label("path", db_path.display().to_string()),
        )?;
        std::mem::forget(tempdir);
    }

    Ok(())
}

async fn configure_core(core: &AtomicCore, mock_url: &str) -> Result<()> {
    for (key, value) in [
        ("provider", "openai_compat"),
        ("openai_compat_base_url", mock_url),
        ("openai_compat_api_key", "atomic-bench"),
        ("openai_compat_embedding_model", "mock-embed"),
        ("openai_compat_llm_model", "mock-llm"),
        ("openai_compat_embedding_dimension", "1536"),
        ("auto_tagging_enabled", "true"),
    ] {
        core.set_setting(key, value).await?;
    }

    core.configure_autotag_targets(&["Topics".to_string()], &[])
        .await?;
    Ok(())
}

async fn create_fixture_tags(
    core: &AtomicCore,
    dataset: &BenchDataset,
) -> Result<HashMap<String, String>> {
    let mut tag_ids = HashMap::new();
    for atom in &dataset.atoms {
        for tag in &atom.tags {
            if tag_ids.contains_key(tag) {
                continue;
            }
            let created = core.create_tag(tag, None).await?;
            tag_ids.insert(tag.clone(), created.id);
        }
    }
    Ok(tag_ids)
}

fn event_collector() -> (
    impl Fn(EmbeddingEvent) + Send + Sync + Clone + 'static,
    EventRx,
) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let tx = std::sync::Arc::new(tx);
    let cb = move |event| {
        let _ = tx.send(event);
    };
    (cb, rx)
}

async fn await_pipeline(rx: &mut EventRx, atom_id: &str) -> Result<()> {
    let mut embedding_done = false;
    let mut tagging_done = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);

    while !(embedding_done && tagging_done) {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(anyhow!("pipeline timed out for atom {atom_id}"));
        }

        let event = tokio::time::timeout(remaining, rx.recv())
            .await
            .context("wait for pipeline event")?
            .ok_or_else(|| anyhow!("pipeline event channel closed for atom {atom_id}"))?;

        match event {
            EmbeddingEvent::EmbeddingComplete { atom_id: id } if id == atom_id => {
                embedding_done = true;
            }
            EmbeddingEvent::EmbeddingFailed { atom_id: id, error } if id == atom_id => {
                return Err(anyhow!("embedding failed for atom {id}: {error}"));
            }
            EmbeddingEvent::TaggingComplete { atom_id: id, .. }
            | EmbeddingEvent::TaggingSkipped { atom_id: id }
                if id == atom_id =>
            {
                tagging_done = true;
            }
            EmbeddingEvent::TaggingFailed { atom_id: id, error } if id == atom_id => {
                return Err(anyhow!("tagging failed for atom {id}: {error}"));
            }
            _ => {}
        }
    }

    Ok(())
}
