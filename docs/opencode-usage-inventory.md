# opencode API usage inventory

Inventory of every place Halyard touches the opencode HTTP/SSE API, so a v1 → v2
migration can be exhaustive. Findings only; no proposed v2 equivalents.

Scope note: the only transport primitive is `OpencodeClient.request()` in
`src/lib/opencode/client.ts:75-95`, which prefixes `baseUrl`, sends
`content-type: application/json`, throws `OpencodeError` on non-2xx, and maps
HTTP 204 to `undefined`. The SSE transport is separate:
`src/lib/opencode/sse.ts:82-158` subscribes to the URL returned by
`eventsUrl()`.

## Client methods

50 public methods on `OpencodeClient` (`src/lib/opencode/client.ts`).
"v2?" values: `no` = legacy path only; `v2 only` = targets `/api/...`;
`v1+v2` = version-dispatched with a v2→v1 404 fallback.

| Method | Verb | Path | v2? | Response type cast |
|---|---|---|---|---|
| `health` (line 100) | GET | `/global/health` | no | `{ healthy: boolean; version: string }` |
| `listSessions` (104) | GET | `/session` | no | `Session[]` |
| `createSession` (108) | POST | `/session` | no | `Session` |
| `deleteSession` (115) | DELETE | `/session/{id}` | no | `boolean` |
| `renameSession` (119) | PATCH | `/session/{id}` | no | `Session` |
| `children` (126) | GET | `/session/{id}/children` | no | `Session[]` |
| `forkSession` (130) | POST | `/session/{id}/fork` | no | `Session` |
| `messages` (137) | GET | `/session/{id}/message` | no | `MessageEntry[]` |
| `sendPrompt` (149) | POST | `/session/{id}/prompt_async` | no | `void` |
| `abort` (156) | POST | `/session/{id}/abort` | no | `boolean` |
| `status` (160) | GET | `/session/status` | no | `Record<string, SessionStatus>` |
| `vcs` (173) | GET | `/vcs` | no | `{ branch?: string; default_branch?: string }` |
| `fileStatus` (178) | GET | `/file/status` | no | `Array<Record<string, unknown>>` |
| `resources` (183) | GET | `/experimental/resource` | no | `Record<string, Record<string, unknown>>` |
| `todos` (187) | GET | `/session/{id}/todo` | no | `unknown[]` |
| `agents` (191) | GET | `/agent` | no | `Array<{ name: string; description?: string; mode?: string }>` |
| `commands` (195) | GET | `/command` | no | `Array<{ name: string; description?: string; source?: string }>` |
| `providerCatalogue` (210) | GET | `/provider` | no | `unknown` (comment at 206-208 prefers this over `/config/providers` to avoid plaintext keys) |
| `models` (214) | GET | `/config/providers` | no | `{ providers: Array<{ id; name; models: Record<string, { id; name? }> }>; default: Record<string, string> }` |
| `authMethods` (226) | GET | `/provider/auth` | no | `Record<string, Array<{ type: string; label: string }>>` |
| `setAuth` (230) | PUT | `/auth/{providerID}` | no | `boolean` |
| `removeAuth` (237) | DELETE | `/auth/{providerID}` | no | `boolean` |
| `mcpStatus` (241) | GET | `/mcp` | no | `Record<string, StatusEntry>` |
| `addMcp` (245) | POST | `/mcp` | no | `Record<string, StatusEntry>` |
| `startMcpAuth` (253) | POST | `/mcp/{name}/auth` | no | `{ authorizationUrl: string; oauthState: string }` |
| `clearMcpAuth` (260) | DELETE | `/mcp/{name}/auth` | no | `{ success: boolean }` |
| `connectMcp` (264) | POST | `/mcp/{name}/connect` | no | `boolean` |
| `disconnectMcp` (271) | POST | `/mcp/{name}/disconnect` | no | `boolean` |
| `lspStatus` (278) | GET | `/lsp` | no | `LspStatus[]` |
| `formatterStatus` (282) | GET | `/formatter` | no | `FormatterStatus[]` |
| `config` (286) | GET | `/config` | no | `Record<string, unknown>` |
| `updateConfig` (290) | PATCH | `/config` | no | `Record<string, unknown>` |
| `diff` (297) | GET | `/session/{id}/diff[?messageID=]` | no | `unknown[]` |
| `listQuestions` (308) | GET | `/api/session/{id}/question` | v2 only | `{ data?: unknown[] }`, unwrapped to `unknown[]` |
| `replyQuestion` (319) | POST | `/api/session/{id}/question/{requestID}/reply` then `/question/{requestID}/reply` (v1) | v1+v2 | `unknown` (v2) / `boolean` (v1) |
| `rejectQuestion` (347) | POST | `/api/session/{id}/question/{requestID}/reject` then `/question/{requestID}/reject` (v1) | v1+v2 | `unknown` (v2) / `boolean` (v1) |
| `listPermissions` (365) | GET | `/api/session/{id}/permission` | v2 only | `{ data?: unknown[] }` → `PendingPermission[]` |
| `replyPermissionV2` (375) | POST | `/api/session/{id}/permission/{requestID}/reply` | v2 only | `unknown` |
| `replyPermissionV1` (382) | POST | `/session/{id}/permissions/{requestID}` | no | `boolean` |
| `replyPermission` (395) | POST | v2 URL; v1 URL on `version === 1` or 404 fallback | v1+v2 | delegate |
| `listFiles` (416) | GET | `/file?path={encoded}` | no | `FileNode[]` |
| `readFile` (420) | GET | `/file/content?path={encoded}` | no | `{ type: string; content: string }` |
| `revert` (429) | POST | `/session/{id}/revert` | no | `Session` |
| `unrevert` (436) | POST | `/session/{id}/unrevert` | no | `Session` |
| `summarize` (448) | POST | `/session/{id}/summarize` | no | `Session` |
| `share` (456) | POST | `/session/{id}/share` | no | `Session` |
| `unshare` (460) | DELETE | `/session/{id}/share` | no | `Session` |
| `rename` (464) | PATCH | `/session/{id}` | no | `Session` |
| `files` (471) | GET | `/find/file?query={encoded}&limit={n}&type=file` | no | `string[]` |
| `eventsUrl` (477) | GET (SSE) | `/event` | no | returns URL string |

