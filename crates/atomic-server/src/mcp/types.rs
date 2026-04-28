use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ==================== Tool Input Types ====================

/// Input parameters for semantic_search tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SemanticSearchParams {
    /// The search query to find relevant atoms using vector similarity
    pub query: String,

    /// Maximum number of results to return (default: 10, max: 50)
    #[serde(default)]
    pub limit: Option<i32>,

    /// Optional recency filter: only return atoms created within the last N days.
    /// Use this when the user asks about recent notes ("this week", "last month", etc.).
    #[serde(default)]
    pub since_days: Option<i32>,
}

/// Input parameters for read_atom tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadAtomParams {
    /// The UUID of the atom to retrieve
    pub atom_id: String,

    /// Maximum number of lines to return (default: 500, max: 500)
    #[serde(default)]
    pub limit: Option<i32>,

    /// Line offset for pagination, 0-indexed (default: 0)
    #[serde(default)]
    pub offset: Option<i32>,
}

/// Input parameters for create_atom tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateAtomParams {
    /// The markdown content of the atom
    pub content: String,

    /// Optional source URL where this content originated
    #[serde(default)]
    pub source_url: Option<String>,
}

/// Input parameters for update_atom tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateAtomParams {
    /// The UUID of the atom to update
    pub atom_id: String,

    /// The new markdown content for the atom
    pub content: String,

    /// Optional source URL where this content originated
    #[serde(default)]
    pub source_url: Option<String>,
}

/// Input parameters for delete_atom tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteAtomParams {
    /// The UUID of the atom to delete
    pub atom_id: String,
}

/// Sort field for list_atoms.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AtomSortField {
    Updated,
    Created,
    Published,
    Title,
}

/// Sort direction.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

/// Input parameters for list_atoms tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListAtomsParams {
    /// Optional tag UUID to scope the listing to atoms tagged with this tag
    /// (or any of its descendants in the tag tree).
    #[serde(default)]
    pub tag_id: Option<String>,

    /// Maximum number of atoms to return (default: 50, max: 200)
    #[serde(default)]
    pub limit: Option<i32>,

    /// Pagination offset, 0-indexed (default: 0)
    #[serde(default)]
    pub offset: Option<i32>,

    /// Sort field (default: updated)
    #[serde(default)]
    pub sort_by: Option<AtomSortField>,

    /// Sort direction (default: desc)
    #[serde(default)]
    pub sort_order: Option<SortDirection>,
}

/// Input parameters for list_tags tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListTagsParams {
    /// Hide tags whose subtree contains fewer than this many atoms (default: 1).
    /// Set to 0 to include empty tags.
    #[serde(default)]
    pub min_count: Option<i32>,
}

/// Input parameters for find_similar tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct FindSimilarParams {
    /// The UUID of the atom to find neighbors for
    pub atom_id: String,

    /// Maximum number of similar atoms to return (default: 10, max: 50)
    #[serde(default)]
    pub limit: Option<i32>,

    /// Minimum cosine similarity to include (default: 0.3, range: 0.0–1.0).
    /// Matches semantic_search's default; raise for stricter results.
    #[serde(default)]
    pub threshold: Option<f32>,
}

/// Input parameters for get_atom_neighborhood tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetAtomNeighborhoodParams {
    /// The UUID of the center atom
    pub atom_id: String,

    /// How many hops to expand outward (default: 1, max: 3)
    #[serde(default)]
    pub depth: Option<i32>,

    /// Minimum semantic similarity for an edge to be included
    /// (default: 0.5, range: 0.0–1.0)
    #[serde(default)]
    pub min_similarity: Option<f32>,
}

/// Input parameters for get_atom_links tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetAtomLinksParams {
    /// The UUID of the atom whose outgoing `[[wiki-style]]` links to return
    pub atom_id: String,
}

/// Input parameters for get_wiki tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetWikiParams {
    /// The UUID of the tag whose wiki article to retrieve
    pub tag_id: String,
}

/// Input parameters for list_wikis tool (no fields)
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListWikisParams {}

/// Input parameters for get_related_tags tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetRelatedTagsParams {
    /// The UUID of the tag to find related tags for
    pub tag_id: String,

    /// Maximum number of related tags to return (default: 10, max: 50)
    #[serde(default)]
    pub limit: Option<i32>,
}

/// Input parameters for ingest_url tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct IngestUrlParams {
    /// The URL to fetch, extract, and save as a new atom. Returns the existing
    /// atom (with `was_existing: true`) if the URL has already been ingested.
    pub url: String,

    /// Optional override for the atom title; otherwise the extracted title is used.
    #[serde(default)]
    pub title_hint: Option<String>,
}

/// Input parameters for get_atom_by_source_url tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetAtomBySourceUrlParams {
    /// The source URL to look up
    pub url: String,
}

/// Input parameters for keyword_search tool
#[derive(Debug, Deserialize, JsonSchema)]
pub struct KeywordSearchParams {
    /// The keyword query (FTS5 syntax). Faster than `semantic_search` and
    /// returns hits across atoms, wiki articles, tags, and chat conversations.
    pub query: String,

    /// Maximum results per section (default: 5, max: 20)
    #[serde(default)]
    pub section_limit: Option<i32>,
}

// ==================== Tool Output Types ====================

/// A search result with atom content and similarity score
#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub atom_id: String,
    pub content_preview: String,
    pub similarity_score: f32,
    pub matching_chunk: String,
}

