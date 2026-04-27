pub mod graph_canvas;
pub mod memory_longitudinal;
pub mod pipeline_smoke;
pub mod rag_chat;
pub mod retrieval_mini;
pub mod scaffold;
pub mod wiki_synthesis;

pub fn all_suite_names() -> Vec<&'static str> {
    vec![
        "pipeline-smoke",
        "retrieval-mini",
        "rag-chat",
        "wiki-synthesis",
        "graph-canvas",
        "memory-longitudinal",
    ]
}
