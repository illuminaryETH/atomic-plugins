//! Command module for Atomic Tauri commands
//!
//! This module organizes commands by domain while re-exporting
//! everything for backward compatibility with lib.rs

mod atoms;
mod canvas;
mod clustering;
mod embedding;
mod graph;
mod helpers;
mod ollama;
mod settings;
mod tags;
mod utils;
mod wiki;

// Re-export all public items for backward compatibility
pub use atoms::*;
pub use canvas::*;
pub use clustering::*;
pub use embedding::*;
pub use graph::*;
pub use ollama::*;
pub use settings::*;
pub use tags::*;
pub use utils::*;
pub use wiki::*;

