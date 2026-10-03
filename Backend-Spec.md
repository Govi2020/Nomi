# Backend Build Specification — Local-First Private Journal

> **Architecture note:** This document contains a historical Electron/Moonshine design specification and is not an exact description of this repository. The current React/Vite app transcribes Diary and Talk audio with a shared browser-local Whisper Tiny pipeline (`frontend/src/services/localTranscriptionService.ts`). It sends Talk transcripts, not microphone audio, to the configured backend. The backend does not provide an audio transcription endpoint.

This is a complete build spec for a **new** project. An LLM or engineer with no access to any other repository should be able to build it end to end by following this document.

Where exact text matters — SQL DDL, system prompts, tool descriptions, config blocks — it is reproduced verbatim. Where behavior matters but implementation is free, the requirement is stated precisely and the reason is given.

**Scope:** Python backend (FastAPI + SQLite + MCP tool server + Ollama) plus the Electron shell that hosts it. Voice capture uses **Moonshine** running in-process via ONNX Runtime. There is no cloud dependency anywhere.

**What this project is:** a single-user, offline journal. Entries are written as text or dictated by voice, automatically structured (title, summary, tags, entities, mood), linked into a similarity graph, and queryable in natural language by an LLM agent that drives read-only tools over the user's own database.

---

## 1. Architecture

### 1.1 Process topology

```
Electron main process
  ├─ allocates a free TCP port (bind :0, read it back, close)
  ├─ locates a Python interpreter, then verifies backend imports
  ├─ spawns:  python -m uvicorn backend.server:app --host 127.0.0.1 --port <PORT> --log-level warning
  ├─ polls GET /api/health until 200 or 40 s deadline
  ├─ registers IPC handler `stt:moonshine`
  └─ loads src/index.html with query string { port: "<PORT>" }
        └─ renderer reads the port from location.search, calls the API

backend.server:app  (FastAPI, port <PORT>)
  ├─ imports db, ollama_client, rag, organize, insights, mcp_client
  └─ on first chat request, lazily spawns and keeps:
       python -m backend.mcp_server      ← MCP server, stdio transport, child process
         ├─ opens data/journal.db READ-ONLY  (file:...?mode=ro)
         └─ calls back into Ollama /api/embed for vector_search

Electron main process also hosts, in-process:
  @huggingface/transformers
    └─ pipeline('automatic-speech-recognition', 'onnx-community/moonshine-tiny-ONNX')
         loaded from ./models/ with remote models disabled
```

### 1.2 Two independent subsystems

**A. MCP agent answering** (Python, child process)
The LLM is given tool schemas and chooses which read-only journal tools to call, for up to 10 steps, over stdio MCP. This is the only answering path. There is no separate fixed pipeline competing with it — the tools cover retrieval, keyword search, SQL aggregation and graph traversal.

**B. Moonshine speech-to-text** (JavaScript, main process)
Audio never leaves the machine and never touches Python. The renderer captures 16 kHz mono float samples, hands them over IPC, and Moonshine returns text. The Python side only receives the finished text.

Keep these separate. Do not route audio through the backend.

### 1.3 Environment variables

Read in `backend/config.py`.

```
JOURNAL_DATA_DIR    default <repo>/data          ; DB + audio root
OLLAMA_HOST         default http://127.0.0.1:11434
CHAT_MODEL          default maxwell1500/psycho
EMBED_MODEL         default nomic-embed-text
LINK_SIM_THRESHOLD  default 0.35                ; graph edge cut, cosine
REL_SIM_THRESHOLD   default 0.20                ; retrieval relevance cut
FOLLOWUP_MIN_SIM    default 0.45                ; gate before asking a follow-up
RAG_TOP_K           default 6                   ; context budget for helpers
GRAPH_MAX_ENTRIES   default 300                 ; newest-N cap on graph nodes
```

Moonshine needs **no environment variable** — it is resolved from a fixed local path (§7).

`config.ensure_dirs()` creates `DATA_DIR` and `AUDIO_DIR`; called from `db.init_db()` at startup.

---

## 2. File Structure

```
<project root>/
├── package.json               start → electron .; deps below
├── main.js                    port pick, dep check, backend spawn, IPC, window
├── preload.js                 contextBridge → window.journalShell
├── stt_moonshine.js           Moonshine pipeline loader + transcribe()
├── models/
│   └── onnx-community/moonshine-tiny-ONNX/     (downloaded once, see §7)
│       ├── config.json
│       ├── generation_config.json
│       ├── preprocessor_config.json
│       ├── tokenizer.json
│       ├── tokenizer_config.json
│       └── onnx/
│           ├── encoder_model.onnx
│           └── decoder_model_merged.onnx
├── data/                      created at runtime
│   ├── journal.db
│   └── audio/
├── src/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── backend/
    ├── requirements.txt
    ├── __init__.py            empty; makes `-m backend.x` work
    ├── config.py              paths, env, tunables, ensure_dirs()
    ├── db.py                  DDL + all SQL. No LLM, no HTTP, no async
    ├── ollama_client.py       chat, tool-calling chat, embeddings
    ├── mcp_server.py          read-only MCP server, 6 tools, stdio
    ├── mcp_client.py          persistent MCP stdio client
    ├── rag.py                 the agent loop + both system prompts
    ├── organize.py            LLM structuring of a single entry
    ├── insights.py            follow-up question generator
    └── server.py              FastAPI routes
```

`backend/requirements.txt`:

```
fastapi>=0.110
uvicorn[standard]>=0.29
python-multipart>=0.0.9
httpx>=0.27
numpy>=1.26
mcp>=2.2
```

**`mcp>=2.2` is a hard floor.** Version 1.x exposed FastMCP; 2.x renamed it `MCPServer` and moved it to `mcp.server.mcpserver`. Writing 1.x imports against a 2.x install fails at import time.

