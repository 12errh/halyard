# OpenCode v2.4.2 — events & API reference

Schema-derived from the server's own OpenAPI 3.1 document (`/tmp/oc2/openapi.json`, 152 paths,
556 component schemas) at `http://127.0.0.1:42000`. Where a line says **LIVE**, it was captured
against a running `oc2 serve` and the raw frame is shown in §12. Everything else is the exact
component schema; field names, required lists and enums are copied verbatim, not paraphrased.

> v1 → v2 in one sentence: the SSE feed is now a uniform `V2Event` envelope over `/api/event`
> (durable + ephemeral events), message history is a flat message array, tool calls are message
> content parts (not separate `part` objects), questions became generic forms, and filesystem
> reads are raw bytes behind a wildcard path.

---

## 1. Event envelope

`V2Event` (`components.schemas.V2Event`) is `anyOf` of 102 event schemas. Every event object has:

| field | type | required | notes |
|---|---|---|---|
| `id` | `Event.ID` (`string`, `^evt_`) | yes | monotonic-ish event id |
| `created` | `number` (epoch ms) | yes on every event except `server.connected` | |
| `type` | `string` enum | yes | wire type, see catalog |
| `data` | `object` | yes | per-event payload |
| `location` | `Location.Ref \| Location.PublicRef \| null` | no | project location; present on session-scoped events |
| `metadata` | `object` | no | |
| `durable` | `{ aggregateID: string, seq: number, version: number }` | yes on durable events | ordering/replay token |

Durable events require `["id","created","type","durable","data"]`; ephemeral events require
`["id","created","type","data"]`. `server.connected` requires only `["id","type","data"]`.

```ts
// components.schemas.V2Event
interface V2Event {
  id: string;                 // ^evt_
  created?: number;
  type: V2EventType;
  data: unknown;
  location?: LocationRef | LocationPublicRef | null;
  metadata?: Record<string, unknown>;
  durable?: { aggregateID: string; seq: number; version: number };
}

interface LocationRef { directory: string; workspaceID?: string }
interface LocationPublicRef { directory: string }
```

SSE wire: each frame is `data: <V2Event JSON>\n\n`; the server also emits `: heartbeat\n\n`
comment frames roughly every 10s (LIVE). No `id:` or `event:` lines were observed.

`GET /api/event` query `types` accepts a single enum string **or** an array (`?types=a&types=b`).
`server.connected` is **not** a filterable value — requesting `types=server.connected` returns
400 — but it is always sent first when the stream opens. Omitting `types` sends all events.

### Event type catalog (102)

| group | types |
|---|---|
| server | `server.connected`, `location.shutdown`, `models-dev.refreshed` |
| config/registry | `credential.updated`, `credential.switched`, `integration.updated`, `provider.updated`, `model.updated`, `agent.updated`, `plugin.updated`, `project.updated`, `worktree.updated`, `worktree.resolved`, `command.updated`, `config.updated`, `skill.updated`, `reference.updated`, `installation.updated`, `installation.update-available` |
| session lifecycle | `session.created`, `session.moved`, `session.renamed`, `session.archived`, `session.unarchived`, `session.deleted`, `session.forked`, `session.viewed`, `session.metadata.updated`, `session.permissions`, `session.model.selected`, `session.agent.selected`, `session.instructions.updated`, `session.synthetic`, `session.skill.activated` |
| session status | `session.status` (schema `SessionStatusUpdated`), `session.idle`, `session.usage.updated` |
| inbox / steering | `session.inbox.delivered`, `session.inbox.enqueued`, `session.inbox.cancelled`, `session.inbox.delivery.changed` |
| execution | `session.execution.started`, `session.execution.succeeded`, `session.execution.failed`, `session.execution.interrupted` |
| steps | `session.step.started`, `session.step.first-token`, `session.step.streamed`, `session.step.ended`, `session.step.failed`, `session.retry.scheduled` |
| streaming text | `session.text.started`, `session.text.delta`, `session.text.ended`, `session.reasoning.started`, `session.reasoning.delta`, `session.reasoning.ended` |
| tools | `session.tool.input.started`, `session.tool.input.delta`, `session.tool.input.ended`, `session.tool.called`, `session.tool.progress`, `session.tool.success`, `session.tool.failed` |
| compaction | `session.compaction.started`, `session.compaction.delta`, `session.compaction.ended`, `session.compaction.failed` |
| revert | `session.revert.staged`, `session.revert.cleared`, `session.revert.committed` |
| shells/pty | `session.shell.started`, `session.shell.ended`, `pty.created`, `pty.updated`, `pty.exited`, `pty.deleted`, `persistent-pty.added`, `persistent-pty.removed`, `persistent-pty.updated`, `shell.created`, `shell.exited`, `shell.deleted` |
| permissions | `permission.asked`, `permission.replied` |
| forms | `form.created`, `form.replied`, `form.cancelled` |
| filesystem/vcs/mcp | `filesystem.changed`, `vcs.branch.updated`, `mcp.status.changed`, `mcp.resources.changed`, `experimental.mcp.event` |
| TUI / misc | `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `tui.session.select`, `experimental.job.updated`, `websearch.updated`, `experimental.push.updated`, `artifact.updated` |

**There is no `session.error` event.** Errors surface as `session.execution.failed`,
`session.step.failed`, `session.tool.failed`, `session.compaction.failed`, or as an assistant
message with an `error` field. There is no `session.usage.recorded`; the event is
`session.usage.updated`.

---

## 2. Event payloads

Legend: **cumulative** = payload replaces the value in the store; **delta** = append/merge.
All session-scoped payloads carry `sessionID` (`^ses`).

### 2.1 Server

```json
{"id":"evt_215900e73001izVmvKSZrGo1Vq","type":"server.connected","data":{}}
```
`data` is `{}` (an object, not `null`). Schema `V2Event.server.connected`.

### 2.2 Session lifecycle

| type | durable | `data` required | optional | reducer |
|---|---|---|---|---|
| `session.created` | yes | `sessionID, projectID, location, slug, version` | `subpath, parentID, title, agent, model, metadata, permissions` | insert |
| `session.renamed` | yes | `sessionID, title` | — | patch `title` |
| `session.archived` | yes | `sessionID` | — | patch `archived=true` |
| `session.unarchived` | yes | `sessionID` | — | patch `archived=false` |
| `session.deleted` | yes | `sessionID` | — | remove |
| `session.forked` | yes | `sessionID, parentID, boundary` | `instructions, instructionEntries` | insert child |
| `session.moved` | yes | `sessionID, location, projectID` | `subpath` | patch location |
| `session.model.selected` | yes | `sessionID, model` | `previous` | patch model |
| `session.agent.selected` | yes | `sessionID, agent` | `previous` | patch agent |
| `session.usage.updated` | no | `sessionID, cost, tokens` | — | **cumulative** replace totals |
| `session.status` | no | `sessionID, status` | — | replace status |
| `session.idle` | no | `sessionID` | — | mark idle |

`session.created` sends a `Location.Ref` (`{directory, workspaceID?}`); `location` on other
events may be `Location.PublicRef` (`{directory}`). `version` is the server version string
(`"2.4.2"`). LIVE frame in §12.

`session.forked.boundary` is `Session.ForkBoundary`:
```ts
type SessionForkBoundary =
  | { type: "before";  messageID: string }   // ^msg_
  | { type: "through"; messageID: string };
