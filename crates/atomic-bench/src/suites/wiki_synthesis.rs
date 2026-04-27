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
        "wiki",
        &[
            "wiki.claim_support",
            "wiki.citation_coverage",
            "wiki.source_diversity",
            "wiki.section_completeness",
            "wiki.update_preservation",
            "wiki.unsupported_claim_rate",
        ],
    )
}
