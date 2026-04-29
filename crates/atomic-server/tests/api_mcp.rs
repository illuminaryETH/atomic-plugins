//! HTTP integration tests for the MCP tool surface.
//!
//! Spins up a real actix `HttpServer` mounting the same `/mcp` scope
//! (auth + StreamableHttpService) that production uses, performs the
//! `initialize` + `notifications/initialized` handshake to obtain a session,
//! then exercises each tool over JSON-RPC. Responses are SSE — each event's
//! `data: ` line is parsed back to JSON.
//!
//! Tools that need a configured embedder or external network — `semantic_search`,
//! `find_similar`, `get_atom_neighborhood`, `ingest_url` (fresh path) — use
//! `McpHarness::start_with_embeddings()`, which mounts a `wiremock` server in
//! front of the OpenAI-compatible `OpenAICompatProvider`. The real production
//! provider plumbing (settings → `ProviderConfig::from_settings` → HTTP) runs;
//! only the upstream API is faked. Tests against tools that don't touch the
//! pipeline still use the lighter `start()`.

use actix_web::{web, App, HttpServer};
use atomic_core::{CreateAtomRequest, DatabaseManager};
use atomic_server::mcp::{AtomicMcpServer, DbSelection};
use atomic_server::mcp_auth::McpAuth;
use atomic_server::state::{AppState, ServerEvent};
use futures::StreamExt;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp_actix_web::transport::StreamableHttpService;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request as WiremockRequest, Respond, ResponseTemplate};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/// In-process MCP server bound to a random port. Holds the temp dir so the
/// SQLite DB stays alive for the test, and the spawned server task so it can
/// be torn down on Drop. Also exposes the underlying `AtomicCore` so tests
/// can seed data without going through the API.
struct McpHarness {
    addr: SocketAddr,
    bearer: String,
    session_id: String,
    next_id: AtomicI64,
    client: reqwest::Client,
    core: atomic_core::AtomicCore,
    server_task: tokio::task::JoinHandle<()>,
    /// Held only to keep the mock alive for the duration of the test. Tests
    /// that need its URL go through `mock_uri()`.
    mock_server: Option<MockServer>,
    _temp: tempfile::TempDir,
}