### Methods with no production caller

`health` (only `src/lib/http.test.ts:44`, `src/lib/opencode/client.test.ts:47`),
`models`, `diff`, `updateConfig`, `rename`, `readFile`, `addMcp`,
`startMcpAuth`, `clearMcpAuth`, `connectMcp`, `disconnectMcp` — 11 methods.
`updateConfig` is additionally known-dead by design: `src-tauri/src/config.rs:3-8`
records that `PATCH /config` validated and echoed but wrote nothing on
opencode 1.18.35, so the settings UI writes the file via Tauri instead
(`src/state/settings.ts:97-100`).

## Call sites

45 production call sites. Grouped by feature. `client` is usually provided by
`src/hooks/use-opencode-client.ts:13-17` or constructed ad hoc from
`phase.info.url` (`src/actions/sessions.ts:16-18`,
`src/components/shell/file-tree.tsx:264-266`,
`src/state/settings.ts:106`).

### Thread hydration, composer and transcript

| file:line | Call | Feature |
|---|---|---|
| `src/components/shell/app-shell.tsx:121` | `client.todos(activeId)` | hydrate the plan/todo panel for the active session |
| `src/components/shell/app-shell.tsx:168` | `client.eventsUrl()` → `connect(...)` | attach the SSE stream |
| `src/components/shell/app-shell.tsx:194` | `client.agents()` | load primary agents for the Plan/Build picker |
| `src/components/shell/app-shell.tsx:205` | `client.listSessions()` | populate the sidebar for the bound directory |
| `src/components/shell/app-shell.tsx:206` | `client.status()` | mark busy sessions from `/session/status` |
| `src/components/shell/app-shell.tsx:249` | `client.messages(activeId)` | first hydration of a thread tab |
| `src/components/shell/app-shell.tsx:253` | `client.listPermissions(activeId)` | restore pending permission cards |
| `src/components/shell/app-shell.tsx:254` | `client.listQuestions(activeId)` | restore pending question cards |
| `src/components/shell/app-shell.tsx:277` | `client.messages(sessionID)` | re-read after server rewrites (undo/redo/compact/edit) |
| `src/components/shell/app-shell.tsx:296` | `client.createSession()` | create a session before the first prompt |
| `src/components/shell/app-shell.tsx:301` | `client.sendPrompt(target, ...)` | send a prompt asynchronously |
| `src/components/shell/app-shell.tsx:321` | `client.abort(activeId)` | stop button |
| `src/components/shell/app-shell.tsx:327` | `client.replyPermission(...)` | approve/deny a permission |
| `src/components/shell/app-shell.tsx:337` | `client.revert(activeId, messageID)` | edit-and-resend truncation |
| `src/components/shell/app-shell.tsx:338` | `client.sendPrompt(activeId, ...)` | resend edited prompt |
| `src/components/shell/app-shell.tsx:347` | `client.replyQuestion(..., pending.version)` | answer an agent question |
| `src/components/shell/app-shell.tsx:356` | `client.rejectQuestion(..., pending.version)` | dismiss an agent question |
| `src/components/shell/app-shell.tsx:388` | `client.revert(activeId, last)` | undo last turn |
| `src/components/shell/app-shell.tsx:398` | `client.unrevert(activeId)` | redo undone turn |
| `src/components/shell/app-shell.tsx:421` | `client.summarize(activeId, model)` | compact/summarize the session |
| `src/components/shell/app-shell.tsx:468` | `client.files(query, 12)` | `@`-mention file search |
| `src/components/shell/app-shell.tsx:494` | `client.createSession()` | New session command |