```

`SessionStatus` (`session.status` payload):
```ts
type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }                          // v1 called this "running"
  | { type: "retry"; attempt: number; message: string; next: number;
      action?: { reason: string; provider: string; title: string;
                 message: string; label: string; link?: string } };
```
LIVE: `session.status` and `session.idle` were **not** emitted during a normal prompt run even
when subscribed; the durable `idle` message in history is what the transcript showed (§3).
Handle them, but do not depend on them for "turn finished" — use
`session.execution.succeeded/failed/interrupted` and `session.step.ended`.

### 2.3 Text & reasoning (delta streams)

Both text and reasoning are keyed by `(assistantMessageID, ordinal)`, where `ordinal` is the
index of that content block inside the assistant message.

| type | durable | required `data` |
|---|---|---|
| `session.text.started` | yes | `sessionID, assistantMessageID, ordinal` |
| `session.text.delta` | no | `sessionID, assistantMessageID, ordinal, delta` |
| `session.text.ended` | yes | `sessionID, assistantMessageID, ordinal, text` (+`native?`) |
| `session.reasoning.started` | yes | `sessionID, assistantMessageID, ordinal` (+`native?`) |
| `session.reasoning.delta` | no | `sessionID, assistantMessageID, ordinal, delta` |
| `session.reasoning.ended` | yes | `sessionID, assistantMessageID, ordinal, text` (+`native?`) |

`delta` is **incremental**; `text` on `.ended` is the **full cumulative text for that ordinal**.
Reducer: append `delta`; on `.ended` replace the block's text with `text`.
LIVE frame §12 (`delta:"DONE"`).

### 2.4 Execution

| type | durable | required `data` |
|---|---|---|
| `session.execution.started` | yes | `sessionID` |
| `session.execution.succeeded` | yes | `sessionID` |
| `session.execution.failed` | yes | `sessionID, error` |
| `session.execution.interrupted` | yes | `sessionID, reason` |

`reason` enum: `user | shutdown | superseded | inactivity`. `error` is `Session.StructuredError`.

### 2.5 Steps

| type | durable | required `data` |
|---|---|---|
| `session.step.started` | yes | `sessionID, assistantMessageID, agent, model, started` (+`snapshot?`) |
| `session.step.first-token` | yes | `sessionID, assistantMessageID` |
| `session.step.streamed` | yes | `sessionID, assistantMessageID` |
| `session.step.ended` | yes | `sessionID, assistantMessageID, finish, cost, tokens` (+`rawFinish?, native?`) |
| `session.step.failed` | yes | `sessionID, assistantMessageID, error` (+`finish?`) |
| `session.retry.scheduled` | yes | `sessionID, assistantMessageID, attempt, at, error` |

`finish` enum: `stop | length | tool-calls | content-filter | error | unknown`.
`started`/`at` are epoch-ms integers. `.ended` is cumulative for cost/tokens/finish.

### 2.6 Tools

A tool call has one id (`id`, the assistant content part id — there is no separate `toolCallID`)
and always carries the owning `assistantMessageID`.

| type | durable | required `data` | semantics |
|---|---|---|---|
| `session.tool.input.started` | yes | `sessionID, assistantMessageID, id, name` | open streaming input |
| `session.tool.input.delta` | no | `sessionID, assistantMessageID, id, delta` | **delta** append to raw JSON string |
| `session.tool.input.ended` | yes | `sessionID, assistantMessageID, id, text` | **cumulative** final raw input string |
| `session.tool.called` | yes | `sessionID, assistantMessageID, id, input, executed` | **cumulative** parsed `input` object; adds `executed`, `native?` |
| `session.tool.progress` | no | `sessionID, assistantMessageID, id, metadata` | merge/replace `metadata` |
| `session.tool.success` | yes | `sessionID, assistantMessageID, id, content, executed` (+`metadata?, native?`) | **cumulative** result; state → completed |
| `session.tool.failed` | yes | `sessionID, assistantMessageID, id, error, executed` (+`content?, metadata?, native?`) | state → error |

`content` is `Tool.Content[]` = `({type:"text",text} | {type:"file",uri,mime,name?})[]`.
LIVE `session.tool.success` frame in §12.

### 2.7 Compaction

| type | durable | required `data` | optional |
|---|---|---|---|
| `session.compaction.started` | yes | `sessionID, reason` (`auto|manual`) | `inputID` |
| `session.compaction.delta` | no | `sessionID, text` | — (delta) |
| `session.compaction.ended` | yes | `sessionID, reason, text` | `model, native, cost, tokens` |
| `session.compaction.failed` | yes | `sessionID, reason, error` | `inputID, cost, tokens` |

### 2.8 Revert

| type | durable | required `data` |
|---|---|---|
| `session.revert.staged` | yes | `sessionID, revert` (`Session.Revert`) |
| `session.revert.cleared` | yes | `sessionID` |
| `session.revert.committed` | yes | `sessionID, to` (`to` = messageID) |

### 2.9 Permissions

```json
// permission.asked (ephemeral)
{"id":"evt_...","created":1710000000000,"type":"permission.asked",
 "data":{"id":"per_...","sessionID":"ses_...","action":"bash",
         "resources":["rm -rf /tmp/x"],"save":[],"metadata":{},
         "source":{"type":"tool","messageID":"msg_...","id":"call_..."},
         "message":"..."}}