/// Paginated atom content response
#[derive(Debug, Serialize)]
pub struct AtomContent {
    pub atom_id: String,
    pub content: String,
    pub total_lines: i32,
    pub returned_lines: i32,
    pub offset: i32,
    pub has_more: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Created/updated atom response
#[derive(Debug, Serialize)]
pub struct AtomResponse {
    pub atom_id: String,
    pub content_preview: String,
    pub tags: Vec<String>,
    pub embedding_status: String,
}

/// Compact tag reference embedded in atom summaries
#[derive(Debug, Serialize)]
pub struct TagRef {
    pub id: String,
    pub name: String,
}

/// Compact atom summary used by list/lookup tools.
#[derive(Debug, Serialize)]
pub struct AtomSummaryView {
    pub atom_id: String,
    pub title: String,
    pub snippet: String,
    pub source_url: Option<String>,
    pub tags: Vec<TagRef>,
    pub created_at: String,
    pub updated_at: String,
}

/// Response shape for list_atoms.
#[derive(Debug, Serialize)]
pub struct AtomListResponse {
    pub atoms: Vec<AtomSummaryView>,
    pub total_count: i32,
    pub limit: i32,
    pub offset: i32,
    pub has_more: bool,
}

/// Flattened tag node for list_tags. Hierarchy is conveyed via `parent_id`;
/// `subtree_count` is the total atom count under this tag (including descendants).
#[derive(Debug, Serialize)]
pub struct TagSummaryView {
    pub tag_id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub atom_count: i32,
    pub subtree_count: i32,
}

/// Similar-atom hit returned by find_similar.
#[derive(Debug, Serialize)]
pub struct SimilarAtomView {
    pub atom_id: String,
    pub title: String,
    pub snippet: String,
    pub similarity_score: f32,
}

/// Atom node in a neighborhood graph.
#[derive(Debug, Serialize)]
pub struct NeighborhoodAtomView {
    pub atom_id: String,
    pub title: String,
    pub snippet: String,
    pub depth: i32,
    pub tags: Vec<TagRef>,
}

/// Edge in a neighborhood graph.
#[derive(Debug, Serialize)]
pub struct NeighborhoodEdgeView {
    pub source_id: String,
    pub target_id: String,
    pub edge_type: String,
    pub strength: f32,
    pub similarity_score: Option<f32>,
}

/// Response for get_atom_neighborhood.
#[derive(Debug, Serialize)]
pub struct NeighborhoodView {
    pub center_atom_id: String,
    pub atoms: Vec<NeighborhoodAtomView>,
    pub edges: Vec<NeighborhoodEdgeView>,
}

/// Materialized `[[...]]` link in an atom's content.
#[derive(Debug, Serialize)]
pub struct AtomLinkView {
    pub link_id: String,
    pub target_atom_id: Option<String>,
    pub target_title: Option<String>,
    pub raw_target: String,
    pub label: Option<String>,
    pub target_kind: String,
    pub status: String,
}

/// Citation embedded in a wiki article.
#[derive(Debug, Serialize)]
pub struct WikiCitationView {
    pub citation_index: i32,
    pub atom_id: String,
    pub excerpt: String,
    pub source_url: Option<String>,
}

/// Wiki article response for get_wiki.
#[derive(Debug, Serialize)]
pub struct WikiArticleView {
    pub tag_id: String,
    pub article_id: String,
    pub content_markdown: String,
    pub atom_count: i32,
    pub updated_at: String,
    pub citations: Vec<WikiCitationView>,
}

/// Wiki summary entry for list_wikis.
#[derive(Debug, Serialize)]
pub struct WikiSummaryView {
    pub tag_id: String,
    pub tag_name: String,
    pub atom_count: i32,
    pub inbound_links: i32,
    pub updated_at: String,
}

/// Related-tag hit for get_related_tags.
#[derive(Debug, Serialize)]
pub struct RelatedTagView {
    pub tag_id: String,
    pub tag_name: String,
    pub score: f64,
    pub shared_atoms: i32,
    pub semantic_edges: i32,
    pub has_article: bool,
}

/// Response for ingest_url. `was_existing` is true when the URL was already
/// stored — in that case `atom` reflects the pre-existing atom (with its
/// current tags) and `content_length` is `None`. On a fresh ingest,
/// `content_length` carries the extracted markdown size; tags may be empty
/// since auto-tagging runs asynchronously.
#[derive(Debug, Serialize)]
pub struct IngestUrlResponse {
    pub atom: AtomSummaryView,
    pub was_existing: bool,
    pub content_length: Option<usize>,
}

/// Atom hit returned inside keyword_search.
#[derive(Debug, Serialize)]
pub struct KeywordAtomHit {
    pub atom_id: String,
    pub title: String,
    pub snippet: String,
    pub score: f32,
}

/// Wiki hit returned inside keyword_search.
#[derive(Debug, Serialize)]
pub struct KeywordWikiHit {
    pub tag_id: String,
    pub tag_name: String,
    pub snippet: String,
    pub score: f32,
}

/// Tag hit returned inside keyword_search.
#[derive(Debug, Serialize)]
pub struct KeywordTagHit {
    pub tag_id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

/// Chat hit returned inside keyword_search.
#[derive(Debug, Serialize)]
pub struct KeywordChatHit {
    pub conversation_id: String,
    pub title: Option<String>,
    pub matching_message: String,
    pub score: f32,
}

/// Response for keyword_search.
#[derive(Debug, Serialize)]
pub struct KeywordSearchResponse {
    pub atoms: Vec<KeywordAtomHit>,
    pub wikis: Vec<KeywordWikiHit>,
    pub tags: Vec<KeywordTagHit>,
    pub chats: Vec<KeywordChatHit>,
}

/// Acknowledgement returned by delete_atom.
#[derive(Debug, Serialize)]
pub struct DeleteAtomResponse {
    pub atom_id: String,
    pub deleted: bool,
}