### Session mutations (`src/actions/sessions.ts`)

| file:line | Call | Feature |
|---|---|---|
| `src/actions/sessions.ts:39` | `api.deleteSession(sessionId)` | delete session (after confirm) |
| `src/actions/sessions.ts:56` | `api.renameSession(sessionId, trimmed)` | rename session |
| `src/actions/sessions.ts:69` | `api.createSession()` | create session action |
| `src/actions/sessions.ts:83` | `api.forkSession(sessionId)` | fork session |
| `src/actions/sessions.ts:103` | `api.children(parentId)` | load child sessions into the sidebar tree |

### Files and resources

| file:line | Call | Feature |
|---|---|---|
| `src/components/shell/file-tree.tsx:277` | `client.listFiles(path)` | directory tree listing (`""` = root) |
| `src/components/shell/resources-tab.tsx:26` | `client.resources()` | skills/resources panel |

### Providers, models and auth

| file:line | Call | Feature |
|---|---|---|
| `src/state/models.ts:70` | `client.providerCatalogue()` | model picker catalogue |
| `src/state/system.ts:154` | `client.providerCatalogue()` | Providers settings tab |
| `src/state/system.ts:155` | `client.authMethods()` | credential method list per provider |
| `src/components/shell/settings-tabs.tsx:296` | `client.setAuth(...)` | connect a provider |
| `src/components/shell/settings-tabs.tsx:312` | `client.removeAuth(id)` | disconnect a provider |

### Diagnostics, config and catalogue

| file:line | Call | Feature |
|---|---|---|
| `src/state/system.ts:176` | `client.mcpStatus()` | MCP status rows |
| `src/state/system.ts:177` | `client.lspStatus()` | LSP status rows |
| `src/state/system.ts:178` | `client.formatterStatus()` | formatter status rows |
| `src/state/system.ts:186` | `client.agents()` | full agent roster for settings/`@` hints |
| `src/state/settings.ts:107` | `client.config()` | effective on-disk config preview |
| `src/state/catalogue.ts:62` | `client.commands()` | slash-command catalogue |
| `src/state/catalogue.ts:63` | `client.resources()` | skill catalogue for `/` suggestions |

### Project and sharing

| file:line | Call | Feature |
|---|---|---|
| `src/state/project-info.ts:42` | `client.vcs()` | branch / default branch badge |
| `src/state/project-info.ts:43` | `client.fileStatus()` | changed-file counts |
| `src/components/shell/sidebar.tsx:95` | `new OpencodeClient(...).listSessions()` | refresh list after importing a session file |
| `src/components/shell/sidebar.tsx:136` | `new OpencodeClient(...).share(session.id)` | publish/share a session |

## Tests pinning API surface

Counts: 21 cases in `src/lib/opencode/client.test.ts` (16 assert paths, verbs or
payload bodies), 2 receiver cases in `src/lib/http.test.ts`, 13 SSE cases in
`src/lib/opencode/sse.test.ts` (5 subscribe via a literal `/event` URL), 8
catalogue routing cases, plus event/payload-shape fixtures listed below.

### `src/lib/opencode/client.test.ts` (21 cases)