```
required `data`: `id, sessionID, action, resources`; optional `save, metadata, source, message`.

```json
// permission.replied (ephemeral)
{"type":"permission.replied","data":{"sessionID":"ses_...","requestID":"per_...","reply":"once"}}
```
`reply` enum `once | always | reject`. Reducer: `.asked` add to pending map; `.replied` remove.

### 2.10 Forms

| type | data |
|---|---|
| `form.created` | `{ form: Form.Info }` — `Form.Info` **without** `state` |
| `form.replied` | `{ form: Form.Info, answer: Form.Answer }` |
| `form.cancelled` | `{ form: Form.Info, message?: string }` |

`Form.Info` and `Form.Info_1` (used by `form.created`) are structurally identical: required
`id, sessionID, title, fields`; `metadata?`. Reducer: add/remove by `form.id`.

### 2.11 Filesystem / VCS / config / MCP

| type | durable | `data` | reducer |
|---|---|---|---|
| `filesystem.changed` | no | `{file: string, event: "add"\|"change"\|"unlink"}` | invalidate `file` |
| `vcs.branch.updated` | no | `{branch?: string}` (all optional) | replace branch |
| `config.updated` | no | `{}` | invalidate config |
| `mcp.status.changed` | no | `{server: string}` only | **refetch** `GET /api/mcp`; no status in the payload |
| `mcp.resources.changed` | no | `{server?: string}` | refetch `/api/mcp/resource` |

---

## 3. Message model

`GET /api/session/{sessionID}/message` → `{ data: Session.Message.Info[], cursor: {previous, next} }`.

`Session.Message.Info` is a union of 11 variants:
`AgentSelected | ModelSelected | LocationSwitched | User | Synthetic | System | Skill | Shell |
Assistant | Compaction | Idle`.

Common fields on every message: `id` (`^msg_`), `time.created` (number), `type`, optional
`metadata`. Message ids are **flat** in the history array — there are no separate `part`
objects; an assistant message's `content` array is the parts.

```ts
interface MessageTime { created: number }

interface SessionMessageUser {
  id: string; time: MessageTime; type: "user";   // required: id,time,text,type
  text: string;
  files?: PromptFileAttachment[];
  agents?: PromptAgentAttachment[];
  skills?: PromptSkillAttachment[];
}

interface SessionMessageAssistant {
  id: string; time: { created: number; firstToken?: number;
                      streamed?: number; completed?: number };
  type: "assistant";
  agent: string; model: ModelRef;
  content: AssistantContent[];
  snapshot?: { start?: string; end?: string; files?: string[] };
  finish?: "stop"|"length"|"tool-calls"|"content-filter"|"error"|"unknown";
  rawFinish?: string;
  native?: Record<string, unknown>;
  cost?: number; tokens?: TokenUsage;
  error?: StructuredError;
  retry?: { attempt: number; at: number; error: StructuredError };
}

type AssistantContent =
  | { type: "text"; text: string; native?: object }
  | { type: "reasoning"; text: string; native?: object;
      time?: { created: number; completed?: number } }
  | { type: "tool"; id: string; name: string; executed?: boolean;
      state: ToolState; time: { created: number; ran?: number; completed?: number };
      native?: object };

type ToolState =
  | { status: "streaming"; input: string }
  | { status: "running"; input: object; metadata: object }
  | { status: "completed"; input: object; content: ToolContent[]; metadata?: object }
  | { status: "error"; input: object; error: StructuredError;
      content?: ToolContent[]; metadata?: object };

type ToolContent =
  | { type: "text"; text: string }
  | { type: "file"; uri: string; mime: string; name?: string | null };

interface ModelRef { id: string; providerID: string; variant?: string }
interface TokenUsage { input: number; output: number; reasoning: number;
                       cache: { read: number; write: number } }
