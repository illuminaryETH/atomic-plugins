use anyhow::Result;

use crate::dataset::BenchDataset;
use crate::report::{JsonlReporter, RunContext};

pub async fn run(
    ctx: &RunContext,
    dataset: &BenchDataset,
    reporter: &mut JsonlReporter,
) -> Result<()> {
    super::scaffold::emit_scaffold(
        ctx,
        dataset,
        reporter,
        "retrieval",
        &[
            "retrieval.recall_at_k",
            "retrieval.precision_at_k",
            "retrieval.mrr",
            "retrieval.ndcg_at_k",
            "retrieval.latency_ms",
            "retrieval.embedding_requests_total",
        ],
    )
}
