# opencode v2 server API — recon against 2.4.2

Everything below was measured on a live `opencode serve` process, not read from
docs. Anything not observed is marked **[unverified]**.

| item | value |
| --- | --- |
| binary | `/tmp/oc2/oc2` (`opencode v2.4.2`) |
| npm package | `@opencode/cli@2.4.2` (the v1 line is still `opencode-ai@1.19.6`) |
| server command | `opencode serve --hostname 127.0.0.1 --port 42000 --cors http://localhost:1420` |
| cwd | `/tmp/oc2/proj` (empty) |
| isolated HOME | `/tmp/oc2/home` |
| OpenAPI document | `/tmp/oc2/openapi.json` (501 486 bytes, OpenAPI 3.1.0, title `opencode HttpApi`, 152 paths) — fetched from `GET /openapi.json` **with Basic auth** |

## 1. `serve` flags (verbatim from `opencode serve --help`)

```
DESCRIPTION
  Start the v2 API and web server

USAGE
  opencode serve [flags]

FLAGS
  --hostname string
  --port integer
  --cors string        Additional allowed CORS origin (repeat for multiple origins)
  --service
  --stdio
```

Global flags of note: `--log-level`, `--print-logs` ("server logs require
`--standalone`"), `--wizard`, `--completions`.

Halyard's argv (`src-tauri/src/server.rs:73-90`, `serve --hostname 127.0.0.1
--port <p> --cors <origin>`) is **still valid**. `--cors` repeats per origin and
is an allow-list: `Origin: http://localhost:1420` gets
`access-control-allow-origin: http://localhost:1420`; an unlisted origin gets no
CORS header at all (request still answers 200).

## 2. Authentication — the breaking change nobody mentions

The v2 server is **not open**. On boot it prints the listen address and a
generated password to stdout:

```
server listening on http://127.0.0.1:42000
server password g4CtkgMDyN0--HXmPMBoLuQWIsjU3A8wLGXaLzme1P4
```

Every API route requires **HTTP Basic** with username `opencode` and that
password. Without it:

```
HTTP/1.1 401 Unauthorized
www-authenticate: Basic realm="Secure Area"
{"_tag":"UnauthorizedError","message":"Authentication required"}
```

- `-u opencode:<password>` → 200. `-u :<password>`, `-u user:<password>`,
  `-u admin:<password>` → 401. Any other username fails.
- `Authorization: Bearer <pw>` and `x-opencode-password: <pw>` both → 401.
- Setting `OPENCODE_PASSWORD=<value>` in the environment pins the password and
  suppresses the printed line. `OPENCODE_PASSWORD=` (empty) behaves as unset:
  new random password, printed.
- There is **no** `--password` / `--no-auth` flag and no documented way to
  disable auth. **[unverified]** whether a config key can.

Consequence for Halyard: it must either set `OPENCODE_PASSWORD` when spawning
(recommended — deterministic, no stdout scraping) or parse `server password ` out
of the child's stdout before its first request. Either way every fetch and the
SSE subscription need `Authorization: Basic base64("opencode:" + password)`.

Halyard's `src-tauri/src/probe.rs:56-73` raw-socket health probe has no auth
support. Against 2.4.2 it reads a `401` body (unauthenticated) — but see §3: the
URL it probes is not even the v2 health route any more.

## 3. Health / info

```
GET /global/health   200  text/html   9401 bytes  ← the web UI's index.html (SPA fallback)
GET /api/health      404
GET /api/info        200  application/json
```

`/global/health` still "answers 200", which is the dangerous part: the legacy
route is gone but the SPA catch-all serves HTML for any unknown non-`/api` path,
so a status-code-only probe passes on a dead endpoint. With no credentials the
same URL returns `401`.

`GET /api/info` (raw, unmodified):

```json
{"version":"2.4.2","pid":51996,"hostname":"cachyos-x8664","urls":["http://127.0.0.1:41999"],"paths":{"tmp":"/tmp/opencode"},"capabilities":{"persistentPty":true}}
```

`ServerInfo` schema: required `version`, `pid`, `urls`, `paths.tmp`;
`hostname` nullable; `capabilities.persistentPty` nullable.

**v2 health check = `GET /api/info` with Basic auth.** There is no boolean
`healthy` field; liveness is a 200 plus a parseable `version`.

## 4. Endpoint table

Measured with `-u opencode:<password>` against 127.0.0.1:42000. "HTML 200" means
the SPA fallback (`200 text/html`, 9401 bytes) — i.e. the legacy route does not
exist. `405` means the path matched the SPA's POST/PATCH handler.

| Halyard call (legacy, v1) | legacy status | v2 replacement | v2 status | v2 response shape |
| --- | --- | --- | --- | --- |
| `GET /global/health` | **HTML 200** | `GET /api/info` | 200 | `{version,pid,hostname,urls,paths,capabilities}` |
| — | — | `GET /api/health` | **404** | — |
| `GET /event` | **HTML 200** (not SSE) | `GET /api/event` | 200 `text/event-stream` | `data: {id,created,type,location,data,durable}` frames + `: heartbeat` |
| `GET /session` | **HTML 200** | `GET /api/session` | 200 | `{data:[Session.Info],cursor:{previous,next}}` |
| `POST /session` | **405** | `POST /api/session` | 200 | `{data:Session.Info}` |
| `PATCH /session/{id}` | **405** | `PATCH /api/session/{id}` | 204 | no body |
| `DELETE /session/{id}` | 405 **[unverified, same SPA]** | `DELETE /api/session/{id}` | 204 | no body; subsequent `GET` → 404 |
| `GET /session/{id}` | **HTML 200** | `GET /api/session/{id}` | 200 | `{data:Session.Info}` |
| `GET /session/{id}/message` | **HTML 200** | `GET /api/session/{id}/message` | 200 | `{data:[Session.Message.Info],cursor:{previous,next}}` |
| `POST /session/{id}/prompt_async` | **405** | `POST /api/session/{id}/prompt` | 400 on `{}` (route exists; `text` required) | `{data:Session.Inbox.User}` |
| `POST /session/{id}/abort` | **405** | `POST /api/session/{id}/interrupt` | 200 | `{interrupted:boolean}` |
| `GET /session/status` | **HTML 200** | `GET /api/session/active` | 200 | `{data:{<sessionID>:{type:"running"}}}` |
| `GET /config` | **HTML 200** | `GET /api/config` | 200 | top-level **array** of config sources `[{"type":"directory","path":...}]` |
| `GET /config/providers` | **HTML 200** | `GET /api/provider` | 200 | `{location,data:[{id,integrationID,name,activation,...}]}` |
| `GET /provider` | **HTML 200** | `GET /api/provider` | 200 | same as above |
| — | — | `GET /api/model` | 200 | `{location,data:[{id,modelID,providerID,type,...}]}` |
| `GET /agent` | **HTML 200** | `GET /api/agent` | 200 | `{location,data:[Agent.Info]}` |
| `GET /command` | **HTML 200** | `GET /api/command` | 200 | `{location,data:[{name,description,...}]}` |
| `GET /vcs` | **HTML 200** | `GET /api/vcs` | 200 | `{location,data:{provider?,branch}}` — today `{"branch":{}}` |
| `GET /file/status` | **HTML 200** | `GET /api/vcs/status` | 200 | `{location,data:[...]}` |
| `GET /session/{id}/todo` | **HTML 200** | *(none)* `GET /api/session/{id}/todo` | **404** | route removed |
| `GET /session/{id}/diff` | **HTML 200** | `GET /api/session/{id}/diff` | 200 | `{data:[{file,patch,additions,deletions,status,more?}]}` |
| `GET /find/file?query=` | **HTML 200** | `GET /api/fs/find?query=` | 200 | `{location,data:[...]}` (params `query`,`type`,`limit`,`location`) |
| `GET /lsp` | **HTML 200** | *(none)* `GET /api/lsp` | **404** | route removed |
| `GET /formatter` | **HTML 200** | *(none)* `GET /api/formatter` | **404** | route removed |
| `GET /mcp` | **HTML 200** | `GET /api/mcp` | 200 | `{location,data:[...]}` |

Additional rows relevant to Halyard, observed live or from the OpenAPI doc:

| Halyard call | legacy status | v2 | status | notes |
| --- | --- | --- | --- | --- |
| `GET /session/{id}/children` | HTML 200 | `GET /api/session?parentID=<id>` | 200 | children are a filter on the session list; `/children` is gone |
| `POST /session/{id}/fork` | 405 | `POST /api/session/{id}/fork` | in OpenAPI | body `{before?: messageID}` |
| `POST /session/{id}/summarize` | 405 | `POST /api/session/{id}/compact` | in OpenAPI | body `{id?,delivery?}`, 200 |
| `POST /session/{id}/revert` | 405 | `DELETE /api/session/{id}/revert` then `POST .../revert/commit` | in OpenAPI | staged-revert flow changed |
| `POST /session/{id}/unrevert` | 405 | `POST /api/session/{id}/revert/commit` (commit) / no "unrevert" | — | **[inferred]** from route names only |
| `GET/POST /session/{id}/share` | HTML 200 / 405 | **no equivalent in OpenAPI** | — | sharing removed from the server API |
| `GET /file?path=` | HTML 200 | `GET /api/fs/list?path=` / `GET /api/fs/read/*` | 200 | `{location,data}` |
| `GET /session/{id}/permissions/{id}` | HTML 200 | `GET /api/session/{id}/permission/{requestID}` `/reply` | in OpenAPI | reply body `{reply:"once"\|"always"\|"reject"}` |
| `GET /api/session/{id}/question` | 404 | `GET /api/session/{id}/form` + `POST .../form/{formID}/reply` | 200 | questions were replaced by forms |
| `GET /provider/auth` | HTML 200 | `GET /api/integration` / `/api/credential` | 200 | provider auth is now integration/credential |
| `POST/DELETE /auth/{providerID}` | 405/[unverified] | `POST /api/integration/{integrationID}/connect/key` (also `.../connect/oauth`, `.../connect/command`, `.../connect/external`) | in OpenAPI | `/api/integration` is `GET`-only, so credentials are attached through the `connect/*` sub-routes |
| `POST /mcp/{name}/connect` | 405 | `PUT/DELETE /api/experimental/mcp/{server}`, `POST .../connect` | — | moved under `/api/experimental/mcp` |
| `GET /session/{id}/context` | — | `GET /api/session/{id}/context` | 200 | `{data:[Session.Message.Info]}` |
| `GET /experimental/resource` | HTML 200 | *(not checked)* | — | **[unverified]** |

### Answer to "which legacy endpoints still work in 2.4.2"

**None of them.** No legacy route survived: every legacy `GET` except the
`/api`-prefixed ones returns the SPA's `index.html` with status 200, and every
legacy write returns 405. The only holder of the old names is the static web UI,
which is why naive status checks keep "passing".

## 5. Event stream

`GET /api/event` (auth required; 401 JSON without) returns
`text/event-stream`. Framing is still SSE with blank-line separated frames and
`: heartbeat` comment lines, so `src/lib/opencode/sse.ts`'s parser is fine. The
envelope is **not** `{id,type,properties}` any more:

```
data: {"id":"evt_21587348b001qnIV5FmMQ6ATs7","type":"server.connected","data":{}}

: heartbeat

data: {"id":"evt_215873a5a001hd06omcQ2Zja1F","created":1795657513562,"type":"session.created","location":{"directory":"/tmp/oc2/proj"},"data":{"sessionID":"ses_dea78c5a8ffebx8c0L0nWKuCbJ","slug":"quiet-lagoon","version":"2.4.2","projectID":"be3cba44ba91773d912e74377721f38dc05c88cd","location":{"directory":"/tmp/oc2/proj"},"subpath":"","title":"sse-trigger"},"durable":{"aggregateID":"ses_dea78c5a8ffebx8c0L0nWKuCbJ","seq":0,"version":1}}
```

So: `id`, `created` (ms epoch, absent on `server.connected`), `type`,
`location.directory` (when scoped), `data` (the v1 `properties`), `durable`
(cursor: `aggregateID`, `seq`, `version`) on persisted events.
`server.connected` is emitted on connect with an empty `data`.

Filtering: `?types=` takes the enum name and repeats — `?types=session.created&types=session.renamed`.
A comma-joined or JSON-array value returns 400 with the full expected list.

Model output streaming was renamed from `message.part.updated`/`message.updated`
to per-stage events. The 100-entry enum includes:

- lifecycle: `session.created`, `session.renamed`, `session.deleted`,
  `session.forked`, `session.archived`, `session.unarchived`, `session.moved`,
  `session.model.selected`, `session.agent.selected`, `session.usage.updated`,
  `session.status`, `session.idle`
- execution: `session.execution.started|succeeded|failed|interrupted`
- text/reasoning: `session.text.started|delta|ended`,
  `session.reasoning.started|delta|ended`
- steps: `session.step.started|first-token|streamed|ended|failed`
- tools: `session.tool.input.started|delta|ended`,
  `session.tool.called|progress|success|failed`
- compaction: `session.compaction.started|delta|ended|failed`
- revert: `session.revert.staged|cleared|committed`
- approvals: `permission.asked`, `permission.replied`, `form.created`,
  `form.replied`, `form.cancelled`
- workspace: `filesystem.changed`, `vcs.branch.updated`, `project.updated`,
  `worktree.updated/resolved`, `config.updated`, `mcp.status.changed`,
  `pty.*`, `shell.*`, `tui.*`, `installation.update-available`

Note `session.status`/`session.idle` exist as events, so a UI can drop the
`/session/status` polling loop entirely.

## 6. Session and message shapes

Create (`POST /api/session` with `{"title":"recon"}`):

```json
{"data":{"id":"ses_dea78ff89ffe4G1bm2hnr1WNzK","projectID":"be3cba44ba91773d912e74377721f38dc05c88cd","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"time":{"created":1795657498753,"updated":1795657498753},"title":"recon","location":{"directory":"/tmp/oc2/proj"}}}
```

List (`GET /api/session?limit=2`) is cursor-paginated, both directions:

```json
{"data":[...],"cursor":{"previous":"eyJhbmNob3IiOnsi...","next":"eyJhbmNob3IiOnsi..."}}
```

Query params: `limit` (default newest 50), `order=asc|desc`, `search`,
`parentID` (or the literal `null`), `archived=true|false`, `directory`
(absolute), `project`, `subpath`, `cursor` (opaque, from `cursor.next`).

Messages (`GET /api/session/{id}/message`) are a flat tagged union, **not**
v1's `{info, parts}` pairs:

```json
{"data":[],"cursor":{"previous":null,"next":null}}
```

`Session.Message.Info = AgentSelected | ModelSelected | LocationSwitched | User |
Synthetic | System | Skill | Shell | Assistant | Compaction | Idle`, each object
keyed by `type`. An assistant message carries `content: [Text|Reasoning|Tool]`
inline, so there is no separate parts endpoint for the common case.

- `Session.Message.User`: `{id, metadata, time{created}, text, files?, agents?, skills?, type:"user"}`
- `Session.Message.Assistant`: `{id, metadata, time{created,firstToken?,streamed?,completed?}, type:"assistant", agent, model, content[]}`

Prompt (`POST /api/session/{id}/prompt`), body `{id?, text (required), files?,
agents?, skills?, metadata?, delivery?, resume?}`. Empty body →

```json
{"_tag":"InvalidRequestError","message":"Missing key\n  at [\"text\"]","kind":"Payload"}
```

with 400. `resume:false` enqueues without starting the agent and returns:

```json
{"data":{"id":"msg_21589d59d001NkKh6San0dUdDs","sessionID":"ses_dea78ff89ffe4G1bm2hnr1WNzK","time":{"created":1795657684407},"type":"user","payload":{"text":"recon no-op"},"delivery":"steer"}}
```

There is no `model` / `agentID` field on the prompt body any more: selection is
`Session.ModelSelected` / `Session.AgentSelected` messages or `PATCH
/api/session/{id}`, and `model` resolves from config.

## 7. Config, providers, status

- `GET /api/config` → **array**, e.g. `[{"type":"directory","path":"/tmp/oc2/home/.config/opencode"}]`. Not the merged object v1 returned. Writes moved to `PATCH /api/experimental/config`.
- `GET /api/provider` → `{"location":{"directory":"/tmp/oc2/proj"},"data":[{"id":"opencode","integrationID":"opencode","name":"OpenCode","activation":"enabled",...}]}`
- `GET /api/model` → `{"location":...,"data":[{"id":"big-pickle","modelID":"big-pickle","providerID":"opencode","type":"chat"},...]}`
- `GET /api/session/active` → `{"data":{}}`; busy sessions appear as `{"<ses_id>":{"type":"running"}}` (schema `SessionActive`).
- `GET /api/vcs` → `{"location":...,"data":{"branch":{}}}`; `Vcs.Info` = `{provider?, branch}`. No `default_branch`.
- `GET /api/session/{id}/diff` → `{"data":[]}` with `FileDiff.Info` = `{file, patch, additions, deletions, status:"added"|"deleted"|"modified", more?}`. Params `from`, `to`, `context`. The v1 keying by `file` survives.

Error bodies are structs, not strings: `{"_tag":"...Error","message":"...","kind":"Payload"}`,
plus 404 `{"_tag":"NotFoundError",...}` and 401 `{"_tag":"UnauthorizedError",...}`.

## 8. Halyard call sites needing change

Mapped to the code as it stands (line numbers from this checkout).

1. **`src-tauri/src/server.rs:73-90`** — argv is fine. Add `OPENCODE_PASSWORD` to
   the child's environment (or parse `server password ` from stdout) and surface
   the password to the frontend so it can build the Basic header.
2. **`src-tauri/src/probe.rs:56-73`** — probes `GET /global/health` and expects
   `{healthy,version}`. Change to `GET /api/info` with the Basic header and treat
   `200 + version` as healthy; a 401 or `text/html` is "up but unusable".
3. **`src/lib/http.ts`** (all fetches) — attach `Authorization: Basic
   base64("opencode:" + password)`. Everything under `/api` needs it, including
   the SSE stream.
4. **`src/lib/opencode/client.ts`**:
   - `101` health → `/api/info`.
   - `105/109/116/120` sessions → `/api/session`; list response is
     `{data,cursor}`, so `listSessions` must unwrap `.data` and pass `limit`/`cursor`.
   - `127` children → `/api/session?parentID=<id>`.
   - `131` fork → `POST /api/session/{id}/fork` with `{before}`.
   - `138` messages → `/api/session/{id}/message`, unwrap `.data`; the union
     described in §6 replaces `{info,parts}` (`types.ts` must be rewritten).
   - `150` prompt_async → `POST /api/session/{id}/prompt`, body `{text, files,
     agents, skills, resume}`, **no** `parts[]`, `model`, `agent`.
   - `157` abort → `POST /api/session/{id}/interrupt`.
   - `161` status → `GET /api/session/active` (`{data:{id:{type:"running"}}}`),
     or derive purely from `session.status` events.
   - `174` vcs → `/api/vcs`; `data.branch` is an object now
     (`{branch:{}}`), so `branch?: string` no longer type-checks.
   - `179` file status → `GET /api/vcs/status`.
   - `184` `/experimental/resource` → **unverified**, no v2 match found.
   - `188` todo → **no route**; remove or reimplement client-side.
   - `192/198/211/242/279/283/287` agent/command/provider/mcp/config → `/api/...`
     versions; `config` returns an array.
   - `300` diff → `/api/session/{id}/diff` (same `file` key, plus
     `status/additions/deletions`).
   - `309-358` `/api/session/{id}/question*` → 404; the replacement is
     `/api/session/{id}/form` + `POST .../form/{formID}/reply`.
   - `366-383` permission → `/api/session/{id}/permission` and
     `/reply` with `{reply:"once"|"always"|"reject"}`; drop the
     `/session/{id}/permissions/{id}` fallback.
   - `417/421` `/file?path=` → `/api/fs/list` / `/api/fs/read/*`.
   - `430/437` revert/unrevert → `DELETE /api/session/{id}/revert`,
     `POST /api/session/{id}/revert/commit`.
   - `449` summarize → `POST /api/session/{id}/compact`.
   - `457/461` share → no server route; remove the feature or gate it.
   - `472` `/find/file` → `/api/fs/find` (`query`,`type`,`limit`).
   - `478` SSE URL → `${baseUrl}/api/event` (with Authorization).
5. **`src/lib/opencode/types.ts:388`** — `ServerEvent` becomes
   `{id, created?, type, location?, data, durable?}`; every `properties.*` read
   moves to `data.*`, and the event names in §5 replace the v1 ones.
   `src/lib/opencode/types.ts:326-328` session status union becomes
   `{type:"running"}` | absent (idle inferred from `session.idle`).
6. **`src/lib/opencode/sse.ts:80+`** — only the URL and auth header change; the
   frame parser is compatible.

## 9. Reproducing this

```sh
mkdir -p /tmp/oc2/{proj,home} && cd /tmp/oc2
npm i @opencode/cli@latest            # v2 ships under this name, not opencode-ai
cp node_modules/@opencode/cli-linux-x64/bin/opencode /tmp/oc2/oc2

cd /tmp/oc2/proj
HOME=/tmp/oc2/home OPENCODE_PASSWORD=hunter2 /tmp/oc2/oc2 serve \
  --hostname 127.0.0.1 --port 42000 --cors http://localhost:1420 &

curl -u opencode:hunter2 http://127.0.0.1:42000/openapi.json -o /tmp/oc2/openapi.json
curl -u opencode:hunter2 http://127.0.0.1:42000/api/info
curl -N -u opencode:hunter2 http://127.0.0.1:42000/api/event
```

Evidence files: `/tmp/oc2/openapi.json`, `/tmp/oc2/logs/server.log`
(boot + generated password), `/tmp/oc2/sse-api.txt` (captured frames),
`/tmp/oc2/session-created.json`.