| line | Literal assertion |
|---|---|
| `:19` | `expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:5555/session", expect.anything())` |
| `:23-25` | `eventsUrl()` === `"http://127.0.0.1:4096/event"` |
| `:32` | `listSessions()` resolves to parsed body |
| `:39-40` | 404 rejects with `OpencodeError({ status: 404 })` |
| `:47` | unreachable server rejects `/cannot reach opencode/` (calls `health()`) |
| `:62` | URL `"http://x/session/ses_1/prompt_async"`; `:63` method POST; `:64-67` body `{ model, parts }` |
| `:75` | `createSession()` body `{}` |
| `:81` | `createSession("My work")` body `{ title: "My work" }` |
| `:89` | `"http://x/find/file?query=a%20b%26c&limit=5&type=file"` |
| `:95` | delete uses method `DELETE` |
| `:102-103` | rename uses method `PATCH`, body `{ title: "New" }` |
| `:112` | `listFiles("")` URL includes `/file?path=` |
| `:120` | `listFiles("src/lib")` URL encodes path |
| `:137-138` | v2 permission reply URL `/api/session/ses_1/permission/per_1/reply`, body `{ reply }` |
| `:144-145` | v1 permission reply URL `/session/ses_1/permissions/per_1` |
| `:155-156` | v2 404 falls back to `/session/ses_1/permissions/per_1` |
| `:164` | 500 does **not** fall back (`toHaveBeenCalledTimes(1)`) |
| `:169-173` | `listPermissions` unwraps `{ data: [...] }` and stamps `version: 2` |
| `:177-178` | unrenderable permission rows dropped |
| `:186-187` | revert URL `"http://x/session/ses_1/revert"`, body `{ messageID: "msg_9" }` |
| `:193-196` | revert body adds `partID: "prt_2"` |

### Receiver / SSE transport

| file:line | Pin |
|---|---|
| `src/lib/http.test.ts:43-46` | default client calls `window.fetch` (asserts `thisArg === window`); uses `health()` |
| `src/lib/http.test.ts:55-57` | SSE `subscribe("http://127.0.0.1:4096/event", ...)` |
| `src/lib/opencode/sse.test.ts:84` | `subscribe("http://127.0.0.1:4096/event", ...)` |
| `src/lib/opencode/sse.test.ts:87,92` | frame `server.connected` delivered |
| `src/lib/opencode/sse.test.ts:98,101,106-107` | malformed frame skipped, `session.idle` still delivered |
| `src/lib/opencode/sse.test.ts:113` | URL `"http://127.0.0.1:4096/event"` |
| `src/lib/opencode/sse.test.ts:136` | URL `"http://127.0.0.1:4096/event"` |
| `src/lib/opencode/sse.test.ts:152` | URL `"http://127.0.0.1:4096/event"` |

### Path-routing mocks in component/store tests

| file:line | Pin |
|---|---|
| `src/components/shell/app-shell.test.tsx:26` | stub fetch matches `url.includes("/event")` |
| `src/components/shell/app-shell.test.tsx:32` | matches `/session` |
| `src/components/shell/app-shell.test.tsx:37` | matches `/command` |
| `src/components/shell/app-shell.test.tsx:42` | matches `/experimental/resource` |
| `src/state/catalogue.test.ts:13-24` | fetch stub keyed on URLs; returns 404 for unmatched routes |
| `src/state/catalogue.test.ts:52,64,74,88,100,114,125,134,144,149,154,159,167` | route `/\/command$/` and call counts |
| `src/state/catalogue.test.ts:151` | ingest `plugin.added` |
| `src/state/catalogue.test.ts:165` | ingest `lsp.updated` |
| `src/state/mode.test.ts:183-201` | prompt body `{ model: { providerID: "opencode", modelID: "exo-free" }, agent: "plan", parts: [...] }` |

### Payload-shape fixtures (SSE and HTTP bodies)

| file:line | Pin |
|---|---|
| `src/lib/opencode/models.test.ts:15-37` | `/provider` response shape: `{ all: [{ id, name, key, models: { ... } }] }` |
| `src/lib/opencode/thread.test.ts:103,113,116,134,141,150,170,182` | `message.part.delta` / `message.updated` payloads |
| `src/lib/opencode/thread.test.ts:197,210,227-251,256,276` | `message.part.updated`, tool parts, `session.idle` payloads |
| `src/state/threads.test.ts:32` | `message.part.delta` |
| `src/state/threads.test.ts:124` | `message.part.updated` |
| `src/state/threads.test.ts:165,174,178` | `session.status`, `session.idle` |
| `src/state/permissions.test.ts:22` | `permission.v2.asked` |
| `src/state/permissions.test.ts:36` | `permission.asked` (v1) |
| `src/state/permissions.test.ts:121,127,131,146` | `permission.replied` / `permission.v2.replied` |
| `src/state/permissions.test.ts:156,175,212` | `permission.v2.asked` merge/dedupe fixtures |
| `src/state/sessions.test.ts:217` | `session.created` |
| `src/state/mode.test.ts:107-153` | `session.updated`, `session.deleted`, `server.heartbeat` |
| `src/components/chat/question-card.test.tsx:21` | `question.v2.asked` fixture |
| `src/components/chat/question-card.test.tsx:96` | `question.asked` (v1) |
| `src/components/chat/question-card.test.tsx:113,123` | `question.v2.replied`, `question.v2.rejected` |
| `src/components/shell/settings-tabs.test.tsx:252` | ingest `message.part.updated` |
| `src/components/shell/settings-tabs.test.tsx:259` | ingest `catalog.updated` |
| `src/components/shell/settings-tabs.test.tsx:270` | ingest `mcp.tools.changed` |
| `src/test/setup.ts:51` | stubbed `startServer` reports `version: "1.18.35"` |