interface StructuredError {
  type: string; message: string; status?: number;
  response?: { body: string }; retryAfterMs?: number;
}
```

Other variants (exact required fields):

```ts
{ type:"idle";        id,time,outcome: "succeeded"|"failed"|"interrupted", error? }
{ type:"system";      id,time,text, description? }
{ type:"synthetic";   id,time,text, description? }
{ type:"skill";       id,time,skill,name,text }
{ type:"shell";       id,time,shellID,command,status:"running"|"exited"|"timeout"|"killed",
                      exit?, output?:{output,cursor,size,truncated} }
{ type:"model-switched";        id,time,model,previous? }   // Session.Message.ModelSelected
{ type:"agent-switched";        id,time,agent,previous? }
{ type:"location-switched";     id,time,location,projectID?,subpath?,previous? }
// compaction: summary is REQUIRED on running and completed; error on failed
{ type:"compaction"; id,time,status:"running"; reason:"auto"|"manual"; summary:string }
{ type:"compaction"; id,time,status:"completed"; reason:"auto"|"manual"; summary:string;
  model?, native?, cost?, tokens? }
{ type:"compaction"; id,time,status:"failed"; reason:"auto"|"manual";
  error:StructuredError; cost?, tokens? }
```

**v1 difference:** history `user` messages are flat (`text` at top level). The inbox/write
response (`Session.Inbox.User`) instead nests `payload: {text, files, agents, ...}` and adds
`sessionID` + `delivery`. Do not feed an inbox item straight into the transcript reducer.

LIVE assistant message with a tool call (truncated reasoning omitted):

```json
{
  "id": "msg_2158fc0360018wQKAHMv4PIPkR",
  "time": {"created":1795658072128,"firstToken":1795658073848,
           "streamed":1795658074404,"completed":1795658074429},
  "type": "assistant", "agent": "build",
  "model": {"id":"big-pickle","providerID":"opencode"},
  "content": [
    {"type":"text","text":"Hello there, how are you?\n\n"},
    {"type":"tool","id":"chatcmpl-tool-bd91c060f8479d4c","name":"read","executed":false,
     "state":{"status":"completed","input":{"path":"/tmp/oc2/proj"},
              "content":[{"type":"text","text":"Read directory /tmp/oc2/proj, entries 1-1\nhello.txt"}],
              "metadata":{"truncated":false}},
     "time":{"created":1795658074333,"ran":1795658074395,"completed":1795658074423}}
  ],
  "finish":"tool-calls","rawFinish":"tool_calls","cost":0,
  "tokens":{"input":1208,"output":26,"reasoning":86,
            "cache":{"read":5120,"write":0}}
}
```

Live user message: `{"id":"msg_...","time":{"created":1795658072096},"text":"Say hi in five words.","type":"user"}`.

---

## 4. Forms (replaces v1 `question`)

### Paths

| method | path | body | response |
|---|---|---|---|
| GET | `/api/form` | — (`location[directory]` query) | `{ location, data: Form.Info[] }` |
| GET | `/api/session/{sessionID}/form` | — | `{ data: Form.Info[] }` |
| POST | `/api/session/{sessionID}/form` | `Form.CreatePayload` | `{ data: Form.Info }` |
| GET | `/api/session/{sessionID}/form/{formID}` | — | `{ data: Form.Detail }` |
| POST | `/api/session/{sessionID}/form/{formID}/reply` | `Form.Reply` | `204` |

`Form.CreatePayload`: required `title, fields`; optional `id, metadata, sessionID`.
`Form.Info`: required `id (^frm_), sessionID, title, fields`; optional `metadata`.
`Form.Detail`: same + required `state`.

### Fields

`Form.Field` is a discriminated union (`type`):

```ts
type FormField =
  | StringField      // {key,type:"string", title?,description?,required?,hidden?,when?,
                     //  format?:"email"|"uri"|"date"|"date-time", minLength?,maxLength?,
                     //  pattern?,placeholder?,default?,options?:FormOption[],custom?}
  | NumberField      // {key,type:"number", ... minimum?,maximum?,default?}
  | IntegerField     // {key,type:"integer", ... minimum?,maximum?,default?}
  | BooleanField     // {key,type:"boolean", ... default?}
  | EnumField        // {key,type:"enum", options:FormOption[], default?:string, custom?}
  | MultiselectField // {key,type:"multiselect", options:FormOption[],
                     //  minItems?,maxItems?,custom?,default?:string[]}
  | ExternalField;   // {key,type:"external", url, title?,description?}