impl McpHarness {
    async fn start() -> Self {
        let temp = tempfile::TempDir::new().unwrap();
        let manager = Arc::new(DatabaseManager::new(temp.path()).unwrap());
        let core = manager.active_core().await.unwrap();
        let (_info, raw_token) = core.create_api_token("test").await.unwrap();
        let (event_tx, _) = broadcast::channel::<ServerEvent>(64);

        let app_state = web::Data::new(AppState {
            manager: manager.clone(),
            event_tx: event_tx.clone(),
            public_url: None,
            log_buffer: atomic_server::log_buffer::LogBuffer::new(16),
            export_jobs: atomic_server::export_jobs::ExportJobManager::for_tests(
                temp.path().join("exports"),
            ),
        });

        let mcp_manager = manager.clone();
        let mcp_tx = event_tx.clone();
        let mcp_service = StreamableHttpService::builder()
            .service_factory(Arc::new(move || {
                Ok(AtomicMcpServer::new(mcp_manager.clone(), mcp_tx.clone()))
            }))
            .on_request_fn(|_http_req, ext| {
                // Tests don't pass `?db=`, so always inherit the active DB.
                ext.insert(DbSelection(None));
            })
            .session_manager(Arc::new(LocalSessionManager::default()))
            .stateful_mode(true)
            .build();

        let auth_state = app_state.clone();
        let server = HttpServer::new(move || {
            let mcp_service = mcp_service.clone();
            App::new().app_data(auth_state.clone()).service(
                web::scope("/mcp")
                    .wrap(McpAuth {
                        state: auth_state.clone(),
                    })
                    .service(mcp_service.scope()),
            )
        })
        .bind("127.0.0.1:0")
        .expect("bind 127.0.0.1:0")
        .workers(1);
        let addr = *server.addrs().first().unwrap();
        let server_handle = server.run();
        let server_task = tokio::spawn(async move {
            let _ = server_handle.await;
        });

        // Give the server a beat to come up before the handshake.
        tokio::time::sleep(Duration::from_millis(50)).await;

        let bearer = format!("Bearer {}", raw_token);
        let client = reqwest::Client::new();
        let url = format!("http://{}/mcp", addr);

        // Initialize handshake.
        let init_body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "atomic-test", "version": "0.0.0" }
            }
        });
        let init_resp = client
            .post(&url)
            .header("Authorization", &bearer)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .json(&init_body)
            .send()
            .await
            .expect("send initialize");
        assert_eq!(
            init_resp.status(),
            200,
            "initialize must return 200, got {}",
            init_resp.status()
        );
        let session_id = init_resp
            .headers()
            .get("Mcp-Session-Id")
            .expect("server should set Mcp-Session-Id on initialize")
            .to_str()
            .unwrap()
            .to_string();
        // Drain the SSE response so the connection releases cleanly.
        drain_sse(init_resp).await;

        // Send the initialized notification (required before any tool call).
        let init_notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        let notif_resp = client
            .post(&url)
            .header("Authorization", &bearer)
            .header("Mcp-Session-Id", &session_id)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .json(&init_notif)
            .send()
            .await
            .expect("send initialized notification");
        assert_eq!(
            notif_resp.status(),
            202,
            "notifications/initialized should return 202"
        );

        McpHarness {
            addr,
            bearer,
            session_id,
            next_id: AtomicI64::new(2),
            client,
            core,
            server_task,
            mock_server: None,
            _temp: temp,
        }
    }

    /// Spin up a harness with an OpenAI-compatible mock embeddings endpoint
    /// wired into the core's provider settings. Also exposes a `GET /test-page`
    /// route on the same mock so `ingest_url` tests can fetch a deterministic
    /// article without touching the network.
    ///
    /// Uses `embedding_dimension = 1536` to match the default `vec_chunks` table
    /// dim — avoids a table-recreation cycle. `auto_tagging_enabled` is set to
    /// `false` so the pipeline doesn't also reach for the LLM.
    async fn start_with_embeddings() -> Self {
        let mut h = Self::start().await;

        let mock = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v1/embeddings"))
            .respond_with(EmbeddingResponder { dim: 1536 })
            .mount(&mock)
            .await;

        // `set_body_raw` is used (not `set_body_string`) because the latter
        // hard-codes Content-Type: text/plain, and `atomic_core::ingest::fetch`
        // rejects non-HTML responses.
        Mock::given(method("GET"))
            .and(path("/test-page"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(TEST_ARTICLE_HTML.as_bytes().to_vec(), "text/html"),
            )
            .mount(&mock)
            .await;

        let base = format!("{}/v1", mock.uri());
        h.core
            .set_setting("provider", "openai_compat")
            .await
            .expect("set provider");
        h.core
            .set_setting("openai_compat_base_url", &base)
            .await
            .expect("set base_url");
        h.core
            .set_setting("openai_compat_embedding_model", "test-embed")
            .await
            .expect("set model");
        h.core
            .set_setting("openai_compat_embedding_dimension", "1536")
            .await
            .expect("set dim");
        h.core
            .set_setting("auto_tagging_enabled", "false")
            .await
            .expect("disable tagging");

        h.mock_server = Some(mock);
        h
    }

    fn mock_uri(&self) -> String {
        self.mock_server
            .as_ref()
            .expect("start_with_embeddings() not called")
            .uri()
    }

    /// Block until the embedding pipeline has drained.
    ///
    /// `core.create_atom` enqueues a pipeline job and spawns the worker
    /// (`embedding.rs:2114`) — control returns *before* embeddings are
    /// persisted. Tests that read `atom_chunks` / `vec_chunks` after seeding
    /// must explicitly wait for the queue to empty and every atom to leave
    /// the `pending`/`processing` states.
    async fn wait_for_pipeline_idle(&self) {
        let db = self.core.database().expect("sqlite backend");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let busy = {
                let conn = db.read_conn().expect("read_conn");
                let jobs: i64 = conn
                    .query_row("SELECT COUNT(*) FROM atom_pipeline_jobs", [], |r| r.get(0))
                    .unwrap_or(0);
                let in_flight: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM atoms WHERE embedding_status IN ('pending', 'processing')",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                jobs > 0 || in_flight > 0
            };
            if !busy {
                return;
            }
            if std::time::Instant::now() >= deadline {
                let conn = db.read_conn().unwrap();
                let states: Vec<(String, String)> = conn
                    .prepare("SELECT id, embedding_status FROM atoms")
                    .unwrap()
                    .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .unwrap()
                    .collect::<Result<_, _>>()
                    .unwrap();
                panic!("pipeline did not drain within 10s; atoms: {:?}", states);
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    fn url(&self) -> String {
        format!("http://{}/mcp", self.addr)
    }

    fn next_id(&self) -> i64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    async fn jsonrpc(&self, method: &str, params: Value) -> Value {
        let id = self.next_id();
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let resp = self
            .client
            .post(self.url())
            .header("Authorization", &self.bearer)
            .header("Mcp-Session-Id", &self.session_id)
            .header("Accept", "application/json, text/event-stream")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .expect("send jsonrpc");
        assert_eq!(
            resp.status(),
            200,
            "jsonrpc {} must return 200",
            method
        );
        find_response(drain_sse(resp).await, id)
    }

    /// Call a tool and return the parsed JSON of `result.content[0].text`.
    async fn call_tool(&self, name: &str, args: Value) -> Value {
        let rpc = self
            .jsonrpc(
                "tools/call",
                json!({ "name": name, "arguments": args }),
            )
            .await;
        if let Some(err) = rpc.get("error") {
            panic!("tools/call {} returned error: {}", name, err);
        }
        let text = rpc
            .pointer("/result/content/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| {
                panic!(
                    "tools/call {} missing /result/content/0/text in {}",
                    name, rpc
                )
            });
        // The "null" string is valid JSON for a null payload; everything else
        // we serialize via to_string_pretty, also parseable.
        serde_json::from_str(text)
            .unwrap_or_else(|e| panic!("tool {} returned non-JSON text {:?}: {}", name, text, e))
    }

    async fn list_tools(&self) -> Vec<Value> {
        let rpc = self.jsonrpc("tools/list", json!({})).await;
        rpc.pointer("/result/tools")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(|| panic!("tools/list missing /result/tools: {}", rpc))
    }
}

impl Drop for McpHarness {
    fn drop(&mut self) {
        self.server_task.abort();
    }
}

/// Read an SSE response body until the end of one event (`\n\n`), or until
/// a 64 KiB / 2 s safety limit. SSE events from rmcp's streamable-http are
/// one JSON-RPC reply per `data:` line followed by a blank line.
async fn drain_sse(resp: reqwest::Response) -> String {
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(Ok(chunk)) = stream.next().await {
            buf.extend_from_slice(&chunk);
            if buf.ends_with(b"\n\n") || buf.len() > 65536 {
                break;
            }
        }
    })
    .await;
    String::from_utf8_lossy(&buf).into_owned()
}

