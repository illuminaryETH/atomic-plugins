# Changelog

All notable changes to Atomic are documented here.

## v1.25.0 — 2026-04-20

- Replace the CodeMirror markdown editor with Milkdown, a rich-text WYSIWYG editor built on ProseMirror — notes now render inline formatting, images, and code blocks live as you type
- Add slash command menu (type `/`) to quickly insert headings, lists, blockquotes, code blocks, and horizontal rules
- Add selection toolbar for toggling bold, italic, inline code, and links on highlighted text
- Add in-editor find (Cmd/Ctrl+F) with match highlighting and next/previous navigation
- Improve left panel transition animation when opening the note reader

## v1.24.1 — 2026-04-20

- Add manual "Auto-tag" button in the atom reader for tagless atoms, letting you trigger AI tagging on demand
- Improve embedding and tagging pipeline so autosaved drafts are reliably picked up and processed in the background
- Fix bug where editing an atom would not re-run AI tagging, leaving stale or missing tags after content changes
- Fix new-atom button getting hidden behind the chat sidebar when it opens

## v1.24.0 — 2026-04-19

- Add Obsidian-style live-preview markdown editor — edit mode now renders headings, links, emphasis, images, and lists as formatted text; clicking a line reveals its raw markdown for editing, with scroll position preserved across view/edit toggles
- Fix click-to-move-cursor and click-drag text selection in the editor, which previously landed on wrong positions in long documents
- Fix blank lines not appearing when pressing Enter multiple times, and fix list exit so typing after leaving a list is no longer styled as a list item

## v1.23.3 — 2026-04-18

- Improve diagnostic logging when auto-tagging is silently skipped due to missing API key, disabled setting, or no auto-tag targets configured

## v1.23.2 — 2026-04-18

- Fix OpenRouter onboarding flow failing on Docker/reverse-proxy deployments by moving the OAuth callback page out of the `/oauth/` path
- Fix MCP remote-auth consent screen (used by claude.ai) being incorrectly intercepted by the service worker, which caused users to land on the dashboard instead of the authorization page

## v1.23.1 — 2026-04-17

- Add collapsible and draggable popovers on the canvas — atom previews can now be collapsed to just the title bar, dragged freely around the viewport, and dismissed with a close button
- Add database selector to the browser extension — clipped atoms can now be sent to any database on the server, not just the default

## v1.23.0 — 2026-04-17

- Add a first-run welcome screen and guided capture options (URL, RSS feed, markdown folder, Apple Notes, MCP) shown on the dashboard when no atoms or briefings exist yet
- Add Capacitor Android app so the React frontend can run on Android devices alongside the existing iOS build
- Fix atom list layout overflow on mobile — titles now truncate properly and the source pill moves inline with tags on small screens
- Improve onboarding wizard by marking required steps and removing the redundant Skip button
- Fix OpenRouter connection test to use the free `/key` endpoint instead of burning credits on a chat completion

## v1.22.5 — 2026-04-16

- Add canvas hover emphasis that dims non-neighboring nodes and edges with an animated fade, making a hovered node's connections visually pop
- Improve server responsiveness by migrating core storage operations to async, preventing SQLite calls from blocking the request-handling runtime
- Add CI test workflow and expand integration test coverage for multi-database and embedding pipeline scenarios

## v1.22.4 — 2026-04-16

- Fix a startup crash when initializing the desktop app authentication token

## v1.22.3 — 2026-04-16

- Add Postgres-only deployment mode — the server no longer requires a local SQLite registry file, so Postgres deployments need no writable filesystem
- Add Postgres variants of Docker images (`atomic-server-postgres` and `atomic-postgres`) for containerized Postgres deployments
- Add `--storage` and `--database-url` flags to the `token` CLI command for managing API tokens against a Postgres backend
- Fix briefing citations leaking source URLs from other databases in shared-schema (Postgres) deployments
- Fix OAuth code redemption to use a single atomic update, preventing a partial-write race condition

## v1.22.2 — 2026-04-15

- Add recency filter (`since_days`) to Chat and MCP search tools, letting the AI agent narrow results to recent notes when answering time-sensitive questions (e.g. "what did I write last week?")

## v1.22.1 — 2026-04-15

- Fix scheduled tasks (e.g. daily briefing) only running for one database in multi-database deployments

## v1.22.0 — 2026-04-14

- Add Apple Notes importer — import notes directly from macOS Apple Notes with folder-based tags, duplicate detection, and protobuf-to-markdown conversion
- Clicking the source URL on an imported Apple Note now opens the original note in the Apple Notes app using the native `applenotes:` URL scheme
- Show a guided Full Disk Access prompt when Apple Notes import is blocked by macOS permissions, with a direct link to System Settings
- Reorganize the Integrations settings tab into collapsible sections (Markdown Folder, Apple Notes, MCP) for easier navigation

## v1.21.7 — 2026-04-13

- Improve internal release infrastructure

## v1.21.6 — 2026-04-13

