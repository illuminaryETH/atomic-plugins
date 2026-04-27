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
        "graph_canvas",
        &[
            "graph.edge_precision",
            "graph.edge_recall",
            "graph.cluster_purity",
            "graph.global_question_accuracy",
            "canvas.compute_ms",
            "canvas.nodes_total",
            "canvas.edges_total",
        ],
    )
}