`package.json` dependencies:

```json
{
  "devDependencies": { "electron": "^33.2.0" },
  "dependencies":    { "@huggingface/transformers": "^4.3.0" }
}
```

---

## 3. `backend/config.py`

Everything else reads tunables from here. Reproduced in full.

```python
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("JOURNAL_DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "journal.db"
AUDIO_DIR = DATA_DIR / "audio"

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "maxwell1500/psycho")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")

LINK_SIM_THRESHOLD = float(os.environ.get("LINK_SIM_THRESHOLD", "0.35"))
REL_SIM_THRESHOLD = float(os.environ.get("REL_SIM_THRESHOLD", "0.20"))
FOLLOWUP_MIN_SIM = float(os.environ.get("FOLLOWUP_MIN_SIM", "0.45"))
RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "6"))
GRAPH_MAX_ENTRIES = int(os.environ.get("GRAPH_MAX_ENTRIES", "300"))

def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
```

---

## 4. `backend/db.py` — schema and data access

Pure SQLite. Every function opens its own connection and closes it with `contextlib.closing`. Callers never hold a transaction across calls.

### 4.1 Connection

```python
def connect():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
```

`PRAGMA foreign_keys = ON` is mandatory. Without it the `ON DELETE CASCADE` clauses are inert and deleting an entry leaves orphaned tag, entity and link rows behind.

### 4.2 Schema (exact DDL)

```sql
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT,
  title       TEXT,
  text        TEXT NOT NULL,
  summary     TEXT,
  audio_path  TEXT,
  source      TEXT NOT NULL DEFAULT 'text',
  mood        TEXT,
  organized   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL,
  tag_id   INTEGER NOT NULL,
  PRIMARY KEY (entry_id, tag_id),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entities (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'thing'
);

CREATE TABLE IF NOT EXISTS entry_entities (
  entry_id  INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (entry_id, entity_id),
  FOREIGN KEY (entry_id)  REFERENCES entries(id)  ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS links (
  src_id INTEGER NOT NULL,
  dst_id INTEGER NOT NULL,
  kind   TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (src_id, dst_id, kind),
  FOREIGN KEY (src_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (dst_id) REFERENCES entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_id);
CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_id);

CREATE TABLE IF NOT EXISTS embeddings (
  entry_id INTEGER PRIMARY KEY,
  vector   BLOB NOT NULL,
  dim      INTEGER NOT NULL,
  model    TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);
```

Invariants that must hold:

- `created_at` is **ISO8601 text**, never an epoch integer. Month bucketing is `substr(created_at,1,7)`.
- `mood` is a **text label** (`happy`, `anxious`, `frustrated`, …). It must never be summed or averaged — see §11, bug 3.
- `links.kind` ∈ {`semantic`, `shared_tag`, `shared_entity`}. Edges are stored canonically with `src_id < dst_id`.
- `embeddings.vector` is a raw `float32` BLOB from `numpy.tobytes()`. `dim` is recorded but not enforced at read time.
- `links` holds only qualifying pairs — above `LINK_SIM_THRESHOLD`, or sharing a tag or entity. No full N×N table.

### 4.3 Serializers

```python
def _row_to_dict(row):
    d = dict(row)
    d.pop("vector", None)     # embedding bytes must never reach the API
    return d
```

`_entry_with_meta(entry_id)` returns the entry dict plus `tags` (list of str) and `entities` (list of `{name, type}`), each ordered by name.

`list_entries(limit=200, offset=0)` **must not** do N+1 queries. Fetch the page, then two batched `IN (...)` queries to attach tags and entities. The journal view requests up to 1000 rows.

### 4.4 Public API

```
def connect()
def init_db()                                    # ensure_dirs() + executescript(SCHEMA)
def list_entries(limit=200, offset=0)            # + tags + entities, created_at DESC
def get_entry(entry_id)                          # full entry or None
def create_entry(text, title=None, source="text", audio_path=None) -> int
def update_entry(entry_id, text=None, title=None, ai_fields_only=False) -> bool
def update_ai_fields(entry_id, summary=None, mood=None, organized=False)
def search_entries(q, limit=50)                  # substring over text/title/tags/entities
def delete_entry(entry_id)
def get_entries_by_ids(ids)                      # ORDER BY created_at DESC
def set_entry_tags(entry_id, names)              # replace-all
def set_entry_entities(entry_id, entities)       # replace-all
def save_embedding(entry_id, vector, model)
def load_embedding(entry_id)                     # np.float32 array or None
def load_all_embeddings()                        # (ids: list[int], mat: np.ndarray[n][d])
def rebuild_links_for_entry(entry_id, matrix_ids, matrix, threshold=None)
def get_related(entry_id, limit=20)              # entries + links [{kind, weight}] desc
def get_graph()                                  # {nodes, edges}
```

`search_entries` is a substring match (`LIKE '%q%'` on lowercased columns). `"work"` matches `"Ironworks"`. This over-match is a known sharp edge; it is the reason the agent prompt tells the model to prefer `vector_search` for concepts and `search_entries` only for exact words.

### 4.5 `set_entry_tags` / `set_entry_entities`

Both are **replace-all**, not additive: delete the entry's rows first, then insert. Tags use `ON CONFLICT(name) DO NOTHING` — first writer's spelling wins. Entities use `ON CONFLICT(name) DO UPDATE SET type=excluded.type` — last type wins.

### 4.6 `rebuild_links_for_entry(entry_id, matrix_ids, matrix, threshold=None)`

Recomputes every link touching `entry_id`. Order matters:

