use std::path::PathBuf;

use anyhow::{bail, Result};
use chrono::Utc;
use clap::ValueEnum;

use crate::dataset::{fingerprint_path, BenchDataset};
use crate::report::{JsonlReporter, RunContext};
use crate::suites;

#[derive(Debug, Clone)]
pub struct RunConfig {
    pub suite: String,
    pub dataset_dir: PathBuf,
    pub output: Option<PathBuf>,
    pub keep_db: bool,
    pub limit: Option<usize>,
    pub top_k: usize,
    pub ai: BenchAiConfig,
}

#[derive(Debug, Clone)]
pub struct BenchAiConfig {
    pub provider: BenchProvider,
    pub openrouter_api_key: Option<String>,
    pub embedding_model: String,
    pub tagging_model: String,
    pub enable_auto_tagging: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum BenchProvider {
    Mock,
    #[value(name = "openrouter", alias = "open-router")]
    OpenRouter,
}

impl Default for BenchAiConfig {
    fn default() -> Self {
        Self {
            provider: BenchProvider::Mock,
            openrouter_api_key: None,
            embedding_model: "openai/text-embedding-3-small".to_string(),
            tagging_model: "openai/gpt-4o-mini".to_string(),
            enable_auto_tagging: false,
        }
    }
}

pub fn list_suites() -> Vec<&'static str> {
    suites::all_suite_names()
}

pub async fn run(config: RunConfig) -> Result<()> {
    let run_id = format!("{}-{}", config.suite, Utc::now().format("%Y%m%d%H%M%S"));
    if !config.dataset_dir.exists() {
        let hint = if config.suite == "memory-longitudinal" {
            " LongMemEval runs accept either an existing cleaned JSON file, e.g. bench/datasets/longmemeval-mini.json, or an existing fixture directory."
        } else {
            " Benchmark fixtures must be existing directories with manifest.json."
        };
        bail!(
            "dataset path does not exist: {}.{}",
            config.dataset_dir.display(),
            hint
        );
    }

    let mut reporter = match &config.output {
        Some(path) => JsonlReporter::file(path)?,
        None => JsonlReporter::stdout(),
    };

    if config.suite == "memory-longitudinal" && config.dataset_dir.is_file() {
        let dataset = suites::memory_longitudinal::LongMemEvalDataset::load(&config.dataset_dir)?;
        let ctx = RunContext {
            run_id,
            started_at: Utc::now(),
            suite: config.suite.clone(),
            dataset_id: dataset.id.clone(),
            dataset_version: "longmemeval-cleaned".to_string(),
            dataset_fingerprint: fingerprint_path(&config.dataset_dir)?,
        };
        return suites::memory_longitudinal::run_longmemeval(
            &ctx,
            &dataset,
            &mut reporter,
            config.keep_db,
            config.limit,
            config.top_k,
            &config.ai,
        )
        .await;
    }

    let dataset = BenchDataset::load(&config.dataset_dir)?;
    let ctx = RunContext {
        run_id,
        started_at: Utc::now(),
        suite: config.suite.clone(),
        dataset_id: dataset.manifest.id.clone(),
        dataset_version: dataset.manifest.version.clone(),
        dataset_fingerprint: dataset.fingerprint.clone(),
    };

    match config.suite.as_str() {
        "pipeline-smoke" => {
            suites::pipeline_smoke::run(&ctx, &dataset, &mut reporter, config.keep_db).await
        }
        "retrieval-mini" => suites::retrieval_mini::run(&ctx, &dataset, &mut reporter).await,
        "rag-chat" => suites::rag_chat::run(&ctx, &dataset, &mut reporter).await,
        "wiki-synthesis" => suites::wiki_synthesis::run(&ctx, &dataset, &mut reporter).await,
        "graph-canvas" => suites::graph_canvas::run(&ctx, &dataset, &mut reporter).await,
        "memory-longitudinal" => {
            suites::memory_longitudinal::run(&ctx, &dataset, &mut reporter).await
        }
        other => {
            bail!("unknown benchmark suite: {other}. Run `atomic-bench list` for available suites")
        }
    }
}
