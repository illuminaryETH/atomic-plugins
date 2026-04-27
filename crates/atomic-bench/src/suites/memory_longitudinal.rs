use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use atomic_core::{AtomicCore, CreateAtomRequest, EmbeddingEvent, SearchMode, SearchOptions};
use serde::Deserialize;
use serde_json::Value;
use tempfile::TempDir;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::dataset::BenchDataset;
use crate::mock_ai::MockAiServer;
use crate::report::{JsonlReporter, MetricRecord, RunContext};
use crate::runner::{BenchAiConfig, BenchProvider};

type EventRx = UnboundedReceiver<EmbeddingEvent>;

#[derive(Debug, Clone)]
pub struct LongMemEvalDataset {
    pub id: String,
    pub instances: Vec<LongMemEvalInstance>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LongMemEvalInstance {
    pub question_id: String,
    pub question_type: String,
    pub question: String,
    pub answer: Value,
    #[serde(default)]
    pub question_date: Option<String>,
    #[serde(default)]
    pub haystack_session_ids: Vec<String>,
    #[serde(default)]
    pub haystack_dates: Vec<String>,
    #[serde(default)]
    pub haystack_sessions: Vec<Vec<LongMemEvalTurn>>,
    #[serde(default)]
    pub answer_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LongMemEvalTurn {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub has_answer: Option<bool>,
}

impl LongMemEvalDataset {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
        let instances: Vec<LongMemEvalInstance> =
            serde_json::from_reader(file).with_context(|| format!("parse {}", path.display()))?;
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("longmemeval")
            .to_string();
        Ok(Self { id, instances })
    }
}

pub async fn run(
    ctx: &RunContext,
    dataset: &BenchDataset,
    reporter: &mut JsonlReporter,
) -> Result<()> {
    super::scaffold::emit_scaffold(
        ctx,
        dataset,
        reporter,
        "personal_memory",
        &[
            "memory.fact_recall",
            "memory.temporal_reasoning_accuracy",
            "memory.knowledge_update_accuracy",
            "memory.multi_note_reasoning_accuracy",
            "memory.abstention_accuracy",
            "memory.context_tokens_per_query",
            "longmemeval.evidence_session_recall_at_k",
            "longmemeval.evidence_session_mrr",
        ],
    )
}

pub async fn run_longmemeval(
    ctx: &RunContext,
    dataset: &LongMemEvalDataset,
    reporter: &mut JsonlReporter,
    keep_db: bool,
    limit: Option<usize>,
    top_k: usize,
    ai_config: &BenchAiConfig,
) -> Result<()> {
    let top_k = top_k.max(1);
    let run_start = Instant::now();
    let ai = BenchAiRuntime::start(ai_config).await?;
    let instances: Vec<_> = dataset
        .instances
        .iter()
        .take(limit.unwrap_or(dataset.instances.len()))
        .collect();

    reporter.emit(&MetricRecord::new(
        ctx,
        "longmemeval.instances_total",
        instances.len() as f64,
        "count",
    ))?;

    let mut non_abstention_count = 0usize;
    let mut abstention_count = 0usize;
    let mut recall_sum = 0.0f64;
    let mut hit_sum = 0.0f64;
    let mut mrr_sum = 0.0f64;
    let mut sessions_ingested = 0usize;

    for instance in instances {
        let result = run_instance(ctx, instance, reporter, &ai, keep_db, top_k).await?;
        sessions_ingested += result.sessions_ingested;

        if instance.is_abstention() {
            abstention_count += 1;
        } else {
            non_abstention_count += 1;
            recall_sum += result.recall_at_k;
            hit_sum += if result.hit_at_k { 1.0 } else { 0.0 };
            mrr_sum += result.mrr;
        }
    }

    let denom = non_abstention_count.max(1) as f64;
    reporter.emit(&MetricRecord::new(
        ctx,
        "longmemeval.non_abstention_questions_total",
        non_abstention_count as f64,
        "count",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "longmemeval.abstention_questions_total",
        abstention_count as f64,
        "count",
    ))?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "longmemeval.sessions_ingested_total",
        sessions_ingested as f64,
        "count",
    ))?;
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "longmemeval.evidence_session_recall_at_k_mean",
            recall_sum / denom,
            "ratio",
        )
        .with_label("k", top_k.to_string()),
    )?;
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "longmemeval.evidence_session_hit_at_k_rate",
            hit_sum / denom,
            "ratio",
        )
        .with_label("k", top_k.to_string()),
    )?;
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "longmemeval.evidence_session_mrr_mean",
            mrr_sum / denom,
            "ratio",
        )
        .with_label("k", top_k.to_string()),
    )?;
    ai.emit_provider_metrics(ctx, reporter)?;
    reporter.emit(&MetricRecord::new(
        ctx,
        "run.duration_ms",
        run_start.elapsed().as_secs_f64() * 1000.0,
        "ms",
    ))?;
    Ok(())
}

