//! Scheduled-task framework for atomic-core.
//!
//! This module defines a minimal scheduling primitive that any transport
//! (atomic-server, Tauri sidecar, etc.) can drive from its own runtime. The
//! registry lives here so task implementations ship with core, while the
//! ticking loop itself is owned by the caller.
//!
//! Tasks are responsible for their own enablement / due-ness checks, state
//! persistence, and event reporting — see [`ScheduledTask::run`].

pub mod state;

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;

/// A unit of work that runs on a schedule.
///
/// Implementations are registered in a [`TaskRegistry`] and invoked by the
/// host runtime (typically one tick per minute). Each `run` call is
/// responsible for:
///
/// 1. Checking enablement via [`state::is_enabled`]
/// 2. Checking due-ness via [`state::is_due`]
/// 3. Performing the work
/// 4. Persisting `last_run` via [`state::set_last_run`] on success
/// 5. Emitting a [`TaskEvent`] through `ctx.event_cb`
#[async_trait]
pub trait ScheduledTask: Send + Sync {
    /// Stable identifier used as the key for per-task state in the settings table.
    fn id(&self) -> &'static str;

    /// Human-readable name for logs and future UI.
    fn display_name(&self) -> &'static str;

    /// Default interval between runs when the per-task setting is absent.
    fn default_interval(&self) -> Duration;

    /// Execute the task. The task is responsible for checking enablement,
    /// reading its own state, and updating `last_run` on success.
    async fn run(
        &self,
        core: &crate::AtomicCore,
        ctx: &TaskContext,
    ) -> Result<(), TaskError>;
}

/// Context passed to each task run. Currently just a callback sink so tasks
/// can emit events without knowing about the host transport.
pub struct TaskContext {
    pub event_cb: Arc<dyn Fn(TaskEvent) + Send + Sync>,
    pub embedding_event_cb: Arc<dyn Fn(crate::EmbeddingEvent) + Send + Sync>,
}

/// Events emitted by scheduled tasks. The host runtime adapts these into its
/// own event channel (see `atomic-server::event_bridge::task_event_callback`).
#[derive(Debug, Clone)]
pub enum TaskEvent {
    Started {
        task_id: String,
        db_id: String,
    },
    Completed {
        task_id: String,
        db_id: String,
        /// Identifier of the resource produced by the run, if any (e.g. a
        /// briefing id). Lets downstream UIs deep-link to the result.
        result_id: Option<String>,
    },
    Failed {
        task_id: String,
        db_id: String,
        error: String,
    },
}

/// Errors returned by [`ScheduledTask::run`]. Non-failure outcomes use the
/// `Disabled` / `NotDue` / `AlreadyRunning` variants so the host loop can
/// silently skip them without logging at warn level.
#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("task disabled")]
    Disabled,
    #[error("task not due")]
    NotDue,
    #[error("task already running")]
    AlreadyRunning,
    #[error("{0}")]
    Other(String),
}

impl From<crate::AtomicCoreError> for TaskError {
    fn from(e: crate::AtomicCoreError) -> Self {
        TaskError::Other(e.to_string())
    }
}

/// Registry of scheduled tasks. Owns the task trait objects and the
/// per-(task, database) lock map that prevents re-entry across ticks.
pub struct TaskRegistry {
    tasks: Vec<Arc<dyn ScheduledTask>>,
    /// Per-task-per-database locks. A task that's still running when the next
    /// tick arrives must be skipped, not queued.
    locks: Mutex<HashMap<(String, String), Arc<AsyncMutex<()>>>>,
}

impl Default for TaskRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskRegistry {
    pub fn new() -> Self {
        Self {
            tasks: Vec::new(),
            locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&mut self, task: Arc<dyn ScheduledTask>) {
        self.tasks.push(task);
    }

    pub fn tasks(&self) -> &[Arc<dyn ScheduledTask>] {
        &self.tasks
    }

    /// Try to acquire the per-(task, db) lock. Returns `None` if the lock is
    /// already held (task still running from a previous tick).
    pub fn try_lock(
        &self,
        task_id: &str,
        db_id: &str,
    ) -> Option<tokio::sync::OwnedMutexGuard<()>> {
        let lock = {
            let mut map = self
                .locks
                .lock()
                .expect("scheduler locks mutex poisoned");
            map.entry((task_id.to_string(), db_id.to_string()))
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        lock.try_lock_owned().ok()
    }
}