/// Deterministic unit-length pseudo-embedding for a given text. Same input →
/// same vector. The vectors share a constant offset before normalization so
/// any two are highly similar (>0.99 cosine) — that's deliberate: it makes
/// `find_similar` and `get_atom_neighborhood` produce non-empty results
/// against a fake provider, which is what the wiring tests need to assert.
fn fake_embedding(input: &str, dim: usize) -> Vec<f32> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    let h = hasher.finish();

    let mut v = Vec::with_capacity(dim);
    // Per-dim base (constant) plus a small per-input perturbation seeded by
    // the hash. The constant dominates so all vectors cluster near a single
    // point on the unit sphere.
    for i in 0..dim {
        let perturb = ((h >> ((i % 8) * 8)) & 0xFF) as f32 / 255.0;
        v.push(1.0 + perturb * 0.05);
    }
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in &mut v {
            *x /= norm;
        }
    }
    v
}

/// `wiremock` responder for `POST /v1/embeddings`. Reads the request's
/// `input: [..]` array and returns one embedding per element, matching the
/// shape `OpenAICompatProvider::embed_batch` deserializes.
struct EmbeddingResponder {
    dim: usize,
}

impl Respond for EmbeddingResponder {
    fn respond(&self, request: &WiremockRequest) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body)
            .expect("embeddings request body must be JSON");
        let inputs = body
            .get("input")
            .and_then(|v| v.as_array())
            .expect("embeddings request must have an `input` array");

        let data: Vec<Value> = inputs
            .iter()
            .map(|v| {
                let text = v.as_str().unwrap_or("");
                json!({ "embedding": fake_embedding(text, self.dim) })
            })
            .collect();

        ResponseTemplate::new(200).set_body_json(json!({ "data": data }))
    }
}

/// HTML payload served by the `GET /test-page` mock. Has to be substantive
/// and article-shaped enough to clear `is_probably_readable()` and the 200-char
/// minimum content length in `atomic_core::ingest::extract::extract_article`.
const TEST_ARTICLE_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
  <title>The Domestic Ferret</title>
