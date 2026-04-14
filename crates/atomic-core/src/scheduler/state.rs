//! Per-task state helpers.
//!
//! Scheduled task state is stored in each data database's `settings` table
//! under keys of the form `task.{task_id}.{field}`. State is intentionally
//! **per-database**, not per-deployment — a multi-DB server runs each task
//! independently for every database, so `last_run` / `enabled` /
//! `interval_hours` must not be shared through the registry. We therefore
//! bypass `AtomicCore::get_settings` (which falls through to the registry)
//! and go straight to the per-DB storage backend.
//!
//! Storage layout per task:
//!
//! - `task.{task_id}.last_run`      RFC3339 timestamp of the last successful run
//! - `task.{task_id}.enabled`       `"true"` / `"false"`
//! - `task.{task_id}.interval_hours`  integer hour count (stored as string)

use crate::AtomicCore;
use crate::error::AtomicCoreError;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::time::Duration;

fn key(task_id: &str, field: &str) -> String {
    format!("task.{}.{}", task_id, field)
}

fn per_db_settings(core: &AtomicCore) -> Result<HashMap<String, String>, AtomicCoreError> {
    core.storage().get_all_settings_sync()
}

/// Read the last successful run timestamp for a task. Returns `None` if the
/// task has never run or the stored value is not a valid RFC3339 timestamp.
pub fn get_last_run(
    core: &AtomicCore,
    task_id: &str,
) -> Result<Option<DateTime<Utc>>, AtomicCoreError> {
    let settings = per_db_settings(core)?;
    let Some(raw) = settings.get(&key(task_id, "last_run")) else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }
    match DateTime::parse_from_rfc3339(raw) {
        Ok(dt) => Ok(Some(dt.with_timezone(&Utc))),
        Err(e) => {
            tracing::warn!(
                task_id,
                value = %raw,
                error = %e,
                "[scheduler] Ignoring unparseable task last_run timestamp"
            );
            Ok(None)
        }
    }
}

/// Persist the last successful run timestamp for a task.
pub fn set_last_run(
    core: &AtomicCore,
    task_id: &str,
    when: DateTime<Utc>,
) -> Result<(), AtomicCoreError> {
    core.storage()
        .set_setting_sync(&key(task_id, "last_run"), &when.to_rfc3339())
}

/// Check whether a task is enabled. Defaults to `default` when the setting
/// is missing; treats any non-`"false"` value as enabled to tolerate casing
/// differences.
pub fn is_enabled(core: &AtomicCore, task_id: &str, default: bool) -> bool {
    match per_db_settings(core) {
        Ok(settings) => match settings.get(&key(task_id, "enabled")) {
            Some(v) => !matches!(v.to_ascii_lowercase().as_str(), "false" | "0" | "no" | "off"),
            None => default,
        },
        Err(_) => default,
    }
}

/// Read the configured interval for a task. Falls back to `default` when the
/// setting is missing or unparseable.
pub fn get_interval(core: &AtomicCore, task_id: &str, default: Duration) -> Duration {
    let settings = match per_db_settings(core) {
        Ok(s) => s,
        Err(_) => return default,
    };
    let Some(raw) = settings.get(&key(task_id, "interval_hours")) else {
        return default;
    };
    match raw.parse::<u64>() {
        Ok(hours) if hours > 0 => Duration::from_secs(hours * 3600),
        _ => default,
    }
}

/// Composite check used by the scheduling loop: returns `true` when the task
/// is enabled AND (has never run OR the configured interval has elapsed).
pub fn is_due(
    core: &AtomicCore,
    task_id: &str,
    default_interval: Duration,
    default_enabled: bool,
) -> bool {
    if !is_enabled(core, task_id, default_enabled) {
        return false;
    }
    let interval = get_interval(core, task_id, default_interval);
    match get_last_run(core, task_id) {
        Ok(Some(last)) => {
            let elapsed = Utc::now().signed_duration_since(last);
            elapsed.num_seconds().max(0) as u64 >= interval.as_secs()
        }
        _ => true,
    }
}