1. Load this entry's embedding. If present and `matrix_ids` is non-empty, cosine against every row of `matrix`; keep `sim >= threshold` (default `LINK_SIM_THRESHOLD`) as `(min, max, "semantic", sim)`.
2. Shared tags: self-join `entry_tags` on `tag_id`, exclude self, `GROUP BY other`, use the count as weight.
3. Shared entities: same self-join on `entry_entities`.
4. `DELETE FROM links WHERE src_id=? OR dst_id=?`.
5. Dedupe by `(src, dst, kind)` keeping **max** weight, then `executemany` insert.

Cosine must be division-guarded or zero vectors produce NaN:

```python
np.divide(sims, denom, out=sims, where=denom > 0)
```

### 4.7 `get_graph()`

Node ids are **prefixed strings** so entry/tag/entity ids never collide in one id space: `e<entry_id>`, `t<tag_id>`, `n<entity_id>`.

- Entry nodes: newest `GRAPH_MAX_ENTRIES` by `id DESC`. `label` = title truncated to 40, else summary, else text.
- Tag and entity nodes: only those attached to included entries, with `count` incremented per attachment.
- Edges: `has_tag`, `has_entity`, and entry↔entry `link` — the last built from `links` rows **deduped as unordered pairs** via `tuple(sorted((a, b)))`, so a semantic edge and a shared-tag edge between the same two entries render as one line, not two.

---

## 5. `backend/ollama_client.py`

One module-level `httpx.AsyncClient`, lazily created, with a long read timeout — small models on CPU are slow.

```python
_client = httpx.AsyncClient(base_url=config.OLLAMA_HOST,
                            timeout=httpx.Timeout(180.0, connect=5.0))
```

### 5.1 API

```python
async def ping() -> bool                        # GET /api/tags → 200 == reachable
async def list_models() -> list                 # names from /api/tags
def _model_available(installed, name) -> bool   # tolerates a missing ":tag" suffix
async def chat(system, user, json_mode=False, temperature=0.4) -> str
async def chat_messages(messages, tools=None, temperature=0.4,
                        json_mode=False, tool_choice=None) -> dict
async def embed(text) -> list
```

`_model_available` matches on the full name, on the `base:tag` prefix with any tag, or on the bare base — so `qwen2.5` counts as satisfied by an installed `qwen2.5:3b`.

### 5.2 Error contract

Raise `RuntimeError` with an **actionable, user-facing** message. These strings are rendered in the UI.

- host down → `Could not reach Ollama ({host}). Is it running? ({err})`
- model absent → `Ollama model '{model}' not found. Run: ollama pull {model}`
- other → `Ollama error {code}: {body[:300]}`

### 5.3 `chat_messages` — the tool-calling surface

The agent depends entirely on this function. It must return **`{"content", "tool_calls"}`**, with `tool_calls` always present as a list (empty, never missing).

```python
payload = {"model": config.CHAT_MODEL, "messages": messages, "stream": False,
           "options": {"temperature": temperature}}
if tools:       payload["tools"] = tools          # OpenAI-style function schemas
if tool_choice: payload["tool_choice"] = tool_choice
if json_mode:   payload["format"] = "json"
```

`tool_choice` is the load-bearing field. Passing `"required"` forces a tool call instead of prose. Small models need this — see §11, bug 1.

### 5.4 `embed`

Try `POST /api/embed` `{"model", "input"}` → `json()["embeddings"][0]`. On non-200/404 fall back to the legacy `POST /api/embeddings` `{"model", "prompt"}` → `json()["embedding"]`. Raise if both fail.

---

## 6. `backend/mcp_server.py` — read-only tool server

Runs as its own process: `python -m backend.mcp_server`. Transport stdio. **It must never write.** Two independent guarantees enforce that: the database is opened `mode=ro`, and SQL is validated as a single read-only statement.

```python
from mcp.server.mcpserver import MCPServer          # NOT mcp.server.fastmcp
from mcp.types import TextContent

server = MCPServer(
    name="journal",
    title="Private Journal (read-only)",
    description="Read-only access to the user's private journal: SQL queries, vector search, "
                "entry reads, keyword search and statistics.",
    version="1.0.0",
)

if __name__ == "__main__":
    server.run(transport="stdio", log_level="ERROR")
```

### 6.1 Read-only enforcement

```python
def _ro_conn():
    path = str(config.DB_PATH).replace("\\", "/")   # backslashes break the file: URI
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn

def _clean_sql(raw: str) -> str:
    sql = (raw or "").strip()
    if not sql:
        raise ValueError("empty SQL")
    body = sql.rstrip(";")
    if ";" in body:
        raise ValueError("only a single statement is allowed")
    head = body.lstrip().split(None, 1)[0].upper()
    if head not in {"SELECT", "PRAGMA", "EXPLAIN", "WITH"}:
        raise ValueError("read-only server: only SELECT/PRAGMA/EXPLAIN/WITH allowed")
    return body
```

Output caps: `MAX_SNIPPET = 1200`, `MAX_CELL = 600`. Fetch `101` rows and return `100` — the 101st is the truncation probe.

```python
def _text(payload) -> list:
    return [TextContent(type="text", text=payload)]
```

### 6.2 The six tools

**Tool descriptions are load-bearing.** A 3B model selects tools almost entirely from these strings. Reproduce them verbatim.

**`sql_query(sql: str) -> str`**
Returns `{"columns": [...], "rows": [[...]], "truncated": bool}`. Catch `sqlite3.Error` and return it as `{"error": "SQL error: ..."}` — a returned error, not a raised one, so the model can recover and try something else.

> Run a READ-ONLY SQL SELECT on the journal database. Returns {columns, rows, truncated} as JSON. Never modify data.
> Schema: entries(id, created_at ISO8601, updated_at, title, text, summary, audio_path, source, mood TEXT word like 'happy'/'sad', organized 0|1); tags(id,name); entry_tags(entry_id,tag_id); entities(id,name,type); entry_entities(entry_id,entity_id).
> Important: mood is a text label, so use GROUP BY mood for counts — never AVG/SUM over it. Use substr(created_at,1,7) for the month. For a mood summary prefer journal_stats.