</head>
<body>
  <article>
    <h1>The Domestic Ferret</h1>
    <p>The ferret is a small, domesticated species belonging to the family Mustelidae.
       Ferrets have been kept as pets for thousands of years and are commonly used in
       hunting and as working animals in agricultural and industrial settings.</p>
    <p>Their average length is about 50 cm including a 13 cm tail, and they typically
       weigh between 0.7 and 2 kg. The natural lifespan of a domestic ferret is
       between seven and ten years, with sexual dimorphism observable between males
       and females.</p>
    <p>Like many other members of the mustelid family, ferrets have scent glands near
       their anus, the secretions from which are used in scent marking. Ferrets are
       crepuscular animals — they spend most of their time asleep, with bursts of
       activity around dawn and dusk.</p>
  </article>
</body>
</html>"#;

/// Parse an SSE body and pull out the JSON-RPC response with the matching id.
fn find_response(body: String, id: i64) -> Value {
    for line in body.lines() {
        if let Some(json_str) = line.strip_prefix("data: ") {
            if let Ok(v) = serde_json::from_str::<Value>(json_str) {
                if v.get("id").and_then(|i| i.as_i64()) == Some(id) {
                    return v;
                }
            }
        }
    }
    panic!("no jsonrpc response with id {} in body:\n{}", id, body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn tools_list_advertises_every_tool_with_input_schema() {
    let h = McpHarness::start().await;
    let tools = h.list_tools().await;

    let names: Vec<String> = tools
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect();
    let expected = [
        "semantic_search",
        "read_atom",
        "create_atom",
        "update_atom",
        "delete_atom",
        "list_atoms",
        "list_tags",
        "find_similar",
        "get_atom_neighborhood",
        "get_atom_links",
        "get_wiki",
        "list_wikis",
        "get_related_tags",
        "ingest_url",
        "get_atom_by_source_url",
        "keyword_search",
    ];
    for tool in expected {
        assert!(
            names.iter().any(|n| n == tool),
            "tools/list missing {}; got {:?}",
            tool,
            names
        );
    }

    // Every tool must publish a schema with at least an object type. If a
    // tool ships with no inputSchema, an LLM client can't generate calls for
    // it — that's a regression worth catching.
    for tool in &tools {
        let name = tool["name"].as_str().unwrap();
        let schema = tool
            .get("inputSchema")
            .unwrap_or_else(|| panic!("{} has no inputSchema", name));
        assert_eq!(
            schema["type"].as_str(),
            Some("object"),
            "{} inputSchema is not type=object",
            name
        );
    }

    // Tools that previously existed should not have come back.
    for stale in ["get_atoms_by_tag"] {
        assert!(
            !names.iter().any(|n| n == stale),
            "removed tool {} reappeared in tools/list",
            stale
        );
    }
}

#[actix_web::test]
async fn unauthenticated_request_returns_401() {
    let h = McpHarness::start().await;
    let resp = reqwest::Client::new()
        .post(h.url())
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 99,
            "method": "tools/list"
        }))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 401);
}

#[actix_web::test]
async fn create_then_read_atom_round_trip() {
    let h = McpHarness::start().await;
    let created = h
        .call_tool(
            "create_atom",
            json!({ "content": "# Hello\n\nA test atom." }),
        )
        .await;
    let atom_id = created["atom_id"].as_str().unwrap().to_string();
    assert!(!atom_id.is_empty());

    let read = h
        .call_tool("read_atom", json!({ "atom_id": atom_id }))
        .await;
    assert_eq!(read["atom_id"], atom_id);
    assert!(read["content"]
        .as_str()
        .unwrap()
        .contains("A test atom."));
    assert_eq!(read["has_more"], false);
}

#[actix_web::test]
async fn read_atom_returns_null_for_missing_id() {
    let h = McpHarness::start().await;
    let read = h
        .call_tool(
            "read_atom",
            json!({ "atom_id": "00000000-0000-0000-0000-000000000000" }),
        )
        .await;
    assert!(read.is_null(), "expected null, got {}", read);
}

#[actix_web::test]
async fn update_atom_changes_content() {
    let h = McpHarness::start().await;
    let created = h
        .call_tool("create_atom", json!({ "content": "original" }))
        .await;
    let atom_id = created["atom_id"].as_str().unwrap().to_string();

    h.call_tool(
        "update_atom",
        json!({ "atom_id": atom_id, "content": "rewritten" }),
    )
    .await;

    let read = h
        .call_tool("read_atom", json!({ "atom_id": atom_id }))
        .await;
    assert_eq!(read["content"].as_str().unwrap().trim(), "rewritten");
}

