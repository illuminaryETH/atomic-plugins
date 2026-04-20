//! Draft pipeline scheduled task.
//!
//! Picks up autosaved atoms whose content is durable but whose AI pipeline
//! has not been explicitly finalized by the foreground client.

use crate::scheduler::{state as task_state, ScheduledTask, TaskContext, TaskError, TaskEvent};
use crate::AtomicCore;
use async_trait::async_trait;
use chrono::{Duration as ChronoDuration, Utc};
use std::sync::Arc;
use std::time::Duration;

pub struct DraftPipelineTask;

const TASK_ID: &str = "draft_pipeline";
const DEFAULT_INTERVAL: Duration = Duration::from_secs(60);
const DEFAULT_ENABLED: bool = true;
const DEFAULT_QUIET_MINUTES: i64 = 1;

#[async_trait]
impl ScheduledTask for DraftPipelineTask {
    fn id(&self) -> &'static str {
        TASK_ID
    }

    fn display_name(&self) -> &'static str {
        "Draft pipeline"
    }

    fn default_interval(&self) -> Duration {
        DEFAULT_INTERVAL
    }

    async fn run(&self, core: &AtomicCore, ctx: &TaskContext) -> Result<(), TaskError> {
        if !task_state::is_enabled(core, TASK_ID, DEFAULT_ENABLED).await {
            return Err(TaskError::Disabled);
        }
        if !task_state::is_due(core, TASK_ID, DEFAULT_INTERVAL, DEFAULT_ENABLED).await {
            return Err(TaskError::NotDue);
        }

        let db_id = core
            .db_path()
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "default".to_string());

        (ctx.event_cb)(TaskEvent::Started {
            task_id: TASK_ID.to_string(),
            db_id: db_id.clone(),
        });

        let quiet_minutes = quiet_minutes(core).await;
        let cutoff = Utc::now() - ChronoDuration::minutes(quiet_minutes);
        let on_event = {
            let cb = Arc::clone(&ctx.embedding_event_cb);
            move |event| cb(event)
        };
        let on_event_tag = {
            let cb = Arc::clone(&ctx.embedding_event_cb);
            move |event| cb(event)
        };

        let embedding_count = core
            .process_pending_embeddings_due(cutoff, on_event)
            .await
            .map_err(TaskError::from)?;
        let tagging_count = core
            .process_pending_tagging_due(cutoff, on_event_tag)
            .await
            .map_err(TaskError::from)?;

        task_state::set_last_run(core, TASK_ID, Utc::now())
            .await
            .map_err(TaskError::from)?;

        tracing::info!(
            db_id = %db_id,
            quiet_minutes,
            embedding_queued = embedding_count,
            tagging_queued = tagging_count,
            "[draft_pipeline] scheduler tick complete"
        );

        (ctx.event_cb)(TaskEvent::Completed {
            task_id: TASK_ID.to_string(),
            db_id,
            result_id: None,
        });

        Ok(())
    }
}

async fn quiet_minutes(core: &AtomicCore) -> i64 {
    let settings = match core.storage().get_all_settings_sync().await {
        Ok(s) => s,
        Err(_) => return DEFAULT_QUIET_MINUTES,
    };
    settings
        .get("task.draft_pipeline.quiet_minutes")
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|minutes| *minutes > 0)
        .unwrap_or(DEFAULT_QUIET_MINUTES)
}
