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
        "rag_chat",
        &[
            "rag.answer_correctness",
            "rag.faithfulness",
            "rag.answer_relevance",
            "rag.citation_precision",
            "rag.citation_recall",
            "agent.tool_call_f1",
            "agent.abstention_accuracy",
        ],
    )
}