#[actix_web::test]
async fn update_atom_returns_null_for_missing_id() {
    let h = McpHarness::start().await;
    let r = h
        .call_tool(
            "update_atom",
            json!({
                "atom_id": "00000000-0000-0000-0000-000000000000",
                "content": "ignored"
            }),
        )
        .await;
    assert!(r.is_null());
}

#[actix_web::test]
async fn delete_atom_then_read_returns_null() {
    let h = McpHarness::start().await;
    let created = h
        .call_tool("create_atom", json!({ "content": "doomed" }))
        .await;
    let atom_id = created["atom_id"].as_str().unwrap().to_string();

    let del = h
        .call_tool("delete_atom", json!({ "atom_id": atom_id }))
        .await;
    assert_eq!(del["deleted"], true);

    let read = h
        .call_tool("read_atom", json!({ "atom_id": atom_id }))
        .await;
    assert!(read.is_null());
}

#[actix_web::test]
async fn delete_atom_is_idempotent_on_missing_id() {
    // The pre-existence pre-check was removed; the underlying SQL is
    // idempotent. This test pins that contract.
    let h = McpHarness::start().await;
    let r = h
        .call_tool(
            "delete_atom",
            json!({ "atom_id": "00000000-0000-0000-0000-000000000000" }),
        )
        .await;
    assert_eq!(r["deleted"], true);
}

#[actix_web::test]
async fn list_atoms_returns_paginated_summaries() {
    let h = McpHarness::start().await;
    for i in 0..3 {
        h.core
            .create_atom(
                CreateAtomRequest {
                    content: format!("note #{i}"),
                    ..Default::default()
                },
                |_| {},
            )
            .await
            .unwrap();
    }

    let r = h.call_tool("list_atoms", json!({ "limit": 10 })).await;
    let atoms = r["atoms"].as_array().unwrap();
    assert_eq!(atoms.len(), 3);
    assert_eq!(r["total_count"], 3);
    assert_eq!(r["has_more"], false);
    // Compact summary shape: no full content, no pipeline status fields.
    assert!(atoms[0].get("snippet").is_some());
    assert!(atoms[0].get("content").is_none());
    assert!(atoms[0].get("embedding_status").is_none());
}

#[actix_web::test]
async fn list_atoms_with_tag_id_cascades_to_descendants() {
    let h = McpHarness::start().await;
    let parent = h.core.create_tag("topics", None).await.unwrap();
    let child = h
        .core
        .create_tag("rust", Some(&parent.id))
        .await
        .unwrap();

    // One atom directly under the parent, one under the child. The cascade
    // should return both when filtering by the parent tag.
    h.core
        .create_atom(
            CreateAtomRequest {
                content: "parent note".to_string(),
                tag_ids: vec![parent.id.clone()],
                ..Default::default()
            },
            |_| {},
        )
        .await
        .unwrap();
    h.core
        .create_atom(
            CreateAtomRequest {
                content: "child note".to_string(),
                tag_ids: vec![child.id.clone()],
                ..Default::default()
            },
            |_| {},
        )
        .await
        .unwrap();

    let r = h
        .call_tool("list_atoms", json!({ "tag_id": parent.id }))
        .await;
    assert_eq!(r["total_count"], 2, "parent tag should cascade: {}", r);
}

#[actix_web::test]
async fn list_tags_returns_flattened_dfs() {
    let h = McpHarness::start().await;
    let parent = h.core.create_tag("topics", None).await.unwrap();
    let child = h
        .core
        .create_tag("rust", Some(&parent.id))
        .await
        .unwrap();
    h.core
        .create_atom(
            CreateAtomRequest {
                content: "x".to_string(),
                tag_ids: vec![child.id.clone()],
                ..Default::default()
            },
            |_| {},
        )
        .await
        .unwrap();

    // min_count=0 so empty tags also surface.
    let r = h
        .call_tool("list_tags", json!({ "min_count": 0 }))
        .await;
    let arr = r.as_array().unwrap();
    let names: Vec<&str> = arr.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"topics"), "expected topics in {:?}", names);
    assert!(names.contains(&"rust"), "expected rust in {:?}", names);

    // The child should declare its parent.
    let rust = arr
        .iter()
        .find(|t| t["name"] == "rust")
        .expect("rust tag");
    assert_eq!(rust["parent_id"], json!(parent.id));
}