interface FormOption { value: string; label: string; description?: string }
interface FormWhen { key: string; op: "eq"|"neq"; value: string|number|boolean }
```

`options` + `custom:true` means the user may type a value not in the list. `when` gates field
visibility on another answer. `Form.Answer` is `Record<fieldKey, FormValue>` where
`FormValue = string | number | boolean | "Infinity"|"-Infinity"|"NaN" | string[]`.

### Reply

`Form.Reply` body (schema `Form.Reply`) is exactly:
```ts
{ answer: Record<string, FormValue> }   // required: ["answer"]; no other fields
```
The reply route returns `204`, `400 FormInvalidAnswerError`, or `409 FormAlreadySettledError`.

`Form.Detail.state` union:
```ts
{ status: "pending" }
{ status: "answered"; answer: Record<string, FormValue> }
{ status: "cancelled"; message?: string }
```

**v1 comparison:** v1 `question` used `questions[].options[].label/value` plus
`multiple`/`custom` and a reply of `answers: string[][]`. v2 flattens each question into a
keyed `field`, answers are an object keyed by `field.key`, multi-select uses `type:"multiselect"`,
and the whole thing is a generic `Form` with `Form.State` rather than an ad-hoc question object.

---

## 5. Permissions

| method | path | body | response |
|---|---|---|---|
| GET | `/api/session/{sessionID}/permission` | — | `{ data: Permission.Request[] }` |
| GET | `/api/session/{sessionID}/permission/{requestID}` | — | `{ data: Permission.Request }` |
| POST | `/api/session/{sessionID}/permission` | ask (below) | `{ data: { id, effect } }` |
| POST | `/api/session/{sessionID}/permission/{requestID}/reply` | `{decision, message?}` | `204` |
| GET | `/api/permission/saved` | — | saved rules |
| DELETE | `/api/permission/saved/{id}` | — | remove saved rule |

`Permission.Request` required: `id (^per), sessionID (^ses), action, resources: string[]`;
optional `save: string[], metadata, source, message`.
`source` = `{type:"tool", messageID, id}`.
`Permission.Reply` enum: `once | always | reject`. `Permission.Effect`: `allow | deny | ask`.

**Reply body is `{ "decision": "once"|"always"|"reject", "message"?: string }` — not the v1
`{"reply": ...}`.** The *event* `permission.replied` still names the field `reply`.

Ask body (POST collection): required `action, resources`; optional `id, save, metadata, source,
agent`.

---

## 6. Filesystem

All accept optional `location[directory]=<abs path>` query to scope to a project. Use
`curl -g` because `[]` is a glob.

| endpoint | params | response |
|---|---|---|
| `GET /api/fs/list` | `path` (query; abs or relative to location; defaults to location dir), `location[directory]` | `{ location: {directory}, data: FileSystem.Entry[] }` |
| `GET /api/fs/read/*` | **wildcard path**, plus `location[directory]` | **raw bytes** (content-type from the file, e.g. `text/plain`; `content-disposition: attachment`); 404 `FileNotFoundError` |
| `GET /api/fs/find` | `query` (required), `type=file\|directory`, `limit`, `location[directory]` | `{ location, data: FileSystem.Entry[] }` |

`FileSystem.Entry` = `{ path: string /* relative */, type: "file"|"directory" }`.

**v1 difference:** `/api/fs/read` is not a query-parameter JSON endpoint. The file path is part
of the URL (`/api/fs/read/src/main.ts`) and the body is the file's raw bytes, not `{content}`.
LIVE:

```
GET /api/fs/read/hello.txt  →  200, content-type: text/plain,
content-disposition: attachment; filename="hello.txt"
body: "hello halyard\n"

GET /api/fs/list?path=.     → {"location":{"directory":"/tmp/oc2/proj"},
                               "data":[{"path":"hello.txt","type":"file"}]}
GET /api/fs/find?query=hel&location[directory]=/tmp/oc2/proj
                            → same entry list
GET /api/fs/read/nope.txt   → 404 {"_tag":"FileNotFoundError","path":"nope.txt",
                                    "message":"File not found: nope.txt"}