**`vector_search(query: str, top_k: int = 5, min_score: float = 0.2) -> str`** — `async`. Clamp `top_k` to `[1, 10]`. Cosine ranking identical to `rag._retrieve`. Returns a JSON array of `{id, date, title, score, snippet}`, sorted descending, cut at `min_score`.

**`read_entry(entry_id: int) -> str`**
Returns `{id, created_at, title, summary, mood, tags, entities, source, text}` with `text` capped at 4000. Missing entry → `{"error": "entry not found"}`.

**`search_entries(query: str, limit: int = 10) -> str`** — clamp `limit` to `[1, 50]`.
Required behavior: if the whole-phrase `LIKE` returns nothing, retry per word (`len(w) > 2`, first 4 words) and merge de-duplicated by id. Without this, a query like `"work recent"` returns zero rows because the literal phrase is absent, and the model concludes the journal is empty on the topic.

> Keyword search over entry text, titles, tags and people/places. Pass a single word or name (e.g. 'sourdough', 'Ami'). Multi-word queries are matched per-word. Use for exact words; use vector_search for meaning or natural-language questions.

**`related_entries(entry_id: int) -> str`** — `db.get_related(id, limit=12)`, returns `[{id, date, title, links: [{kind, weight}]}]`.

**`journal_stats() -> str`** — one query for count + date range, then top-10 tags, top-10 entities, mood distribution via `GROUP BY mood`. Returns `{count, first, last, top_tags, top_entities, moods}`. This tool exists because asked "how has my mood been overall", the model reaches for `sql_query` and aggregates the text column wrongly.

---

## 7. `stt_moonshine.js` — speech to text

Moonshine runs **in the Electron main process** via `@huggingface/transformers` (ONNX Runtime). It is fully local: `env.allowRemoteModels = false`, and the model is resolved from disk.

```javascript
const path = require('path');

let pipePromise = null;

function buildPipeline() {
  const { env, pipeline } = require('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = path.join(__dirname, 'models');
  return pipeline('automatic-speech-recognition', 'onnx-community/moonshine-tiny-ONNX');
}

function getPipeline() {
  if (!pipePromise) {
    pipePromise = buildPipeline().catch((e) => { pipePromise = null; throw e; });
  }
  return pipePromise;
}

/** Transcribe a 16 kHz mono Float32Array. Returns text or throws. */
async function transcribe(samples) {
  if (!samples || !samples.length) throw new Error('no audio samples received.');
  const pipe = await getPipeline();
  const out = await pipe(samples);
  const text = (out && out.text || '').toString().trim();
  if (!text) throw new Error('Moonshine returned empty text. Try speaking a bit closer / louder.');
  return text;
}

module.exports = { transcribe };
```

Design points:

- **Lazy singleton.** The pipeline is built on first transcription and reused. On construction failure the memo is cleared so a later call can retry instead of caching a rejected promise forever.
- **Remote models disabled.** Without `allowRemoteModels = false` the library phones home for tokenizer/config files even when weights are local. The setting is a correctness and privacy requirement.
- **`localModelPath` must be absolute.** `env.localModelPath` expects an absolute directory.
- **Empty output is an error.** Moonshine Tiny returning an empty string on quiet input is common; a silent success would look like a broken mic. Throw with actionable advice instead.
- **Input is a `Float32Array` at 16 kHz, mono, in `[-1, 1]`.** No WAV header, no base64.

### 7.1 Model layout on disk

```
models/onnx-community/moonshine-tiny-ONNX/
├── config.json                 MoonshineForConditionalGeneration, hidden_size 288,
│                               6 encoder + 6 decoder layers, vocab 32768, bos 1, eos 2
├── generation_config.json      bos 1, decoder_start 1, eos 2
├── preprocessor_config.json    MoonshineFeatureExtractor, sampling_rate 16000
├── tokenizer.json              PreTrainedTokenizerFast, ~32k byte-level BPE
├── tokenizer_config.json       clean_up_tokenization_spaces: false
└── onnx/
    ├── encoder_model.onnx            ~30 MB
    └── decoder_model_merged.onnx     ~75 MB
```

Fetch these once with the transformers library pointed at `models/`, then the app runs fully offline. The directory name must be the exact repo-style path `onnx-community/moonshine-tiny-ONNX` because the pipeline call passes that string as the model id and the library joins it onto `localModelPath`.

---

## 8. `main.js` — Electron shell

### 8.1 Python discovery and dependency check

```javascript
function findPython() {
  const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version)'], { windowsHide: true, timeout: 10000 });
      if (r.status === 0 && r.stdout && r.stdout.length) return cmd;
    } catch (e) { /* try next */ }
  }
  return null;
}

function checkBackendDeps(py) {
  try {
    const r = spawnSync(py, ['-c', 'import fastapi, uvicorn, httpx, numpy'], { windowsHide: true, timeout: 20000 });
    return r.status === 0;
  } catch (e) {
    return false;
  }
}
```

**Include `mcp` in that import list.** The MCP server process cannot start without it, and omitting it produces a confusing failure much later instead of a clear dialog at launch.

Failure paths use `dialog.showErrorBox` with a copy-pasteable `pip install` line and the app folder path.

### 8.2 Dynamic port and health gate

```javascript
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}
```

Never hardcode a port. `waitForHealth(port, 40000)` polls `GET /api/health` every 300 ms, resolving on 200 and rejecting at the deadline with a firewall-permission hint.

### 8.3 Spawn

```javascript
backendPort = await getFreePort();
const args = ['-m', 'uvicorn', 'backend.server:app',
  '--host', '127.0.0.1', '--port', String(backendPort), '--log-level', 'warning'];
backendProc = spawn(py, args, { cwd, windowsHide: true });
```