#[actix_web::test]
async fn get_atom_by_source_url_round_trip_and_null() {
    let h = McpHarness::start().await;
    h.call_tool(
        "create_atom",
        json!({
            "content": "from a url",
            "source_url": "https://example.com/a"
        }),
    )
    .await;

    let hit = h
        .call_tool(
            "get_atom_by_source_url",
            json!({ "url": "https://example.com/a" }),
        )
        .await;
    assert_eq!(hit["source_url"], "https://example.com/a");

    let miss = h
        .call_tool(
            "get_atom_by_source_url",
            json!({ "url": "https://example.com/never-saved" }),
        )
        .await;
    assert!(miss.is_null());
}

#[actix_web::test]
async fn ingest_url_returns_existing_atom_on_dedup_path() {
    // The dedup path doesn't fetch — it only consults source_url. We can
    // exercise it deterministically by pre-seeding an atom with the URL.
    let h = McpHarness::start().await;
    h.call_tool(
        "create_atom",
        json!({
            "content": "pre-seeded",
            "source_url": "https://example.com/preseed"
        }),
    )
    .await;

    let r = h
        .call_tool(
            "ingest_url",
            json!({ "url": "https://example.com/preseed" }),
        )
        .await;
    assert_eq!(r["was_existing"], true);
    assert!(
        r["content_length"].is_null(),
        "content_length should be null on dedup, got {}",
        r["content_length"]
    );
    assert_eq!(r["atom"]["source_url"], "https://example.com/preseed");
}

#[actix_web::test]
async fn keyword_search_finds_seeded_atom() {
    let h = McpHarness::start().await;
    h.core
        .create_atom(
            CreateAtomRequest {
                content: "the quick brown fox jumps over the lazy dog".to_string(),
                ..Default::default()
            },
            |_| {},
        )
        .await
        .unwrap();

    let r = h
        .call_tool(
            "keyword_search",
            json!({ "query": "brown fox", "section_limit": 5 }),
        )
        .await;
    let atoms = r["atoms"].as_array().unwrap();
    assert!(
        !atoms.is_empty(),
        "expected at least one atom hit for 'brown fox', got {}",
        r
    );
    // Sections always present, even when empty.
    assert!(r["wikis"].is_array());
    assert!(r["tags"].is_array());
    assert!(r["chats"].is_array());
}

#[actix_web::test]
async fn list_wikis_is_empty_on_fresh_db() {
    let h = McpHarness::start().await;
    let r = h.call_tool("list_wikis", json!({})).await;
    assert_eq!(r, json!([]));
}

#[actix_web::test]
async fn get_wiki_returns_null_for_tag_without_article() {
    let h = McpHarness::start().await;
    let tag = h.core.create_tag("untouched", None).await.unwrap();
    let r = h.call_tool("get_wiki", json!({ "tag_id": tag.id })).await;
    assert!(r.is_null());
}

#[actix_web::test]
async fn get_related_tags_returns_array() {
    let h = McpHarness::start().await;
    let tag = h.core.create_tag("solo", None).await.unwrap();
    let r = h
        .call_tool("get_related_tags", json!({ "tag_id": tag.id }))
        .await;
    // No relations on a fresh DB — but the shape should still be an array
    // (passthrough of `Vec<RelatedTag>`).
    assert!(r.is_array(), "expected array, got {}", r);
}

#[actix_web::test]
async fn get_atom_links_returns_array() {
    let h = McpHarness::start().await;
    let created = h
        .call_tool("create_atom", json!({ "content": "no links here" }))
        .await;
    let atom_id = created["atom_id"].as_str().unwrap().to_string();
    let r = h
        .call_tool("get_atom_links", json!({ "atom_id": atom_id }))
        .await;
    assert!(r.is_array());
}

// ---------------------------------------------------------------------------
// Tests against tools that need an embedder configured.
// Use `McpHarness::start_with_embeddings()`, which fronts the OpenAICompat
// provider with a wiremock server.
// ---------------------------------------------------------------------------

