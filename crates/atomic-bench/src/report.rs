use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct RunContext {
    pub run_id: String,
    pub started_at: DateTime<Utc>,
    pub suite: String,
    pub dataset_id: String,
    pub dataset_version: String,
    pub dataset_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MetricRecord {
    pub run_id: String,
    pub timestamp: DateTime<Utc>,
    pub suite: String,
    pub dataset_id: String,
    pub dataset_version: String,
    pub dataset_fingerprint: String,
    pub metric: String,
    pub value: f64,
    pub unit: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub labels: BTreeMap<String, String>,
}

impl MetricRecord {
    pub fn new(
        ctx: &RunContext,
        metric: impl Into<String>,
        value: f64,
        unit: impl Into<String>,
    ) -> Self {
        Self {
            run_id: ctx.run_id.clone(),
            timestamp: Utc::now(),
            suite: ctx.suite.clone(),
            dataset_id: ctx.dataset_id.clone(),
            dataset_version: ctx.dataset_version.clone(),
            dataset_fingerprint: ctx.dataset_fingerprint.clone(),
            metric: metric.into(),
            value,
            unit: unit.into(),
            labels: BTreeMap::new(),
        }
    }

    pub fn with_label(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.labels.insert(key.into(), value.into());
        self
    }
}

pub struct JsonlReporter {
    writer: Box<dyn Write + Send>,
}

impl JsonlReporter {
    pub fn stdout() -> Self {
        Self {
            writer: Box::new(std::io::stdout()),
        }
    }

    pub fn file(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create {}", parent.display()))?;
        }
        let file =
            std::fs::File::create(path).with_context(|| format!("create {}", path.display()))?;
        Ok(Self {
            writer: Box::new(file),
        })
    }

    pub fn emit(&mut self, record: &MetricRecord) -> Result<()> {
        serde_json::to_writer(&mut self.writer, record)?;
        writeln!(&mut self.writer)?;
        Ok(())
    }
}