- Add knowledge-graph canvas to the Obsidian plugin with curved edges, cluster-colored nodes, cluster labels, and five switchable color themes (Ember, Steel Violet, Aurora, Midnight, Mono)
- Add click-to-open on canvas nodes in the Obsidian plugin — clicking a node navigates to the corresponding Obsidian note
- Add real-time AI-processing progress (embedding and auto-tagging) to the Obsidian plugin onboarding flow so users can see indexing status after initial sync
- Surface previously-silent errors as user-visible notices in the Obsidian plugin (search failures, chat/wiki load errors, sync rename/delete failures)
- Add `source_prefix` filter to the server canvas endpoint, allowing clients to scope the knowledge graph to a specific vault or source
- Prepare the Obsidian plugin for community-directory distribution (MIT license, versions.json, user-facing README, Obsidian API-compliant icon rendering)

## v1.21.5 — 2026-04-13

- Add chat view to the Obsidian plugin with streaming messages, conversation history, and tag-scoped conversations
- Upgrade chat tool-call display: each retrieval step now shows as a persistent, collapsible card with status icon, tool name, and pretty-printed input/output — visible during streaming and preserved after completion
- Improve Obsidian wiki view with clickable citation cross-navigation, loading spinner, and filtered tag selector
- Fix canvas edges not appearing on initial load until a theme change
- Fix crash when viewing an empty atom via the MCP agent tools, and add pagination for large atoms to prevent context overflow
- Remove ~2,600 lines of unused legacy canvas views, drawer, and wiki components

## v1.21.4 — 2026-04-12

- Add URL-based routing — views, tag filters, and open atoms/wikis are now reflected in the URL, enabling browser back/forward navigation and deep links
- Add local cache for tag tree and atom list so the app paints instantly on launch instead of waiting for the network
- Add PWA support for the web build (manifest, service worker, app icons) so the hosted server can be installed as a standalone app on mobile and desktop
- Improve reconnect behavior: transient disconnects are hidden for 4 seconds instead of flashing a banner, and resuming from background reconnects immediately
- Fix overlay back/forward chevrons navigating outside the current overlay session; they now stay scoped to reader/graph/wiki entries and disable at stack boundaries
- Fix WebSocket reconnect race where resuming the app during a pending connection could orphan an in-flight socket

## v1.21.3 — 2026-04-12

- Bundle the MCP bridge with the desktop app and auto-discover auth tokens, so local MCP setup requires no manual token configuration
- Split MCP onboarding and settings into local (stdio) and remote (HTTP + token) modes, with a one-click token provisioning flow for remote connections
- Fix desktop users connected to a remote server seeing the local sidecar URL instead of the active server URL in Mobile and MCP setup sections
- Fix stale MCP config showing after switching between local and remote server modes in settings
- Fix SSE stream handling for multi-line data events in the MCP bridge

## v1.21.2 — 2026-04-12

- Add resizable chat sidebar with drag handle, default width increased to 480px (adjustable 320–800px), persisted across sessions
- Add animated thinking indicator with live retrieval step display while the chat agent searches your knowledge base
- Persist active chat conversation so reopening the sidebar or refreshing restores where you left off

## v1.21.1 — 2026-04-12

- Improve canvas label readability by preventing overlapping atom and cluster labels — largest nodes are prioritized in dense regions

## v1.21.0 — 2026-04-11

- Add Dashboard view with AI daily briefing — a new home screen featuring a scheduled, LLM-generated summary of recently captured atoms with clickable inline citations and an embedded canvas preview
- Add briefing history navigation with prev/next controls to browse past daily briefings
- Consolidate Grid and List into a single Atoms view with a compact layout sub-toggle, simplifying the top-level navigation to four modes: Dashboard, Atoms, Canvas, and Wiki
- Migrate ~170 inline SVG icons to Lucide React, reducing frontend bundle size by ~4 kB gzipped
- Improve reliability of structured LLM outputs (wiki synthesis, tag extraction, briefing) with unified retry logic, tolerant JSON parsing, and a prompt-based fallback for providers that ignore response_format

## v1.20.2 — 2026-04-11

- Cache the global canvas payload in memory with automatic invalidation on atom, tag, and edge changes — eliminates redundant PCA recomputation and makes the canvas load significantly faster after the first request
- Warm the canvas cache at server startup so the first canvas open is instant instead of waiting for a full recompute
- Optimize canvas metadata query from two correlated subqueries per atom to a single JOIN + GROUP BY, improving canvas load time for large knowledge bases
- Serialize concurrent cold-cache canvas rebuilds so multiple simultaneous requests share a single computation instead of racing

## v1.20.1 — 2026-04-11

- Fix release notification formatting in the CI pipeline (no user-facing changes).

## v1.20.0 — 2026-04-11

- Add configurable auto-tag categories — choose which top-level tags the AI auto-tagger is allowed to extend (e.g. disable People/Locations if you don't need them, or add your own like "Projects" or "Books"), manageable during onboarding and in Settings → Tags
- Add Obsidian plugin onboarding wizard with a 4-step setup flow, database selection, size-based sync batching, YAML frontmatter stripping, and real-time sync progress reporting
- Fix mobile layout — sidebar, chat, and filter controls now work correctly on small screens with a slide-in sidebar, full-width chat overlay, filter bottom-sheet, and an overflow menu for reader actions
- Fix Obsidian plugin resync loop when the target database already contains atoms — re-syncing to a populated database now deduplicates server-side instead of retrying endlessly
- Skip the onboarding wizard when connecting to a server that is already configured with an AI provider
- Fix Obsidian plugin wiki view to preserve citation markers for notes outside the current vault instead of stripping them