struct InstanceResult {
    sessions_ingested: usize,
    recall_at_k: f64,
    hit_at_k: bool,
    mrr: f64,
}

enum BenchAiRuntime {
    Mock(MockAiServer),
    OpenRouter {
        api_key: String,
        embedding_model: String,
        tagging_model: String,
        enable_auto_tagging: bool,
    },
}

impl BenchAiRuntime {
    async fn start(config: &BenchAiConfig) -> Result<Self> {
        match config.provider {
            BenchProvider::Mock => Ok(Self::Mock(MockAiServer::start().await)),
            BenchProvider::OpenRouter => {
                let api_key = config
                    .openrouter_api_key
                    .clone()
                    .filter(|key| !key.trim().is_empty())
                    .ok_or_else(|| {
                        anyhow!(
                            "OpenRouter provider requires --openrouter-api-key or OPENROUTER_API_KEY"
                        )
                    })?;
                Ok(Self::OpenRouter {
                    api_key,
                    embedding_model: config.embedding_model.clone(),
                    tagging_model: config.tagging_model.clone(),
                    enable_auto_tagging: config.enable_auto_tagging,
                })
            }
        }
    }

    fn emit_provider_metrics(&self, ctx: &RunContext, reporter: &mut JsonlReporter) -> Result<()> {
        match self {
            Self::Mock(mock) => {
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
            }
            Self::OpenRouter {
                enable_auto_tagging,
                ..
            } => {
                reporter.emit(&MetricRecord::new(
                    ctx,
                    "provider.openrouter_enabled",
                    1.0,
                    "bool",
                ))?;
                reporter.emit(&MetricRecord::new(
                    ctx,
                    "provider.auto_tagging_enabled",
                    if *enable_auto_tagging { 1.0 } else { 0.0 },
                    "bool",
                ))?;
            }
        }
        Ok(())
    }
}

async fn run_instance(
    ctx: &RunContext,
    instance: &LongMemEvalInstance,
    reporter: &mut JsonlReporter,
    ai: &BenchAiRuntime,
    keep_db: bool,
    top_k: usize,
) -> Result<InstanceResult> {
    let instance_start = Instant::now();
    let tempdir = TempDir::new().context("create LongMemEval tempdir")?;
    let db_path = tempdir.path().join(format!(
        "{}.db",
        sanitize_path_component(&instance.question_id)
    ));
    let core = AtomicCore::open_or_create(&db_path).context("open LongMemEval database")?;
    configure_core(&core, ai).await?;

    let mut atom_to_session = HashMap::new();
    let mut sessions_ingested = 0usize;
    let ingest_start = Instant::now();
    for (idx, turns) in instance.haystack_sessions.iter().enumerate() {
        if turns.is_empty() {
            continue;
        }
        let session_id = instance
            .haystack_session_ids
            .get(idx)
            .cloned()
            .unwrap_or_else(|| format!("session-{idx}"));
        let session_date = instance.haystack_dates.get(idx).cloned();
        let content = render_session_atom(instance, &session_id, session_date.as_deref(), turns);
        let (on_event, mut rx) = event_collector();
        let created = core
            .create_atom(
                CreateAtomRequest {
                    content,
                    source_url: Some(format!(
                        "bench://longmemeval/{}/{}",
                        instance.question_id, session_id
                    )),
                    published_at: session_date,
                    ..Default::default()
                },
                on_event,
            )
            .await
            .context("create LongMemEval session atom")?
            .ok_or_else(|| anyhow!("LongMemEval session atom creation was unexpectedly skipped"))?;
        await_pipeline(&mut rx, &created.atom.id).await?;
        atom_to_session.insert(created.atom.id, session_id);
        sessions_ingested += 1;
    }
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "longmemeval.instance_ingest_ms",
            ingest_start.elapsed().as_secs_f64() * 1000.0,
            "ms",
        )
        .with_label("question_id", &instance.question_id)
        .with_label("question_type", &instance.question_type),
    )?;

    let search_start = Instant::now();
    let results = core
        .search(
            SearchOptions::new(&instance.question, SearchMode::Hybrid, top_k as i32)
                .with_threshold(0.0),
        )
        .await
        .context("search LongMemEval memory")?;
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "longmemeval.instance_search_ms",
            search_start.elapsed().as_secs_f64() * 1000.0,
            "ms",
        )
        .with_label("question_id", &instance.question_id)
        .with_label("question_type", &instance.question_type),
    )?;

    let retrieved_session_ids: Vec<String> = results
        .iter()
        .filter_map(|result| atom_to_session.get(&result.atom.atom.id).cloned())
        .collect();
    let evidence: HashSet<&str> = instance
        .answer_session_ids
        .iter()
        .map(String::as_str)
        .collect();
    let retrieved_evidence = retrieved_session_ids
        .iter()
        .filter(|id| evidence.contains(id.as_str()))
        .count();
    let recall_at_k = if evidence.is_empty() {
        0.0
    } else {
        retrieved_evidence as f64 / evidence.len() as f64
    };
    let first_rank = retrieved_session_ids
        .iter()
        .position(|id| evidence.contains(id.as_str()))
        .map(|idx| idx + 1);
    let mrr = first_rank.map(|rank| 1.0 / rank as f64).unwrap_or(0.0);
    let hit_at_k = first_rank.is_some();

    reporter.emit(
        &MetricRecord::new(
            ctx,
            "longmemeval.evidence_session_recall_at_k",
            recall_at_k,
            "ratio",
        )
        .with_label("question_id", &instance.question_id)
        .with_label("question_type", &instance.question_type)
        .with_label("abstention", instance.is_abstention().to_string())
        .with_label("k", top_k.to_string()),
    )?;
    reporter.emit(
        &MetricRecord::new(ctx, "longmemeval.evidence_session_mrr", mrr, "ratio")
            .with_label("question_id", &instance.question_id)
            .with_label("question_type", &instance.question_type)
            .with_label("abstention", instance.is_abstention().to_string())
            .with_label("k", top_k.to_string()),
    )?;
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "longmemeval.instance_duration_ms",
            instance_start.elapsed().as_secs_f64() * 1000.0,
            "ms",
        )
        .with_label("question_id", &instance.question_id)
        .with_label("question_type", &instance.question_type),
    )?;

    if keep_db {
        reporter.emit(
            &MetricRecord::new(ctx, "run.kept_database", 1.0, "bool")
                .with_label("question_id", &instance.question_id)
                .with_label("path", db_path.display().to_string()),
        )?;
        std::mem::forget(tempdir);
    }

    Ok(InstanceResult {
        sessions_ingested,
        recall_at_k,
        hit_at_k,
        mrr,
    })
}

