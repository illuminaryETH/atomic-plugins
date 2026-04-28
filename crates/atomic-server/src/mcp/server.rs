use crate::event_bridge::{embedding_event_callback, ingestion_event_callback};
use crate::mcp::types::*;
use crate::state::ServerEvent;
use atomic_core::manager::DatabaseManager;
use atomic_core::models::{AtomWithTags, TagWithCount};
use atomic_core::AtomicCore;
use rmcp::{
    handler::server::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    service::RequestContext,
    tool, tool_handler, tool_router, ErrorData, RoleServer, ServerHandler,
};
use std::sync::Arc;
use tokio::sync::broadcast;

const ATOM_SNIPPET_CHARS: usize = 200;

pub(crate) fn snippet_from(content: &str) -> String {
    content.chars().take(ATOM_SNIPPET_CHARS).collect()
}

/// Snippet for an atom, falling back to a content prefix if the stored
/// snippet is empty (e.g., for atoms created before snippet generation ran).
pub(crate) fn effective_snippet(atom: &atomic_core::models::Atom) -> String {
    if atom.snippet.is_empty() {
        snippet_from(&atom.content)
    } else {
        atom.snippet.clone()
    }
}

pub(crate) fn tag_refs(atom: &AtomWithTags) -> Vec<TagRef> {
    atom.tags
        .iter()
        .map(|t| TagRef {
            id: t.id.clone(),
            name: t.name.clone(),
        })
        .collect()
}

pub(crate) fn atom_summary(atom: &AtomWithTags) -> AtomSummaryView {
    AtomSummaryView {
        atom_id: atom.atom.id.clone(),
        title: atom.atom.title.clone(),
        snippet: effective_snippet(&atom.atom),
        source_url: atom.atom.source_url.clone(),
        tags: tag_refs(atom),
        created_at: atom.atom.created_at.clone(),
        updated_at: atom.atom.updated_at.clone(),
    }
}

pub(crate) fn flatten_tags(tags: &[TagWithCount], out: &mut Vec<TagSummaryView>) {
    for t in tags {
        out.push(TagSummaryView {
            tag_id: t.tag.id.clone(),
            name: t.tag.name.clone(),
            parent_id: t.tag.parent_id.clone(),
            atom_count: t.atom_count,
            subtree_count: t.children_total,
        });
        if !t.children.is_empty() {
            flatten_tags(&t.children, out);
        }
    }
}

fn json_response<T: serde::Serialize>(value: &T) -> Result<CallToolResult, ErrorData> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| ErrorData::internal_error(format!("Serialization error: {}", e), None))?;
    Ok(CallToolResult::success(vec![Content::text(text)]))
}

/// JSON `null`. Used by `get_*`-style tools to signal "not found" in a way
/// that `JSON.parse` accepts; the convention is consistent across all
/// not-found returns in this module.
fn json_null() -> CallToolResult {
    CallToolResult::success(vec![Content::text("null".to_string())])
}

/// Extension type inserted by the `on_request` hook to carry the `?db=` selection.
#[derive(Clone, Debug)]
pub struct DbSelection(pub Option<String>);

/// MCP Server for Atomic knowledge base
#[derive(Clone)]
pub struct AtomicMcpServer {
    manager: Arc<DatabaseManager>,
    event_tx: broadcast::Sender<ServerEvent>,
    tool_router: ToolRouter<Self>,
}

impl AtomicMcpServer {
    pub fn new(manager: Arc<DatabaseManager>, event_tx: broadcast::Sender<ServerEvent>) -> Self {
        Self {
            manager,
            event_tx,
            tool_router: Self::tool_router(),
        }
    }

