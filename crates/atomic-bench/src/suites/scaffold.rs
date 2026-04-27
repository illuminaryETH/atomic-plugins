use anyhow::Result;

use crate::dataset::BenchDataset;
use crate::report::{JsonlReporter, MetricRecord, RunContext};

pub fn emit_scaffold(
    ctx: &RunContext,
    dataset: &BenchDataset,
    reporter: &mut JsonlReporter,
    layer: &'static str,
    planned_metrics: &[&'static str],
) -> Result<()> {
    reporter.emit(
        &MetricRecord::new(ctx, "suite.scaffold_ready", 1.0, "bool")
            .with_label("measurement_layer", layer),
    )?;
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "dataset.atoms_total",
            dataset.atoms.len() as f64,
            "count",
        )
        .with_label("measurement_layer", layer),
    )?;
    reporter.emit(
        &MetricRecord::new(
            ctx,
            "dataset.queries_total",
            dataset.queries.len() as f64,
            "count",
        )
        .with_label("measurement_layer", layer),
    )?;

    for metric in planned_metrics {
        reporter.emit(
            &MetricRecord::new(ctx, "suite.planned_metric", 1.0, "bool")
                .with_label("measurement_layer", layer)
                .with_label("metric", *metric),
        )?;
    }

    Ok(())
}
