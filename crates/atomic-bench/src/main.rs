use std::path::PathBuf;

use anyhow::Result;
use atomic_bench::runner::{list_suites, BenchAiConfig, BenchProvider, RunConfig};
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "atomic-bench")]
#[command(about = "Run Atomic benchmark suites against reproducible datasets")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// List available benchmark suites.
    List,
    /// Run a benchmark suite.
    Run {
        /// Suite name, e.g. pipeline-smoke.
        #[arg(long)]
        suite: String,
        /// Dataset directory containing manifest.json and JSONL fixture files.
        #[arg(long, default_value = "bench/datasets/atomic-mini")]
        dataset: PathBuf,
        /// Optional JSONL output path. Defaults to stdout.
        #[arg(long)]
        output: Option<PathBuf>,
        /// Keep the temporary SQLite database directory after the run.
        #[arg(long)]
        keep_db: bool,
        /// Limit the number of benchmark instances/questions to run.
        #[arg(long)]
        limit: Option<usize>,
        /// Retrieval cutoff for recall/MRR-style metrics.
        #[arg(long, default_value_t = 10)]
        top_k: usize,
        /// AI provider for suites that exercise Atomic's AI pipeline.
        #[arg(long, value_enum, default_value_t = BenchProvider::Mock)]
        provider: BenchProvider,
        /// OpenRouter API key. Also read from OPENROUTER_API_KEY.
        #[arg(long, env = "OPENROUTER_API_KEY", hide_env_values = true)]
        openrouter_api_key: Option<String>,
        /// Embedding model to configure when --provider openrouter is used.
        #[arg(long, default_value = "openai/text-embedding-3-small")]
        embedding_model: String,
        /// LLM model to configure for tagging/chat-capable paths.
        #[arg(long, default_value = "openai/gpt-4o-mini")]
        tagging_model: String,
        /// Enable Atomic auto-tagging during ingestion, which exercises LLM calls.
        #[arg(long)]
        enable_auto_tagging: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "atomic_bench=info,warn".into()),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::List => {
            for suite in list_suites() {
                println!("{suite}");
            }
        }
        Command::Run {
            suite,
            dataset,
            output,
            keep_db,
            limit,
            top_k,
            provider,
            openrouter_api_key,
            embedding_model,
            tagging_model,
            enable_auto_tagging,
        } => {
            atomic_bench::runner::run(RunConfig {
                suite,
                dataset_dir: dataset,
                output,
                keep_db,
                limit,
                top_k,
                ai: BenchAiConfig {
                    provider,
                    openrouter_api_key,
                    embedding_model,
                    tagging_model,
                    enable_auto_tagging,
                },
            })
            .await?;
        }
    }
    Ok(())
}
