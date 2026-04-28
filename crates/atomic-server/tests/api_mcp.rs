//! HTTP integration tests for the MCP tool surface.
//!
//! Spins up a real actix `HttpServer` mounting the same `/mcp` scope
//! (auth + StreamableHttpService) that production uses, performs the
//! `initialize` + `notifications/initialized` handshake to obtain a session,
//! then exercises each tool over JSON-RPC. Responses are SSE — each event's
//! `data: ` line is parsed back to JSON.
//!
//! Tools that need a configured embedder, LLM provider, or external network
//! (`semantic_search`, `find_similar`, `get_atom_neighborhood`, `ingest_url`
//! fresh path) are skipped here; the tests focus on what's exercisable
//! against a clean SQLite database with no provider configured.

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
            _temp: temp,
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