Pipe both `stdout` and `stderr` to the console prefixed `[backend]`, log `exit` with its code, and `kill()` the process in `before-quit`.

### 8.4 Moonshine IPC handler

```javascript
ipcMain.handle('stt:moonshine', async (_event, samples) => {
  try {
    return await sttMoonshine.transcribe(new Float32Array(samples));
  } catch (e) {
    return { error: e.message || String(e) };
  }
});
```

Reconstruct a `Float32Array` from the received value — IPC does not preserve the typed-array type. **Return errors as `{error}` instead of rejecting**, so the renderer receives a normal resolved value and renders the message inline rather than throwing an unhandled rejection.

### 8.5 Window and permissions

```javascript
mainWindow = new BrowserWindow({
  width: 1320, height: 860, minWidth: 960, minHeight: 640,
  backgroundColor: '#0f1115',
  title: 'Private Journal',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
});
mainWindow.removeMenu();
mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'),
  { query: { port: String(backendPort) } });
```

Mic access needs an explicit permission grant — Electron denies it by default:

```javascript
session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
  callback(permission === 'media' || permission === 'microphone');
});
```

`contextIsolation: true` with `nodeIntegration: false` is mandatory. The renderer's only privileged capability is the narrow preload bridge.

### 8.6 `preload.js`

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('journalShell', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node
  },
  transcribeMoonshine: (samples) => ipcRenderer.invoke('stt:moonshine', samples)
});
```

Expose exactly what the renderer needs. No filesystem, no shell, no arbitrary IPC channel.

### 8.7 Renderer capture and dispatch

The renderer requests the microphone, builds an `AudioContext` at 16 kHz, and accumulates raw float frames. The `gain` node at zero volume is a deliberate sink that keeps the `ScriptProcessor` pulling without echoing the mic to the speakers:

```javascript
const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
const source = ctx.createMediaStreamSource(stream);
const proc = ctx.createScriptProcessor(4096, 1, 1);
const gain = ctx.createGain();
gain.gain.value = 0;
const chunks = [];
proc.onaudioprocess = (ev) => {
  chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
};
source.connect(proc); proc.connect(gain); gain.connect(ctx.destination);
```

On stop: stop tracks, disconnect all nodes, close the context, concatenate the chunks into one `Float32Array`, and dispatch by selected engine.

```javascript
const rate = r.ctx.sampleRate || 16000;
if (sttEngine() === "moonshine") transcribeMoonshine(r.chunks, rate);
else transcribeWhisper(r.chunks, rate);
```

Moonshine path uploads the WAV for playback **and** transcribes, concurrently — the two are independent:

```javascript
const total = chunks.reduce((n, c) => n + c.length, 0);
const samples = new Float32Array(total);
let off = 0;
for (const c of chunks) { samples.set(c, off); off += c.length; }

const fd = new FormData();
fd.append("file", encodeWav(chunks, rate), "voice.wav");
const upload = fetch(API + "/api/audio/upload", { method: "POST", body: fd })
  .then(async (res) => {
    const d = await res.json();
    if (!res.ok) throw new Error(d.detail || "upload failed");
    return d.audio_id;
  });

Promise.all([window.journalShell.transcribeMoonshine(samples), upload])
  .then(([result, audioId2]) => {
    if (result && result.error) throw new Error(result.error);
    // …applyTranscript(result); audioId = audioId2;
  });
```

Re-check `result.error` on the resolved value — the handler resolves errors rather than rejecting, so an exception check alone will not fire.

---

## 9. `backend/mcp_client.py` — MCP transport

Owns one long-lived stdio session to `python -m backend.mcp_server`, created lazily and reused.

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(
    command=sys.executable,        # the same interpreter running the backend
    args=["-m", "backend.mcp_server"],
    cwd=str(config.BASE_DIR),      # so `-m backend.…` resolves
    env=dict(os.environ),          # forward PATH/HOME to the child
)
```

Module-level `_state = {"lock", "session", "stdio", "tools"}`.

**Manual context-manager lifecycle.** `stdio_client` yields an async context manager whose lifetime must span many calls, so `__aenter__` is invoked explicitly and the manager objects are stashed:

```python
cm = stdio_client(params)
read, write = await cm.__aenter__()
session = await ClientSession(read, write).__aenter__()
await session.initialize()
listed = await session.list_tools()
_state.update(session=session, stdio=cm, tools=listed.tools)
```

`_ensure()` guards connect with an `asyncio.Lock` (created lazily) and raises `RuntimeError("journal tool server unavailable")` on failure. `_close()` calls `__aexit__(None, None, None)` on both, swallowing errors. `reset()` drops the session so the next call reconnects — the self-healing path.

### 9.1 API

```python
async def get_tools() -> list            # → OpenAI-style schemas
async def call_tool(name, arguments) -> str
async def reset() -> None
```

**MCP 2.x API specifics.** These differ from 1.x and silently produce empty results if wrong:

- `session.list_tools()` returns a `ListToolsResult`; read **`.tools`**.
- Input schema is **`tool.input_schema`** (snake_case), not `inputSchema`.
- Result content is a list of blocks; read `getattr(c, "text", None)`. There is no `.text` on the result object itself.

`get_tools()`:

```python
{"type": "function",
 "function": {"name": t.name, "description": t.description or "", "parameters": t.input_schema}}
```

`call_tool` defends against argument shape drift: Ollama sometimes returns `arguments` as a **JSON string**, so `json.loads` it if `isinstance(arguments, str)` and coerce anything non-dict to `{}`. On exception, `reset()` then re-raise. Returns `"\n".join(parts)`.

---

## 10. `backend/rag.py` — the agent

`MAX_STEPS = 10`.

### 10.1 Helpers