    /// Resolve the correct AtomicCore from the request context's DbSelection extension.
    async fn resolve_core(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Result<AtomicCore, ErrorData> {
        let db_id = context
            .extensions
            .get::<DbSelection>()
            .and_then(|s| s.0.clone());
        match db_id {
            Some(id) => {
                self.manager.get_core(&id).await.map_err(|e| {
                    ErrorData::internal_error(format!("Database not found: {}", e), None)
                })
            }
            None => self
                .manager
                .active_core()
                .await
                .map_err(|e| ErrorData::internal_error(e.to_string(), None)),
        }
    }
}

#[tool_router]
impl AtomicMcpServer {
    /// Search for atoms using hybrid keyword + semantic search
    #[tool(
        description = "Search your memory for relevant knowledge. Use this before answering questions that may relate to previously stored information. Returns matching atoms ranked by relevance. Set since_days to constrain to recent atoms (e.g., 7 for last week, 30 for last month) when the question is time-sensitive."
    )]
    async fn semantic_search(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<SemanticSearchParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let limit = params.limit.unwrap_or(10).min(50);
        let options =
            atomic_core::SearchOptions::new(params.query, atomic_core::SearchMode::Hybrid, limit)
                .with_threshold(0.3)
                .with_since_days(params.since_days);

        let results = core
            .search(options)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let search_results: Vec<SearchResult> = results
            .into_iter()
            .map(|r| SearchResult {
                atom_id: r.atom.atom.id.clone(),
                content_preview: r.atom.atom.content.chars().take(200).collect(),
                similarity_score: r.similarity_score,
                matching_chunk: r.matching_chunk_content,
            })
            .collect();

        let response_text = serde_json::to_string_pretty(&search_results)
            .map_err(|e| ErrorData::internal_error(format!("Serialization error: {}", e), None))?;

        Ok(CallToolResult::success(vec![Content::text(response_text)]))
    }

    /// Read a single atom with optional line-based pagination
    #[tool(
        description = "Read the full content of a specific atom. Use this after semantic_search returns a relevant result and you need the complete text. Supports pagination for large atoms."
    )]
    async fn read_atom(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<ReadAtomParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let limit = params.limit.unwrap_or(500).min(500) as usize;
        let offset = params.offset.unwrap_or(0).max(0) as usize;

        let atom_with_tags = match core.get_atom(&params.atom_id).await {
            Ok(Some(a)) => a,
            Ok(None) => return Ok(json_null()),
            Err(e) => return Err(ErrorData::internal_error(e.to_string(), None)),
        };

        let content = &atom_with_tags.atom.content;
        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len() as i32;
        let start = offset.min(lines.len());
        let end = (start + limit).min(lines.len());
        let paginated_lines = &lines[start..end];
        let returned_lines = paginated_lines.len() as i32;
        let has_more = end < lines.len();

        let mut paginated_content = paginated_lines.join("\n");

        if has_more {
            paginated_content.push_str(&format!(
                "\n\n(Atom content continues. Use offset {} to read more lines.)",
                end
            ));
        }

        let response = AtomContent {
            atom_id: atom_with_tags.atom.id,
            content: paginated_content,
            total_lines,
            returned_lines,
            offset: offset as i32,
            has_more,
            created_at: atom_with_tags.atom.created_at,
            updated_at: atom_with_tags.atom.updated_at,
        };

        let response_text = serde_json::to_string_pretty(&response)
            .map_err(|e| ErrorData::internal_error(format!("Serialization error: {}", e), None))?;

        Ok(CallToolResult::success(vec![Content::text(response_text)]))
    }

    /// Create a new atom with markdown content
    #[tool(
        description = "Remember something new. Create an atom when you learn information worth retaining across conversations — user preferences, decisions, project context, or important facts. Write concise, self-contained markdown."
    )]
    async fn create_atom(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<CreateAtomParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let request = atomic_core::CreateAtomRequest {
            content: params.content.clone(),
            source_url: params.source_url,
            published_at: None,
            tag_ids: vec![],
            skip_if_source_exists: false,
        };

        let on_event = embedding_event_callback(self.event_tx.clone());

        let result = core
            .create_atom(request, on_event)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
            .ok_or_else(|| {
                ErrorData::internal_error("Atom creation returned None".to_string(), None)
            })?;

        // Broadcast atom creation event
        let _ = self.event_tx.send(ServerEvent::AtomCreated {
            atom: result.clone(),
        });

        let response = AtomResponse {
            atom_id: result.atom.id.clone(),
            content_preview: result.atom.content.chars().take(200).collect(),
            tags: result.tags.iter().map(|t| t.name.clone()).collect(),
            embedding_status: result.atom.embedding_status.clone(),
        };

        let response_text = serde_json::to_string_pretty(&response)
            .map_err(|e| ErrorData::internal_error(format!("Serialization error: {}", e), None))?;

        Ok(CallToolResult::success(vec![Content::text(response_text)]))
    }

    /// Update an existing atom's content
    #[tool(
        description = "Revise an existing atom. Use this when you find an atom with outdated or incomplete information instead of creating a duplicate. Search first to find the atom to update."
    )]
    async fn update_atom(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<UpdateAtomParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;

        // Verify the atom exists first
        match core.get_atom(&params.atom_id).await {
            Ok(Some(_)) => {}
            Ok(None) => return Ok(json_null()),
            Err(e) => return Err(ErrorData::internal_error(e.to_string(), None)),
        }

        let request = atomic_core::UpdateAtomRequest {
            content: params.content,
            source_url: params.source_url,
            published_at: None,
            tag_ids: None,
        };

        let on_event = embedding_event_callback(self.event_tx.clone());

        let result = core
            .update_atom(&params.atom_id, request, on_event)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let response = AtomResponse {
            atom_id: result.atom.id.clone(),
            content_preview: result.atom.content.chars().take(200).collect(),
            tags: result.tags.iter().map(|t| t.name.clone()).collect(),
            embedding_status: result.atom.embedding_status.clone(),
        };

        let response_text = serde_json::to_string_pretty(&response)
            .map_err(|e| ErrorData::internal_error(format!("Serialization error: {}", e), None))?;

        Ok(CallToolResult::success(vec![Content::text(response_text)]))
    }

    /// Delete an atom permanently
    #[tool(
        description = "Permanently delete an atom by id. Use this only when the user explicitly asks to forget something or remove an obsolete note. Cannot be undone. Idempotent: deleting an already-missing id is a no-op."
    )]
    async fn delete_atom(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<DeleteAtomParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        core.delete_atom(&params.atom_id)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let _ = self.event_tx.send(ServerEvent::AtomDeleted {
            atom_id: params.atom_id.clone(),
        });

        json_response(&DeleteAtomResponse {
            atom_id: params.atom_id,
            deleted: true,
        })
    }

    /// List atoms with optional tag filter and pagination
    #[tool(
        description = "List atoms in the knowledge base, optionally scoped to a tag. When `tag_id` is set, the listing cascades to all descendant tags in the tree. Returns compact summaries — call read_atom to fetch full content. This is the canonical atom-listing tool."
    )]
    async fn list_atoms(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<ListAtomsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        use atomic_core::models::{
            ListAtomsParams as CoreListAtomsParams, SortField, SortOrder, SourceFilter,
        };

        let core = self.resolve_core(&context).await?;
        let limit = params.limit.unwrap_or(50).clamp(1, 200);
        let offset = params.offset.unwrap_or(0).max(0);
        let sort_by = match params.sort_by {
            Some(AtomSortField::Created) => SortField::Created,
            Some(AtomSortField::Published) => SortField::Published,
            Some(AtomSortField::Title) => SortField::Title,
            Some(AtomSortField::Updated) | None => SortField::Updated,
        };
        let sort_order = match params.sort_order {
            Some(SortDirection::Asc) => SortOrder::Asc,
            Some(SortDirection::Desc) | None => SortOrder::Desc,
        };

        let core_params = CoreListAtomsParams {
            tag_id: params.tag_id,
            limit,
            offset,
            cursor: None,
            cursor_id: None,
            source_filter: SourceFilter::All,
            source_value: None,
            sort_by,
            sort_order,
        };

        let page = core
            .list_atoms(&core_params)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let atoms: Vec<AtomSummaryView> = page
            .atoms
            .iter()
            .map(|a| AtomSummaryView {
                atom_id: a.id.clone(),
                title: a.title.clone(),
                snippet: a.snippet.clone(),
                source_url: a.source_url.clone(),
                tags: a
                    .tags
                    .iter()
                    .map(|t| TagRef {
                        id: t.id.clone(),
                        name: t.name.clone(),
                    })
                    .collect(),
                created_at: a.created_at.clone(),
                updated_at: a.updated_at.clone(),
            })
            .collect();

        let returned = atoms.len() as i32;
        let response = AtomListResponse {
            atoms,
            total_count: page.total_count,
            limit: page.limit,
            offset: page.offset,
            has_more: page.offset + returned < page.total_count,
        };

        json_response(&response)
    }

    /// List all tags as a flat array (parent_id conveys hierarchy)
    #[tool(
        description = "List the tag tree as a flat array — each tag carries its parent_id, direct atom_count, and subtree_count (atoms in this tag plus all descendants). Use this to discover topics, then call list_atoms with `tag_id` to drill in or get_wiki for the tag's article."
    )]
    async fn list_tags(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<ListTagsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let min_count = params.min_count.unwrap_or(1).max(0);

        let tree = core
            .get_all_tags_filtered(min_count)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let mut flat = Vec::new();
        flatten_tags(&tree, &mut flat);
        json_response(&flat)
    }

    /// Find atoms semantically similar to a given atom
    #[tool(
        description = "Return atoms whose content is semantically close to the given atom, based on vector embeddings. Useful for following a thought thread or surfacing related notes."
    )]
    async fn find_similar(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<FindSimilarParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let limit = params.limit.unwrap_or(10).clamp(1, 50);
        let threshold = params.threshold.unwrap_or(0.3).clamp(0.0, 1.0);

        let results = core
            .find_similar(&params.atom_id, limit, threshold)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let views: Vec<SimilarAtomView> = results
            .into_iter()
            .map(|r| SimilarAtomView {
                atom_id: r.atom.atom.id.clone(),
                title: r.atom.atom.title.clone(),
                snippet: effective_snippet(&r.atom.atom),
                similarity_score: r.similarity_score,
            })
            .collect();

        json_response(&views)
    }

    /// Get the local graph neighborhood around an atom
    #[tool(
        description = "Return the local graph around an atom: nodes within `depth` hops connected by tag-sharing or semantic similarity, plus the edges between them. Useful for understanding context — what surrounds this idea."
    )]
    async fn get_atom_neighborhood(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<GetAtomNeighborhoodParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let depth = params.depth.unwrap_or(1).clamp(1, 3);
        let min_similarity = params.min_similarity.unwrap_or(0.5).clamp(0.0, 1.0);

        let graph = core
            .get_atom_neighborhood(&params.atom_id, depth, min_similarity)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let response = NeighborhoodView {
            center_atom_id: graph.center_atom_id,
            atoms: graph
                .atoms
                .into_iter()
                .map(|n| NeighborhoodAtomView {
                    atom_id: n.atom.atom.id.clone(),
                    title: n.atom.atom.title.clone(),
                    snippet: effective_snippet(&n.atom.atom),
                    depth: n.depth,
                    tags: tag_refs(&n.atom),
                })
                .collect(),
            edges: graph
                .edges
                .into_iter()
                .map(|e| NeighborhoodEdgeView {
                    source_id: e.source_id,
                    target_id: e.target_id,
                    edge_type: e.edge_type,
                    strength: e.strength,
                    similarity_score: e.similarity_score,
                })
                .collect(),
        };

        json_response(&response)
    }

    /// Get explicit `[[wiki-style]]` links emitted by an atom
    #[tool(
        description = "Return the explicit `[[wiki-style]]` outbound links written into an atom's markdown — distinct from semantic similarity. Use when you need only the author's intentional cross-references."
    )]
    async fn get_atom_links(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<GetAtomLinksParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let links = core
            .get_atom_links(&params.atom_id)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let views: Vec<AtomLinkView> = links
            .into_iter()
            .map(|l| AtomLinkView {
                link_id: l.id,
                target_atom_id: l.target_atom_id,
                target_title: l.target_title,
                raw_target: l.raw_target,
                label: l.label,
                target_kind: l.target_kind,
                status: l.status,
            })
            .collect();

        json_response(&views)
    }

    /// Get the LLM-synthesized wiki article for a tag
    #[tool(
        description = "Retrieve the wiki article for a tag — an LLM-synthesized summary of all atoms under that tag, with inline citations. Returns null if the tag has no article yet."
    )]
    async fn get_wiki(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<GetWikiParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let wiki = core
            .get_wiki(&params.tag_id)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        match wiki {
            Some(w) => json_response(&w),
            None => Ok(json_null()),
        }
    }

    /// List all wiki articles in the knowledge base
    #[tool(
        description = "List every wiki article (one per tag that has been summarized) with title, atom_count, and last update time. Use this to discover which topics already have synthesized summaries."
    )]
    async fn list_wikis(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(_params): Parameters<ListWikisParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let wikis = core
            .get_all_wiki_articles()
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        json_response(&wikis)
    }

    /// Get tags semantically related to a given tag
    #[tool(
        description = "Return tags whose atoms overlap or are semantically related to the given tag. Useful for surfacing adjacent topics — e.g. tags that share atoms or whose embeddings cluster nearby."
    )]
    async fn get_related_tags(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<GetRelatedTagsParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let limit = params.limit.unwrap_or(10).clamp(1, 50) as usize;
        let related = core
            .get_related_tags(&params.tag_id, limit)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        json_response(&related)
    }

    /// Fetch a URL and save it as a new atom (or return the existing one)
    #[tool(
        description = "Fetch a URL, extract its article content as markdown, and save it as a new atom. If the URL has already been ingested, returns the existing atom (with its current tags) and `was_existing: true` instead of erroring. Embedding and tagging run in the background after this call returns, so the response's `tags` may be empty for a fresh ingest."
    )]
    async fn ingest_url(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<IngestUrlParams>,
    ) -> Result<CallToolResult, ErrorData> {
        use atomic_core::ingest::IngestionRequest;

        let core = self.resolve_core(&context).await?;

        if let Some(existing) = core
            .get_atom_by_source_url(&params.url)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
        {
            return json_response(&IngestUrlResponse {
                atom: atom_summary(&existing),
                was_existing: true,
                content_length: None,
            });
        }

        let request = IngestionRequest {
            url: params.url.clone(),
            tag_ids: vec![],
            title_hint: params.title_hint,
            published_at: None,
        };

        let on_ingest = ingestion_event_callback(self.event_tx.clone());
        let on_embed = embedding_event_callback(self.event_tx.clone());

        let result = core
            .ingest_url(request, on_ingest, on_embed)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        // Refetch so the caller gets a real summary (snippet, timestamps, source_url)
        // rather than a hand-built skeleton. Tags may still be empty since
        // auto-tagging is queued after create_atom returns.
        let saved = core
            .get_atom(&result.atom_id)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
            .ok_or_else(|| {
                ErrorData::internal_error(
                    "Atom disappeared between ingest and refetch".to_string(),
                    None,
                )
            })?;

        json_response(&IngestUrlResponse {
            atom: atom_summary(&saved),
            was_existing: false,
            content_length: Some(result.content_length),
        })
    }

    /// Look up an atom by its source URL
    #[tool(
        description = "Look up whether an atom already exists for a given source URL. Returns the matching atom summary or null. Use this to dedup before calling ingest_url."
    )]
    async fn get_atom_by_source_url(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<GetAtomBySourceUrlParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        match core
            .get_atom_by_source_url(&params.url)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
        {
            Some(atom) => json_response(&atom_summary(&atom)),
            None => Ok(json_null()),
        }
    }

    /// Fast keyword search across atoms, wiki articles, tags, and chats
    #[tool(
        description = "Fast FTS5 keyword search across atoms, wiki articles, tags, and chat conversations. Cheaper than semantic_search (no embedding call) and returns hits across more entity types. Prefer this when the user types specific terms; use semantic_search when the question is conceptual. The `score` field is FTS-based relevance — within a section, higher means more relevant."
    )]
    async fn keyword_search(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(params): Parameters<KeywordSearchParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let core = self.resolve_core(&context).await?;
        let section_limit = params.section_limit.unwrap_or(5).clamp(1, 20);

        let results = core
            .search_global_keyword(&params.query, section_limit)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let response = KeywordSearchResponse {
            atoms: results
                .atoms
                .into_iter()
                .map(|r| KeywordAtomHit {
                    atom_id: r.atom.atom.id.clone(),
                    title: r.atom.atom.title.clone(),
                    snippet: r
                        .match_snippet
                        .unwrap_or_else(|| snippet_from(&r.atom.atom.content)),
                    score: r.similarity_score,
                })
                .collect(),
            wikis: results
                .wiki
                .into_iter()
                .map(|w| KeywordWikiHit {
                    tag_id: w.tag_id,
                    tag_name: w.tag_name,
                    snippet: w.match_snippet.unwrap_or(w.content_snippet),
                    score: w.score,
                })
                .collect(),
            tags: results
                .tags
                .into_iter()
                .map(|t| KeywordTagHit {
                    tag_id: t.id,
                    name: t.name,
                    parent_id: t.parent_id,
                    atom_count: t.atom_count,
                    score: t.score,
                })
                .collect(),
            chats: results
                .chats
                .into_iter()
                .map(|c| KeywordChatHit {
                    conversation_id: c.id,
                    title: c.title,
                    matching_message: c.matching_message_content,
                    score: c.score,
                })
                .collect(),
        };

        json_response(&response)
    }
}