### Rust tests

| file:line | Pin |
|---|---|
| `src-tauri/src/probe.rs:123-131` | healthy body `{"healthy":true,"version":"1.18.35"}` |
| `src-tauri/src/probe.rs:134-142` | healthy without version → `"unknown"` |
| `src-tauri/src/probe.rs:144-155` | `healthy:false` and malformed JSON → `Unhealthy` |
| `src-tauri/src/probe.rs:157-164` | real socket returns `Ready { version: "1.18.35" }` |
| `src-tauri/src/probe.rs:166-183` | 404 → `Unhealthy`; dead port → `Unreachable` |
| `src-tauri/src/server.rs:435-441` | spawn args begin `["serve", "--hostname", "127.0.0.1"]` |
| `src-tauri/src/server.rs:442-445` | `--port` argument |
| `src-tauri/src/server.rs:447-457` | `--cors` per configured origin |
| `src-tauri/src/server.rs:469-474` | `server_url(4096) == "http://127.0.0.1:4096"`, never `0.0.0.0` |

## Rust HTTP touchpoints

| file:line | Interaction |
|---|---|
| `src-tauri/src/probe.rs:56-90` | `probe_health(port, timeout)`: raw `TcpStream` connection to `127.0.0.1:{port}` and one `GET /global/health`. Request line at `src-tauri/src/probe.rs:66`. Accepts only HTTP/1.1 or HTTP/1.0 `200` (`:86`), then `parse_health` (`:40-52`). |
| `src-tauri/src/probe.rs:15-23` | `free_port()` binds a loopback `TcpListener` to port 0 to pick a port; not a request to opencode. |
| `src-tauri/src/server.rs:212` | spawns the `opencode serve` child with `build_args` (`--hostname 127.0.0.1 --port ... [--cors ...]`); process lifecycle only, no HTTP response handling. |
| `src-tauri/src/transfer.rs:3-8` | export/import shell out to the `opencode` CLI; comment states there is no HTTP equivalent used. |
| `src-tauri/src/config.rs` | reads/writes opencode config files on disk; no socket. |

`Cargo.toml` has no HTTP client crate (no `reqwest`/`ureq`/`hyper`), confirming
`probe.rs` is the sole Rust-side HTTP caller. Besides `/global/health`, no
endpoint is called from Rust.

## Existing version handling

- **No version comparison or gating exists.** The server-reported version is
  parsed and displayed, never branched on.
- `src-tauri/src/probe.rs:40-51` parses `healthy` and `version` from
  `/global/health`; missing version defaults to `"unknown"`.
- `src-tauri/src/server.rs:247-256` copies `Health::Ready { version }` into
  `ServerInfo { version }` (`src-tauri/src/server.rs:47-53`).
- TS plumbing: `src/lib/tauri.ts:14` `ServerInfo.version` →
  `src/state/server.ts:105` `version: status.version`.
- Display only: `src/components/shell/title-bar.tsx:86` and
  `src/components/shell/settings-dialog.tsx:114` render `opencode {version}`.
- `src/lib/opencode/client.ts:101` declares `health()`'s
  `{ healthy, version }` shape, but `health()` has no production caller.
- **v1/v2 selection is payload-driven, not version-driven:**
  - Questions decide on the event name:
    `src/state/questions.ts:123` sets `version: event.type === "question.asked" ? 1 : 2`
    (`question.v2.asked` → 2).
  - Permissions decide on the event name:
    `src/state/permissions.ts:59-66` maps `permission.asked` → `fromV1`,
    `permission.v2.asked` → `fromV2`; removal handles both
    `permission.replied` and `permission.v2.replied`
    (`src/state/permissions.ts:68-73`).
  - That version is carried into replies from the UI:
    `src/components/shell/app-shell.tsx:347,356` pass `pending.version`;
    `src/lib/opencode/client.ts:396` chooses `replyPermissionV1` when
    `permission.version === 1`, else v2 with a 404 fallback.
- Protocol behavior is documented against a specific build but not enforced:
  `src/lib/opencode/client.ts:50-53` (prompt_async vs blocking message,
  "verified against opencode 1.18.35") and `src-tauri/src/config.rs:3-8`
  (`PATCH /config` no-op on 1.18.35).