```python
def _snippet(text, limit=700)     # newlines → spaces, hard cut with "…"
def _sources_from(answer, entries)
```

`_sources_from` extracts `[E<digits>]` ids from the answer, joins them against candidates, and returns at most 6 `{id, date, title, snippet(300)}`. **No citations means no sources** — sources are strictly what the model claimed to use.

### 10.2 System prompt A — retrieval-grounded answering

```
You are a private journal assistant. You answer questions ONLY about what is in the user's own journal,
using the dated excerpts below. Rules:
- Base your answer on the excerpts. Prefer the most relevant ones.
- After any claim drawn from an excerpt, cite it inline like [E3] using the id shown.
- Only cite entries you actually used — never cite every excerpt.
- You may synthesize across entries, but never invent facts or dates not in the journal.
- If the journal does not contain the answer, say so plainly and suggest what to journal about.
Keep it warm, direct, and plain-text (no markdown headers).
```

### 10.3 System prompt B — the MCP agent (verbatim)

```
You are a private journal assistant. You answer questions ONLY about what is in the user's own journal,
using the read-only tools available to you.

How to work:
1. Your FIRST reply must be a tool call, not text. You cannot know the answer without looking.
2. If a tool returns nothing useful, call a DIFFERENT tool instead of answering. An empty
   result means "wrong tool", not "nothing in the journal".

Which tool to reach for:
- vector_search - natural-language questions, meaning, feelings, themes. Usually the best first try.
- search_entries - exact words or names (a person's name, "sourdough").
- sql_query - counting, aggregating by date or mood, or filtering precisely.
- read_entry - read a matched entry fully before quoting or interpreting it.
- related_entries - what else connects to a given entry.

Rules:
- Base every claim on tool results; never invent facts, names or dates.
- After any claim drawn from an entry, cite it inline like [E3] using the id from the tool result.
- Only cite entries you actually used.
- Answer conversationally, in your own words: summarize. Never paste raw entry text or tool JSON.
- Never ask the user for more detail before searching - search first, then ask only if genuinely ambiguous.
- If the journal does not contain the answer, say so plainly and suggest what to journal about.
Keep it warm, direct, and plain-text (no markdown headers).
```

The first two numbered rules and the tool-selection block are **bug fixes, not style**. See §11.

### 10.4 Retrieval primitive

```python
async def _retrieve(text, top_k=None)
    """→ (top_ids_above_threshold, {id: cosine}). (None, {}) when no embeddings exist."""
```

Embed the query → `mat @ qvec` → normalize by row norms and query norm (division-guarded) → `np.argsort(sims)[::-1]` → collect ids while `sims[i] >= REL_SIM_THRESHOLD`, stopping at `top_k`.

`None` versus `[]` is meaningful: `None` = no embeddings exist at all, `[]` = nothing relevant. Callers produce different messages for each.

### 10.5 The tool loop

```python
async def _answer_with_tools(question: str, tools: list) -> {"answer", "sources"}

messages = [{"role": "system", "content": SYSTEM_TOOLS},
            {"role": "user",   "content": question}]
used_ids = set()
answer = ""
force_tool = True
for _step in range(MAX_STEPS):
    resp = await ollama_client.chat_messages(
        messages, tools=tools, temperature=0.3,
        tool_choice="required" if force_tool else None)
    force_tool = False
    calls = resp["tool_calls"]
    if not calls:                      # prose → this is the answer
        answer = resp["content"]
        break
    messages.append({"role": "assistant", "content": resp["content"] or "", "tool_calls": calls})
    for tc in calls:
        fn = tc.get("function", {})
        name = fn.get("name", "")
        args = fn.get("arguments") or {}
        try:
            result = await mcp_client.call_tool(name, args)
            for found in re.findall(r'"?id"?\s*[:=]\s*(\d+)', result[:4000]):
                used_ids.add(int(found))
        except Exception as e:
            result = json.dumps({"error": str(e)})
        messages.append({"role": "tool", "name": name, "content": (result or "")[:8000]})
```

Non-negotiable details:

- **`force_tool` applies to the first turn only.** Without it, qwen2.5:3b narrates its plan in prose and the loop exits immediately with a promise instead of an answer.
- **Tool results truncate to 8000 chars** before re-entering the context window.
- **`used_ids` scraping** over the first 4000 chars recovers sources when the model omits citations.
- **Tool failures are fed back as `{"error": ...}`**, so the model can retry a different tool instead of the loop aborting.

No-answer fallbacks when the loop ends without prose:

```python
if used_ids:
    answer = ("I searched your journal but couldn't put together a confident answer. "
              "Try rephrasing the question.")
else:
    answer = ("I couldn't answer that from your journal — I couldn't find anything relevant "
              "when I looked. Try rephrasing, or write more about it.")
```

### 10.6 Vacuous-answer source suppression

When the model answers but cites nothing, the naive fallback shows the top similar entries — which makes *"your journal has nothing about finances"* display two irrelevant source cards. Detect a negative answer and suppress sources entirely.

```python
VACUOUS = ("do not have", "don't have", "no information", "no entries", "cannot",
           "no evidence", "not written about", "did not write", "does not contain",
           "no mention", "no record", "not something that can be found",
           "not in", "no such", "not found in")
if not cited and any(p in answer.lower() for p in VACUOUS):
    ids = set()
```

### 10.7 Public entry point

```python
async def answer_question(question: str) -> {"answer", "sources"}
    try:    tools = await mcp_client.get_tools()
    except Exception:
        tools = []
    if tools:
        try:    return await _answer_with_tools(question, tools)
        except Exception:
            pass        # tool server or model failure → degrade, never surface
    return await _answer_fallback(question)
```