#[tool_handler]
impl ServerHandler for AtomicMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "Atomic is your long-term memory. Search before answering from recall. \
                 Remember what's worth retaining. Update what's gone stale."
                    .to_string(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests for the response-shaping helpers. These cover the field
    //! mapping that's most likely to regress when atomic-core's models
    //! evolve. Full HTTP-level MCP integration tests (initialize → tools/call)
    //! are intentionally out of scope here — they require spinning up the
    //! StreamableHttpService and running the MCP handshake, which is a
    //! follow-up.
    use super::*;
    use atomic_core::models::{Atom, Tag, TagWithCount};

    fn make_atom(id: &str, title: &str, content: &str, snippet: &str) -> Atom {
        Atom {
            id: id.to_string(),
            content: content.to_string(),
            title: title.to_string(),
            snippet: snippet.to_string(),
            source_url: None,
            source: None,
            published_at: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-02T00:00:00Z".to_string(),
            embedding_status: "complete".to_string(),
            tagging_status: "complete".to_string(),
            embedding_error: None,
            tagging_error: None,
        }
    }

    fn make_tag(id: &str, name: &str, parent_id: Option<&str>) -> Tag {
        Tag {
            id: id.to_string(),
            name: name.to_string(),
            parent_id: parent_id.map(String::from),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            is_autotag_target: false,
        }
    }

    #[test]
    fn effective_snippet_uses_stored_snippet_when_present() {
        let atom = make_atom("a1", "Title", "full content here", "stored snippet");
        assert_eq!(effective_snippet(&atom), "stored snippet");
    }

    #[test]
    fn effective_snippet_falls_back_to_content_prefix_when_empty() {
        let atom = make_atom("a1", "Title", "fallback content", "");
        assert_eq!(effective_snippet(&atom), "fallback content");
    }

    #[test]
    fn effective_snippet_caps_at_200_chars_on_fallback() {
        let long = "x".repeat(500);
        let atom = make_atom("a1", "Title", &long, "");
        assert_eq!(effective_snippet(&atom).chars().count(), 200);
    }

    #[test]
    fn snippet_from_counts_chars_not_bytes() {
        // Each '日' is 3 bytes in UTF-8 but 1 char; confirm we don't truncate
        // mid-codepoint or count bytes instead.
        let s: String = "日".repeat(250);
        let snippet = snippet_from(&s);
        assert_eq!(snippet.chars().count(), 200);
    }

    #[test]
    fn atom_summary_copies_id_title_timestamps_and_source() {
        let mut atom = make_atom("a1", "T", "C", "S");
        atom.source_url = Some("https://example.com/x".to_string());
        let with_tags = AtomWithTags {
            atom,
            tags: vec![make_tag("t1", "rust", None)],
        };
        let view = atom_summary(&with_tags);
        assert_eq!(view.atom_id, "a1");
        assert_eq!(view.title, "T");
        assert_eq!(view.snippet, "S");
        assert_eq!(view.source_url.as_deref(), Some("https://example.com/x"));
        assert_eq!(view.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(view.updated_at, "2026-01-02T00:00:00Z");
        assert_eq!(view.tags.len(), 1);
        assert_eq!(view.tags[0].id, "t1");
        assert_eq!(view.tags[0].name, "rust");
    }

    #[test]
    fn tag_refs_drops_parent_id_and_metadata() {
        let with_tags = AtomWithTags {
            atom: make_atom("a1", "T", "C", "S"),
            tags: vec![
                make_tag("t1", "rust", None),
                make_tag("t2", "async", Some("t1")),
            ],
        };
        let refs = tag_refs(&with_tags);
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].id, "t1");
        assert_eq!(refs[0].name, "rust");
        assert_eq!(refs[1].id, "t2");
        assert_eq!(refs[1].name, "async");
    }

    #[test]
    fn flatten_tags_walks_full_tree_in_dfs_order() {
        // root -> child1 -> grandchild
        //      -> child2
        let tree = vec![TagWithCount {
            tag: make_tag("root", "Root", None),
            atom_count: 1,
            children_total: 4,
            children: vec![
                TagWithCount {
                    tag: make_tag("c1", "Child1", Some("root")),
                    atom_count: 2,
                    children_total: 3,
                    children: vec![TagWithCount {
                        tag: make_tag("g1", "Grand", Some("c1")),
                        atom_count: 3,
                        children_total: 3,
                        children: vec![],
                    }],
                },
                TagWithCount {
                    tag: make_tag("c2", "Child2", Some("root")),
                    atom_count: 4,
                    children_total: 4,
                    children: vec![],
                },
            ],
        }];

        let mut out = Vec::new();
        flatten_tags(&tree, &mut out);
        let ids: Vec<&str> = out.iter().map(|t| t.tag_id.as_str()).collect();
        assert_eq!(ids, vec!["root", "c1", "g1", "c2"]);

        // Field mapping: atom_count vs subtree_count must come from the right
        // source struct.
        let g1 = &out[2];
        assert_eq!(g1.atom_count, 3);
        assert_eq!(g1.subtree_count, 3);
        let root = &out[0];
        assert_eq!(root.atom_count, 1);
        assert_eq!(root.subtree_count, 4);
        assert_eq!(root.parent_id, None);
        assert_eq!(g1.parent_id.as_deref(), Some("c1"));
    }
}