```

---

## 7. Sessions HTTP surface

| method | path | body / params | returns |
|---|---|---|---|
| GET | `/api/session` | `cursor`, `search`, ... | `{ data: Session.Info[], cursor }` |
| POST | `/api/session` | `{id?,parentID?,title?,agent?,model?,location?,metadata?,permissions?}` | `{ data: Session.Info }` |
| GET | `/api/session/{id}` | — | `{ data: Session.Info }` |
| PATCH | `/api/session/{id}` | `{title?, metadata?, permissions?, archived?}` | `204` |
| DELETE | `/api/session/{id}` | — | `204` |
| GET | `/api/session/active` | — | `{ data: Record<sessionID, SessionActive> }` |
| POST | `/api/session/{id}/prompt` | `{text, id?, files?, agents?, skills?, metadata?, delivery?, resume?}` | `{ data: Session.Inbox.User }` |
| GET | `/api/session/{id}/message` | `cursor`, ... | `{ data: Message.Info[], cursor:{previous,next} }` |
| POST | `/api/session/{id}/agent` | `{agent}` | `204` |
| POST | `/api/session/{id}/model` | `{model: ModelRef}` | `204` |
| POST | `/api/session/{id}/interrupt` | `?resume=true\|false` | `SessionInterruptResponse` |
| POST | `/api/session/{id}/fork` | `{before?: messageID \| null}` | `{ data: Session.Info }` |
| POST | `/api/session/{id}/compact` | `{id?, delivery?}` (no `reason`; events report `auto`/`manual`) | `{ data: Session.Inbox.Compaction }` |
| DELETE | `/api/session/{id}/revert` | — | clear staged revert |
| POST | `/api/session/{id}/revert/commit` | — | `204` |
| POST | `/api/session/{id}/revert/stage` | `{messageID, files?: boolean\|null}` | `{ data: Session.Revert }` |
| POST | `/api/session/{id}/permission` | ask | `{data:{id,effect}}` |
| GET/POST | `/api/session/{id}/form[...]` | see §4 | |

**PATCH does not switch model/agent.** v1's `POST /api/session/{id}` with
`{title, time, ...}` is gone; use `PATCH` for title/metadata/permissions/archive and the
dedicated `POST .../model` and `.../agent` routes.

`resume:false` on prompt stores the message in the inbox without starting a run (LIVE: prompt
returned `type:"user"`, `delivery:"steer"`, but `GET .../message` still returned `n:0`).

### Revert flow

1. `POST /revert/stage {messageID, files?}` → `Session.Revert`
   `{ messageID, partID?, snapshot?, files?: FileDiff.Info[] }`; emits `session.revert.staged`.
2. `DELETE /revert` clears it (emits `session.revert.cleared`).
3. `POST /revert/commit` applies it (emits `session.revert.committed` with `to`).

`FileDiff.Info` = `{file, patch, additions, deletions, status:"added"|"deleted"|"modified", more?:true}`.

`Session.Info` required: `id, projectID, cost, tokens, time, location`; optional `parentID, fork,
agent, model, outcome, title, slug, archived, time.archived/...`. `tokens` = `TokenUsage.Info`.
`Session.Info.location` is `Location.PublicRef` (`{directory}`).

### Compact

`POST /api/session/{id}/compact` body `{reason?: "auto"|"manual"}` returns
`Session.Inbox.Compaction` (`{id, sessionID, time, type:"compaction", payload, delivery}`)
and emits the `session.compaction.*` stream.

---

## 8. Providers, models, agents, skills, integrations, credentials, MCP

All list endpoints accept `location[directory]` and most return
`{ location, data: T[] }` (providers/models/agents/skills/mcp) or `{ data: T[] }`
(credentials). `/api/config` returns a bare `Config.Entry[]`; `/api/project` a bare `Project[]`.

| method | path | response item |
|---|---|---|
| GET | `/api/provider` | `Provider.Info` |
| GET | `/api/model?types=` | `Model.Info` |
| GET | `/api/agent` | `Agent.Info` |
| GET | `/api/skill` | `Skill.Info` |
| GET | `/api/integration` | `Integration.Info` |
| GET | `/api/integration/external` | external methods |
| POST | `/api/integration/{id}/connect/key` | `{key, answer?, label?}` → `204` (200 no-content) |
| POST | `/api/integration/{id}/connect/oauth` | `{methodID, answer?, label?}` → `{location, data: Integration.AttemptEncoded}` |
| GET | `/api/integration/{id}/connect/oauth/{attemptID}` | → `{location, data: Integration.AttemptStatus}` (poll) |
| POST | `/api/integration/{id}/connect/oauth/{attemptID}/complete` | `{code?}` → `204` |
| DELETE | `/api/integration/{id}/connect/oauth/{attemptID}` | cancel attempt → `204` |
| POST | `/api/integration/{id}/connect/external` | `{methodID, answer?, label?}` → `204` |
| POST | `/api/integration/{id}/connect/command` | `{methodID, label?}` → `{location, data: Integration.CommandAttempt}` |
| GET | `/api/integration/{id}/connect/command/{attemptID}` | → `{location, data: Integration.CommandAttemptStatus}` (poll) |
| DELETE | `/api/integration/{id}/connect/command/{attemptID}` | cancel attempt → `204` |
| GET | `/api/credential` | `Credential.Entry` |
| POST | `/api/credential` | `Credential.CreateInput` → `{data: Credential.Entry}` |
| PATCH | `/api/credential/{id}` | `{label}` → `204` |
| DELETE | `/api/credential/{id}` | → `204` |
| POST | `/api/credential/{id}/activate` | → `204` |
| GET | `/api/mcp` | `Mcp.Server[]` |
| GET | `/api/mcp/resource` | `Mcp.ResourceCatalog` |
| GET | `/api/config` | `Config.Entry[]` |
| GET | `/api/vcs` | `Vcs.Info` |
| GET | `/api/location` | `Location.PublicInfo` |
| GET | `/api/info` | `ServerInfo` |

Key item shapes:

```ts
interface ProviderInfo { id: string; name: string;
  activation: "auto"|"enabled"|"disabled"; package: string;
  canonical?: string; integrationID?: string;
  compatibility?: object; settings?: object; headers?: Record<string,string>; body?: object }

interface ModelInfo { id: string; modelID: string; providerID: string; name: string;
  capabilities: object; variants: unknown[]; time: object; cost: object;
  status: unknown; enabled: boolean; limit: object;
  canonical?: string; type?: "chat"|"decision"|"image"|"video"|string;
  family?: string; compatibility?: object }

interface AgentInfo { id: string; name: string; request: object;
  mode: "subagent"|"primary"|"all"; hidden: boolean;
  permissions: {action,resource,effect:"allow"|"deny"|"ask"}[];
  model?: ModelRef; system?: string;
  instructions?: string | {selected: string; unselected: string};
  description?: string; color?: string; steps?: number }

interface SkillInfo { id: string; name: string; path: string; content: string;
  description?: string; autoinvoke?: boolean }

interface McpServer { name: string; status: McpStatus; title?: string; integrationID?: string }
type McpStatus =
  | { status:"connected" } | { status:"pending" } | { status:"disabled" }
  | { status:"failed"; error: string }
  | { status:"needs_auth"; error: string };

interface VcsInfo { branch: { current?: string; default?: string }; provider?: string }
```

```ts
// Credential.CreateInput — required [integrationID, value]
interface CredentialCreateInput {
  integrationID: string;
  value: CredentialValue;          // Credential.OAuth | Credential.Key | Credential.External
  id?: string; label?: string; activate?: boolean;
}
// Credential.Entry — required [id, integrationID, label, active, value]
interface CredentialEntry {
  id: string; integrationID: string; label: string; active: boolean;
  value: CredentialValue;
}
type CredentialValue =
  | { type: "key"; key: string; metadata?: object }
  | { type: "oauth"; /* oauth fields */ }
  | { type: "external"; methodID: string; metadata?: object };