`_answer_fallback` is the retrieval-grounded path in §10.2: top-k vector hits, graph expansion via `db.get_related` for the first `max(1, RAG_TOP_K // 2)` hits capped at `RAG_TOP_K + 4`, excerpts formatted as `[E{id}] (YYYY-MM-DD) title\nsnippet700`, then one `temperature=0.3` LLM call. Uncited answers fall back to the top-2 candidates **only if** none of them is vacuous and all clear `REL_SIM_THRESHOLD`.

A dropped MCP session must never surface as a user-facing error.

---

## 11. `backend/organize.py`, `insights.py`, `server.py`

### 11.1 `organize.py` — structuring a new entry

Runs after every create: embed → LLM JSON extraction → upsert tags/entities → rebuild links.

The system prompt demands **strict JSON** with exactly these keys:

```json
{
  "title": "short title, at most 8 words, or null",
  "summary": "1-2 sentence factual summary of what happened/was felt",
  "tags": ["3-7 lowercase concise topic keywords/short phrases"],
  "entities": [{"name": "...", "type": "person|place|org|project|event|thing"}],
  "mood": "one lowercase English word describing the emotional tone, or null"
}
```

`ALLOWED_ENTITY_TYPES = {"person","place","org","project","event","thing"}`; unknown types coerce to `"thing"`.

`_extract_json(content)` is three-stage — direct `json.loads`, then regex `\{.*\}` with `re.DOTALL`, then `raise ValueError(f"Ollama did not return valid JSON: {content[:300]}")`. Small models emit fenced JSON even under `format="json"`.

`_sanitize(data)` never raises. Caps: summary 500, title 80, mood 24 lowercased, tags 40 chars lowercased with `[^a-z0-9 ._-]` → `-`, de-duplicated, max 8; entities 60 chars, de-duplicated case-insensitively, max 15. Tolerates `tags` arriving as a string (split on `[,;]`) and `entities` arriving as a dict. Returns a fixed shape including `organize_error`.

`organize_entry(entry_id)`: embedding failure → mark `organized=False` and return the entry (offline tolerance, no exception). LLM or parse failure → `_sanitize({})` with `organize_error` set and `organized = not organize_error`. Otherwise persist AI fields, title, tags, entities, then `rebuild_links_for_entry` against the freshly loaded matrix. Only the first 4000 characters of text are sent; `temperature=0.2`, `json_mode=True`.

### 11.2 `insights.py` — follow-up question

Gate before spending an LLM call: require `max(cosine similarity to any *other* entry) >= FOLLOWUP_MIN_SIM`, excluding the entry itself, else return `None`. Candidates = top-k vector hits **plus** entries from `db.get_related(entry_id, limit=8)` whose links include `shared_tag` or `shared_entity`, capped at 6.

`temperature=0.8`. Prompt (verbatim):

```
You are a warm, curious companion to someone who journals.
Today the person wrote a new journal entry. Below it are a few of their PAST entries that relate to it (by
similarity score and shared tags/people). Write EXACTLY ONE follow-up question that:
- refers to something specific from the related past entries (a person, an event, a feeling, a topic) and connects it to today's entry,
- sounds like a thoughtful friend who wants to understand more, not a therapist,
- is a single plain-text sentence ending with "?".
Do not invent facts about the person. A superficial link (e.g. only 'same person wrote both') is NOT a real
connection. If the past entries do not clearly relate to today's entry, reply with exactly: none
```

`_first_question(q)` scans lines, strips `-*•"'“` prefixes and trailing quotes, returns `None` if a line starts with `none`, else the first line ending in `?` truncated to 300 chars. `RuntimeError` from Ollama → `None`; never block the UI.

### 11.3 `server.py` — routes

`app = FastAPI(title="Private Journal Backend")` with permissive CORS (`allow_origins=["*"]`, all methods, all headers) — required because the renderer loads from `file://` on a different origin than the dynamic port.

Pydantic models: `EntryCreate(text: 1..200000, title?, source="text", audio_id?)`, `EntryUpdate(text?, title?)`, `ChatIn(question: 1..2000)`.

`@app.on_event("startup")` → `db.init_db()`.

```
GET    /api/health                    Ollama reachability + configured chat and embedding models
GET    /api/entries?limit=200&offset=0
GET    /api/entries/{id}
POST   /api/entries                   create, then organize + follow-up
PUT    /api/entries/{id}
DELETE /api/entries/{id}
GET    /api/entries/{id}/relateD
GET    /api/entries/{id}/follow-up
GET    /api/search?q=&limit=
GET    /api/graph
POST   /api/audio/upload              store wav, return audio_id
GET    /api/audio/{audio_id}          FileResponse
POST   /api/chat                      → rag.answer_question
```

`/api/health` returns:

```json
{"ok": true,
 "ollama": {"reachable": true, "chat_model": "qwen2.5:3b", "chat_model_ok": true,
            "embed_model": "nomic-embed-text", "embed_model_ok": true},
 "whisper": {"cli_found": true, "model_set": true}}
```

`ok` is `reachable and chat_ok and embed_ok`. Electron blocks the window on this endpoint.

`/api/chat` **converts `RuntimeError` into a normal payload** rather than a 500:

```python
try:
    return await rag.answer_question(body.question)
except RuntimeError as e:
    return {"answer": f"⚠ {e}", "sources": []}
```

Those messages are user-facing setup instructions (`ollama pull qwen2.5:3b`). Rendering them as the assistant message beats a JSON error blob in the console.

---

## 12. Consolidated MCP Agent Configuration