impl LongMemEvalInstance {
    fn is_abstention(&self) -> bool {
        self.question_id.ends_with("_abs")
    }
}

async fn configure_core(core: &AtomicCore, ai: &BenchAiRuntime) -> Result<()> {
    match ai {
        BenchAiRuntime::Mock(mock) => {
            let mock_url = mock.base_url();
            for (key, value) in [
                ("provider", "openai_compat"),
                ("openai_compat_base_url", mock_url.as_str()),
                ("openai_compat_api_key", "atomic-bench"),
                ("openai_compat_embedding_model", "mock-embed"),
                ("openai_compat_llm_model", "mock-llm"),
                ("openai_compat_embedding_dimension", "1536"),
                ("auto_tagging_enabled", "false"),
            ] {
                core.set_setting(key, value).await?;
            }
        }
        BenchAiRuntime::OpenRouter {
            api_key,
            embedding_model,
            tagging_model,
            enable_auto_tagging,
        } => {
            if embedding_model.trim().is_empty() {
                bail!("embedding model cannot be empty");
            }
            if tagging_model.trim().is_empty() {
                bail!("tagging model cannot be empty");
            }
            for (key, value) in [
                ("provider", "openrouter"),
                ("openrouter_api_key", api_key.as_str()),
                ("embedding_model", embedding_model.as_str()),
                ("tagging_model", tagging_model.as_str()),
                (
                    "auto_tagging_enabled",
                    if *enable_auto_tagging {
                        "true"
                    } else {
                        "false"
                    },
                ),
            ] {
                core.set_setting(key, value).await?;
            }
            if *enable_auto_tagging {
                core.configure_autotag_targets(
                    &[
                        "Topics".to_string(),
                        "People".to_string(),
                        "Locations".to_string(),
                        "Organizations".to_string(),
                        "Events".to_string(),
                    ],
                    &[],
                )
                .await?;
            }
        }
    }
    Ok(())
}

fn render_session_atom(
    instance: &LongMemEvalInstance,
    session_id: &str,
    session_date: Option<&str>,
    turns: &[LongMemEvalTurn],
) -> String {
    let mut content = format!(
        "# LongMemEval Session {}\n\nQuestion ID: {}\nQuestion date: {}\nSession date: {}\n\n",
        session_id,
        instance.question_id,
        instance.question_date.as_deref().unwrap_or("unknown"),
        session_date.unwrap_or("unknown"),
    );
    for turn in turns {
        if turn.has_answer.unwrap_or(false) {
            content.push_str("Evidence turn: true\n\n");
        }
        content.push_str(&format!("## {}\n\n{}\n\n", turn.role, turn.content.trim()));
    }
    content
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

fn sanitize_path_component(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