```
`Integration.Info` required: `id, name, methods, connections`. `methods[]` is a union of
`oauth | command | key | external | env` method objects (oauth/key/external carry a `form:
Form.Field[]`). `Integration.AttemptEncoded` = `{attemptID, url, instructions, mode:"auto"|"code",
time:{created,expires}, paste?:true}`.

---

## 9. Error envelope

Every 4xx/5xx JSON body is a **flat tagged object** — there is no `{error:{...}}` wrapper:

```ts
interface ApiError {
  _tag: string;          // e.g. "InvalidRequestError", "UnauthorizedError",
                         // "SessionNotFoundError", "FileNotFoundError", "ConflictError"
  message: string;
  kind?: string | null;
  field?: string | null;
  [extra: string]: unknown;   // e.g. FileNotFoundError adds `path`
}
```

LIVE 401/400/404 confirm this shape. `InvalidRequestError` may include a long `message` listing
the allowed enum when a query value is wrong.

---

## 10. Live-verified vs schema-derived

**Live-observed** (server 2.4.2, captured frames in §12):
`/api/info`, `POST /api/session`, `PATCH`/`DELETE /api/session/{id}`, prompt with
`resume:false` and default resume, `GET .../message`, `GET /api/fs/list`, `GET /api/fs/read/*`,
`GET /api/fs/find`, `GET /api/event` with repeated `types`, and the events
`server.connected`, `session.created`, `session.renamed`, `session.deleted`,
`session.execution.started`, `session.execution.succeeded`,
`session.tool.success`, `session.text.delta`, `session.step.started`, `session.step.ended`,
`session.usage.updated`. Also live: `?types=server.connected` → 400; heartbeats as comments;
`/api/fs/read` returns raw bytes; `resume:false` records an inbox item but no transcript
message; messages include `idle` entries.

**Schema-derived only** (not triggered live, shape copied from components): all form and
permission mutation flows, `session.status`/`session.idle` emission, revert staging/commit,
compaction stream, fork, provider/credential/integration connect, MCP resource catalog,
`session.reasoning.*` and `session.tool.input.*` (though the tool result format was confirmed
via `session.tool.success`).

---

## 11. Reducer rules (append vs replace)

| event | store operation |
|---|---|
| `session.text/reasoning.delta` | append `delta` to `(assistantMessageID, ordinal)` buffer |
| `session.text/reasoning.ended` | replace buffer with `text`; drop buffer |
| `session.tool.input.delta` | append `delta` to raw input string |
| `session.tool.input.ended` | replace raw input with `text` |
| `session.tool.called` | replace tool part with `input` object, `executed` |
| `session.tool.progress` | replace `metadata` |
| `session.tool.success` | replace state → `completed`, `content`, `metadata` |
| `session.tool.failed` | replace state → `error` |
| `session.step.ended` | replace `finish/cost/tokens` on assistant message |
| `session.usage.updated` | replace session `cost`/`tokens` |
| `session.status` | replace status; `session.idle` → idle |
| `session.execution.*` | set run outcome (`succeeded/failed/interrupted`) |
| `session.revert.staged` | set `stagedRevert`; `cleared` → null; `committed` → clear + truncate |
| `permission.asked` | upsert pending; `permission.replied` remove |
| `form.created` | upsert form; `form.replied`/`form.cancelled` remove |
| `filesystem.changed` | invalidate path |
| `mcp.status.changed` | refetch `/api/mcp` (payload only names server) |
| `vcs.branch.updated` | replace branch |
| `config.updated` | invalidate config |

Durable events carry `durable.seq` per `aggregateID` (session). Use it to drop out-of-order
frames after a reconnect; ephemeral events have no sequence.

---

## 12. Captured raw frames

### 12.1 Event stream open + heartbeat + text delta + tool success + execution

Request: `GET /api/event?types=session.text.delta&types=session.tool.success&types=session.execution.started&types=session.execution.succeeded`

```
data: {"id":"evt_2159040f90012wdn81RWNmj2UO","type":"server.connected","data":{}}

: heartbeat

data: {"id":"evt_2159047ce001n9v0y9c7MIqJK0","created":1795658106832,"type":"session.execution.started","data":{"sessionID":"ses_dea7084efffe6bpTYwtZF4WN7C"},"durable":{"aggregateID":"ses_dea7084efffe6bpTYwtZF4WN7C","seq":29,"version":1}}

data: {"id":"evt_215905404001Neeg3QW4E0u56e","created":1795658109956,"type":"session.tool.success","location":{"directory":"/tmp/oc2/proj"},"data":{"sessionID":"ses_dea7084efffe6bpTYwtZF4WN7C","assistantMessageID":"msg_21590489b001L2tPknydehRiWx","id":"chatcmpl-tool-ad2e5c225026d2ac","content":[{"type":"text","text":"Read file /tmp/oc2/proj/hello.txt, lines 1-1\n1: hello halyard"}],"metadata":{"truncated":false},"executed":false},"durable":{"aggregateID":"ses_dea7084efffe6bpTYwtZF4WN7C","seq":37,"version":2}}

data: {"id":"evt_215905f4c0010VeeACUs2I37Qv","created":1795658112845,"type":"session.text.delta","location":{"directory":"/tmp/oc2/proj"},"data":{"sessionID":"ses_dea7084efffe6bpTYwtZF4WN7C","assistantMessageID":"msg_215905580001NM1xRVHQO6N155","ordinal":0,"delta":"DONE"}}

data: {"id":"evt_215905fbb001NSoNTmjfWyh5cY","created":1795658112955,"type":"session.execution.succeeded","data":{"sessionID":"ses_dea7084efffe6bpTYwtZF4WN7C"},"durable":{"aggregateID":"ses_dea7084efffe6bpTYwtZF4WN7C","seq":45,"version":1}}
```

### 12.2 Session lifecycle

```
data: {"id":"evt_21591288800197bV1XqB0XcK1N","created":1795658164360,"type":"session.created","location":{"directory":"/tmp/oc2/proj"},"data":{"sessionID":"ses_dea6ed7a2fferJ8kLciv2bNDz5","slug":"curious-cabin","version":"2.4.2","projectID":"be3cba44ba91773d912e74377721f38dc05c88cd","location":{"directory":"/tmp/oc2/proj"},"subpath":"","title":"probe2"},"durable":{"aggregateID":"ses_dea6ed7a2fferJ8kLciv2bNDz5","seq":0,"version":1}}

data: {"id":"evt_215912cb00013w9cN1shheGFUY","created":1795658165424,"type":"session.renamed","data":{"sessionID":"ses_dea6ed7a2fferJ8kLciv2bNDz5","title":"probe2-renamed"},"durable":{"aggregateID":"ses_dea6ed7a2fferJ8kLciv2bNDz5","seq":1,"version":1}}

data: {"id":"evt_21591312b001ctLvgPxnxwrC6h","created":1795658166571,"type":"session.deleted","data":{"sessionID":"ses_dea6ed7a2fferJ8kLciv2bNDz5"},"durable":{"aggregateID":"ses_dea6ed7a2fferJ8kLciv2bNDz5","seq":2,"version":2}}
```

### 12.3 Steps and usage

```
data: {"id":"evt_215915b7e001IufJ0RQQBXzWEj","created":1795658177406,"type":"session.step.started","location":{"directory":"/tmp/oc2/proj"},"data":{"sessionID":"ses_dea7084efffe6bpTYwtZF4WN7C","agent":"build","model":{"id":"big-pickle","providerID":"opencode"},"assistantMessageID":"msg_21591511a001pp57AYmdu5QNwE","started":1795658175046},"durable":{"aggregateID":"ses_dea7084efffe6bpTYwtZF4WN7C","seq":49,"version":1}}

data: {"id":"evt_215915cd3001IWc4sMjSeKR1Yi","created":1795658177748,"type":"session.step.ended","location":{"directory":"/tmp/oc2/proj"},"data":{"sessionID":"ses_dea7084efffe6bpTYwtZF4WN7C","assistantMessageID":"msg_21591511a001pp57AYmdu5QNwE","finish":"stop","rawFinish":"stop","tokens":{"input":191,"output":4,"reasoning":9,"cache":{"read":6400,"write":0}},"cost":0},"durable":{"aggregateID":"ses_dea7084efffe6bpTYwtZF4WN7C","seq":56,"version":1}}

data: {"id":"evt_215915cf5001Jl1beLFU530VQP","created":1795658177781,"type":"session.usage.updated","data":{"sessionID":"ses_dea7084efffe6bpTYwtZF4WN7C","cost":0,"tokens":{"input":2015,"output":61,"reasoning":118,"cache":{"read":30464,"write":0}}}}
```

### 12.4 Filesystem (live)

```
GET /api/fs/read/hello.txt
200 OK
content-type: text/plain
content-disposition: attachment; filename="hello.txt"; filename*=UTF-8''hello.txt
content-length: 14

hello halyard

GET /api/fs/list?path=.
{"location":{"directory":"/tmp/oc2/proj"},"data":[{"path":"hello.txt","type":"file"}]}

GET /api/fs/find?query=hel&location[directory]=/tmp/oc2/proj
{"location":{"directory":"/tmp/oc2/proj"},"data":[{"path":"hello.txt","type":"file"}]}

GET /api/fs/read/nope.txt?location[directory]=/tmp/oc2/proj
404 {"_tag":"FileNotFoundError","path":"nope.txt","message":"File not found: nope.txt"}
```

### 12.5 Prompt + message history (live)

```
POST /api/session/ses_.../prompt {"text":"Say hi in five words.","resume":false}
200 {"data":{"id":"msg_2158f7d0d001UA1WTzlE6NTkaG","sessionID":"ses_...",
     "time":{"created":1795658072096},"type":"user",
     "payload":{"text":"Say hi in five words."},"delivery":"steer"}}

GET /api/session/ses_.../message
{"n":0,"cursor":{"previous":null,"next":null}}    # resume:false does not add a transcript msg
```

---

## 13. Three most surprising v1 → v2 shape differences

1. **Status/turn semantics moved off a single `session.error`/`session.status` channel.**
   v2 has no `session.error`; failures are `session.execution.failed`, `session.step.failed`,
   `session.tool.failed`, `session.compaction.failed`, or assistant `error`. The status event's
   wire type is `session.status` but its schema is named `SessionStatusUpdated`, and `busy`
   replaces v1's `running`. In a live run `session.status`/`session.idle` were not emitted at
   all, so a reducer must treat execution/step events (plus the durable `idle` message) as the
   turn boundary.

2. **Flat messages, not parts.** `GET .../message` returns one array of full messages whose
   assistant `content[]` holds text/reasoning/tool blocks. There is no `part` endpoint or
   `partID` addressing for text; ordering is array index (`ordinal`). History user messages are
   flat `{text}` while the prompt/inbox response nests `payload.text` — the same conceptual
   message has two different shapes depending on endpoint.

3. **Transport-level rewrites.** SSE is `data:`-only over `/api/event` with a uniform
   `V2Event {id,created,type,location,durable,data}` envelope and `: heartbeat` comments;
   filters are repeated `?types=` (array), and `server.connected` is always sent but cannot be
   named in `types` (400). File reads are a wildcard path returning raw bytes with
   `content-disposition`, not `{content}` JSON. Permission replies use `decision` on the wire
   route while the `permission.replied` event field is `reply`; forms replace `question` with
   keyed `Form.Field`s and `answer` objects.