| Element | Value |
|---|---|
| Transport | stdio, child process `python -m backend.mcp_server` |
| Server class | `mcp.server.mcpserver.MCPServer` (mcp ≥ 2.2) |
| Tool decorator | `@server.tool(name=..., description=...)` |
| Session lifecycle | lazy, persistent, `asyncio.Lock`-guarded, self-resetting |
| Schema conversion | `{"type":"function","function":{name, description, parameters}}` from `Tool.input_schema` |
| Max steps | 10 |
| Temperature | 0.3 |
| First turn `tool_choice` | `"required"` |
| Later turns | `None` (model may answer) |
| Tool result cap | 8000 chars into context; 4000 chars for id scraping |
| System prompt | §10.3 |
| Write access | none — `mode=ro` + SQL verb whitelist |
| Connect failure | `RuntimeError("journal tool server unavailable")` |
| Loop failure | silent fallback to retrieval-grounded path |

Tool-selection guidance, embedded in the prompt because a 3B model cannot infer it:

| Question shape | Tool |
|---|---|
| meaning, feelings, themes, natural language | `vector_search` |
| a specific person's name, one exact word | `search_entries` |
| counting, grouping, date or mood filters | `sql_query` |
| mood or volume overall ("how much", "how often") | `journal_stats` |
| full text of a known entry before quoting | `read_entry` |
| "what else connects to this" | `related_entries` |

---

## 13. Known Failure Modes — Do Not Regress

Each was observed in a working build. The countermeasure is already specified above.

1. **Model narrates instead of searching.** qwen2.5:3b replied *"I'll first look at your recent entries…"* and stopped; the loop read zero tool calls and treated the plan as the answer. → `tool_choice="required"` on turn 1 only.
2. **Empty tool result misread as "nothing in the journal".** `search_entries("work recent")` did a literal-phrase `LIKE`, returned `[]`, and the agent reported the user had no work entries. → per-word retry in `search_entries` plus the prompt line *"An empty result means 'wrong tool', not 'nothing in the journal'."*
3. **Aggregation over a text column.** Asked about mood, the model wrote `AVG(mood)` and reported 0.0. → mood declared TEXT in the `sql_query` description, `GROUP BY` prescribed, `journal_stats` offered as the better tool.
4. **Sources rendered for negative answers.** The uncited-answer fallback blindly showed top-2 similar entries. → vacuous-phrase detection (§10.6) suppresses sources.
5. **Inconsistent citations.** The agent often produces a correct long answer with no `[E#]`, so `sources` is `[]` despite reading the right entries. Partially mitigated by `used_ids` scraping; still the weakest link in the chain.
6. **Keyword substring false positives.** `"work"` matches `"Ironworks"`. Unfixed by design; documented in the `search_entries` description so the model prefers `vector_search` for concepts.
7. **MCP 2.x API drift.** `list_tools()` returns a result object, not a list; `inputSchema` → `input_schema`.
8. **Moonshine silently empty.** Quiet or distant speech yields an empty string, which looks like a broken microphone. → throw with actionable advice rather than returning `""`.
9. **Moonshine reaching the network.** Without `env.allowRemoteModels = false` the library fetches tokenizer/config files remotely even with local weights. → the flag is a privacy requirement, not an optimization.
10. **Stylesheet clobbered by a bad write.** An append to `src/styles.css` was written as a full overwrite and destroyed all styling; with no version control the file was unrecoverable. → **run `git init` before any further work, and verify line counts after large writes.**

---

## 14. Build Order

Each step is independently verifiable before the next begins.

1. `backend/__init__.py` (empty) and `requirements.txt`; `pip install -r backend/requirements.txt`.
2. `config.py` — no dependencies.
3. `db.py` with the DDL above. Verify: `python -c "from backend import db; db.init_db()"` creates `data/journal.db` with seven tables.
4. `ollama_client.py`. Verify against a running Ollama: `ping`, `list_models`, one `chat`, one `embed`.
5. `mcp_server.py`. Verify: `python -m backend.mcp_server` starts and **waits** rather than exiting — a stdio server that returns immediately is broken.
6. `mcp_client.py`. Verify: `await get_tools()` returns 6 OpenAI-style schemas; `await call_tool("journal_stats", {})` returns JSON.
7. `rag.py`. Verify: the agent reaches a tool on turn 1, and stopping the MCP server degrades to retrieval without an error.
8. `organize.py`, `insights.py`.
9. `server.py`. Verify `/api/health`, then create an entry and confirm auto-organize populated tags and entities.
10. `stt_moonshine.js` + `models/` + `main.js` + `preload.js`. Verify: record 5 s of speech, confirm text appears and the audio plays back.
11. `src/` renderer. Verify: window loads, port arrives via query string, all views render.

**Acceptance checks**

- MCP reports exactly 6 tools.
- `sql_query` rejects `DROP TABLE`, `INSERT`, and multi-statement SQL.
- The agent's first turn emits a tool call, not prose.
- `AVG(mood)` never appears in a tool call.
- A question with no answer in the journal returns `"sources": []` from both paths.
- Killing the MCP subprocess mid-session does not error the UI; the next chat transparently reconnects.
- Moonshine loads with no network access — verify by disconnecting Wi-Fi after first load.
- Record silence → a clear inline error, not an empty entry.
- `git init` committed before any further refactor.

---

## 15. Honest Limitations

- The 3B chat model is the latency bottleneck: agent answers run several seconds per turn, and a multi-tool question can take tens of seconds.
- Citation markers from a 3B model are unreliable, so `sources` may be empty on a correct answer.
- `vector_search` is brute-force cosine over a NumPy matrix in memory. Comfortable into the low thousands of entries; not beyond.
- `sql_query` returns JSON rows into the model context. Wide `SELECT *` wastes tokens — prefer narrow projections.
- No pagination beyond `limit`/`offset`; the graph is capped at the newest `GRAPH_MAX_ENTRIES`.
- Moonshine **Tiny** is a small model: it handles clear speech well and degrades noticeably with background noise, accents, or long rambling monologue.
- Single-user by design. No authentication, no encryption at rest, CORS wide open. Acceptable bound to `127.0.0.1`; do not expose this backend to a network.