#[actix_web::test]
async fn semantic_search_returns_results_through_mock_provider() {
    let h = McpHarness::start_with_embeddings().await;

    for content in ["alpha note about cats", "beta note about dogs", "gamma note about fish"] {
        h.core
            .create_atom(
                CreateAtomRequest {
                    content: content.to_string(),
                    ..Default::default()
                },
                |_| {},
            )
            .await
            .expect("create_atom");
    }
    h.wait_for_pipeline_idle().await;

    let r = h
        .call_tool(
            "semantic_search",
            json!({ "query": "cats", "limit": 5 }),
        )
        .await;
    let arr = r.as_array().unwrap_or_else(|| panic!("semantic_search must return an array, got {}", r));
    assert!(!arr.is_empty(), "expected ≥1 result, got {}", r);
    // Pin the wire shape — the real consumer (an LLM) depends on these keys.
    let first = &arr[0];
    assert!(first.get("atom_id").is_some(), "missing atom_id: {}", first);
    assert!(
        first.get("similarity_score").is_some(),
        "missing similarity_score: {}",
        first
    );
}

#[actix_web::test]
async fn find_similar_returns_other_atoms_excluding_self() {
    let h = McpHarness::start_with_embeddings().await;

    let seed = h
        .core
        .create_atom(
            CreateAtomRequest {
                content: "alpha seed note".to_string(),
                ..Default::default()
            },
            |_| {},
        )
        .await
        .unwrap()
        .expect("seed atom");
    for content in ["beta companion", "gamma companion"] {
        h.core
            .create_atom(
                CreateAtomRequest {
                    content: content.to_string(),
                    ..Default::default()
                },
                |_| {},
            )
            .await
            .unwrap();
    }
    h.wait_for_pipeline_idle().await;

    let r = h
        .call_tool(
            "find_similar",
            json!({ "atom_id": seed.atom.id, "limit": 5, "threshold": 0.0 }),
        )
        .await;
    let arr = r.as_array().expect("find_similar returns an array");
    assert!(!arr.is_empty(), "expected ≥1 similar atom, got {}", r);
    for item in arr {
        assert_ne!(
            item["atom_id"].as_str(),
            Some(seed.atom.id.as_str()),
            "seed atom appeared in its own find_similar result"
        );
        assert!(item.get("similarity_score").is_some());
    }
}

#[actix_web::test]
async fn get_atom_neighborhood_returns_graph_around_seed() {
    let h = McpHarness::start_with_embeddings().await;

    let seed = h
        .core
        .create_atom(
            CreateAtomRequest {
                content: "graph center note".to_string(),
                ..Default::default()
            },
            |_| {},
        )
        .await
        .unwrap()
        .expect("seed");
    for content in ["neighbor one", "neighbor two"] {
        h.core
            .create_atom(
                CreateAtomRequest {
                    content: content.to_string(),
                    ..Default::default()
                },
                |_| {},
            )
            .await
            .unwrap();
    }
    h.wait_for_pipeline_idle().await;

    let r = h
        .call_tool(
            "get_atom_neighborhood",
            json!({
                "atom_id": seed.atom.id,
                "depth": 1,
                // 0.0 so even tiny similarities surface — the fake embedder
                // produces highly-clustered vectors, but be permissive.
                "min_similarity": 0.0,
            }),
        )
        .await;

    assert_eq!(r["center_atom_id"], json!(seed.atom.id));
    let atoms = r["atoms"].as_array().expect("atoms is an array");
    // The seed itself is always in the neighborhood at depth 0.
    assert!(
        atoms.iter().any(|n| n["atom_id"] == json!(seed.atom.id)),
        "neighborhood did not include the seed atom: {}",
        r
    );
    assert!(r["edges"].is_array(), "edges must be an array, got {}", r);
}

#[actix_web::test]
async fn ingest_url_fetches_article_and_creates_atom() {
    let h = McpHarness::start_with_embeddings().await;
    let url = format!("{}/test-page", h.mock_uri());

    let r = h
        .call_tool("ingest_url", json!({ "url": url.clone() }))
        .await;

    assert_eq!(r["was_existing"], json!(false), "expected fresh ingest, got {}", r);
    assert!(
        r["content_length"].as_u64().unwrap_or(0) > 0,
        "content_length should be positive on fresh ingest, got {}",
        r["content_length"]
    );
    assert_eq!(r["atom"]["source_url"], json!(url));

    // A second call against the same URL should now hit the dedup path.
    let again = h.call_tool("ingest_url", json!({ "url": url })).await;
    assert_eq!(again["was_existing"], json!(true));
}
