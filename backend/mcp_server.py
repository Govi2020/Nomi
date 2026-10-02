import json
import sqlite3

import numpy as np
from mcp.server.mcpserver import MCPServer
from mcp.types import TextContent

from . import config, db, ollama_client

MAX_SNIPPET = 1200
MAX_CELL = 600

server = MCPServer(
    name="journal",
    title="Private Journal (read-only)",
    description="Read-only access to the user's private journal: SQL queries, vector search, "
    "entry reads, keyword search and statistics.",
    version="1.0.0",
)


def _ro_conn():
    path = str(config.DB_PATH).replace("\\", "/")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _clean_sql(raw):
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


def _text(payload):
    return [TextContent(type="text", text=payload)]


def _dump(data):
    return json.dumps(data, ensure_ascii=False, default=str)


@server.tool(
    name="sql_query",
    description="Run a READ-ONLY SQL SELECT on the journal database. Returns {columns, rows, truncated} as JSON. Never modify data.\nSchema: entries(id, created_at ISO8601, updated_at, title, text, summary, audio_path, source, mood TEXT word like 'happy'/'sad', organized 0|1); tags(id,name); entry_tags(entry_id,tag_id); entities(id,name,type); entry_entities(entry_id,entity_id).\nImportant: mood is a text label, so use GROUP BY mood for counts — never AVG/SUM over it. Use substr(created_at,1,7) for the month. For a mood summary prefer journal_stats.",
)
def sql_query(sql: str) -> list[TextContent]:
    try:
        clean = _clean_sql(sql)
        with _ro_conn() as conn:
            cursor = conn.execute(clean)
            rows = cursor.fetchmany(101)
            columns = [description[0] for description in cursor.description or []]
        values = [
            [value[:MAX_CELL] if isinstance(value, str) else value for value in row]
            for row in rows[:100]
        ]
        return _text(_dump({"columns": columns, "rows": values, "truncated": len(rows) > 100}))
    except ValueError as exc:
        return _text(_dump({"error": str(exc)}))
    except sqlite3.Error as exc:
        return _text(_dump({"error": f"SQL error: {exc}"}))


@server.tool(
    name="vector_search",
    description="Search journal entries by meaning, themes, feelings, or natural-language questions. Returns similar entries ranked by cosine similarity.",
)
async def vector_search(query: str, top_k: int = 5, min_score: float = 0.2) -> list[TextContent]:
    try:
        top_k = max(1, min(int(top_k), 10))
        qvec = np.asarray(await ollama_client.embed(query), dtype=np.float32)
        ids, matrix = db.load_all_embeddings()
        if not ids or matrix.size == 0 or matrix.shape[1] != qvec.size:
            return _text("[]")
        sims = matrix @ qvec
        denom = np.linalg.norm(matrix, axis=1) * np.linalg.norm(qvec)
        np.divide(sims, denom, out=sims, where=denom > 0)
        hits = []
        for index in np.argsort(sims)[::-1]:
            score = float(sims[index])
            if score < min_score:
                continue
            entry = db.get_entry(ids[index])
            if not entry:
                continue
            hits.append(
                {
                    "id": entry["id"],
                    "date": entry["created_at"][:10],
                    "title": entry.get("title") or "",
                    "score": score,
                    "snippet": (entry.get("summary") or entry["text"])[:MAX_SNIPPET],
                }
            )
            if len(hits) >= top_k:
                break
        return _text(_dump(hits))
    except RuntimeError as exc:
        return _text(_dump({"error": str(exc)}))


@server.tool(
    name="read_entry",
    description="Read a journal entry by its numeric id. Use this to inspect a matched entry fully before quoting or interpreting it.",
)
def read_entry(entry_id: int) -> list[TextContent]:
    entry = db.get_entry(entry_id)
    if not entry:
        return _text(_dump({"error": "entry not found"}))
    return _text(
        _dump(
            {
                key: (entry.get(key, "")[:4000] if key == "text" else entry.get(key))
                for key in ("id", "created_at", "title", "summary", "mood", "tags", "entities", "source", "text")
            }
        )
    )


@server.tool(
    name="search_entries",
    description="Keyword search over entry text, titles, tags and people/places. Pass a single word or name (e.g. 'sourdough', 'Ami'). Multi-word queries are matched per-word. Use for exact words; use vector_search for meaning or natural-language questions.",
)
def search_entries(query: str, limit: int = 10) -> list[TextContent]:
    limit = max(1, min(int(limit), 50))
    results = db.search_entries(query, limit=limit)
    if not results:
        seen = {}
        for word in [word for word in query.split() if len(word) > 2][:4]:
            for entry in db.search_entries(word, limit=limit):
                seen[entry["id"]] = entry
        results = sorted(seen.values(), key=lambda item: item["created_at"], reverse=True)[:limit]
    return _text(
        _dump(
            [
                {
                    "id": entry["id"],
                    "date": entry["created_at"][:10],
                    "title": entry.get("title") or "",
                    "snippet": (entry.get("summary") or entry["text"])[:MAX_SNIPPET],
                }
                for entry in results
            ]
        )
    )


@server.tool(
    name="related_entries",
    description="Find journal entries connected to a known entry by similar meaning, shared tags, or shared entities.",
)
def related_entries(entry_id: int) -> list[TextContent]:
    results = db.get_related(entry_id, limit=12)
    return _text(
        _dump(
            [
                {
                    "id": entry["id"],
                    "date": entry["created_at"][:10],
                    "title": entry.get("title") or "",
                    "links": entry.get("links", []),
                }
                for entry in results
            ]
        )
    )


@server.tool(
    name="journal_stats",
    description="Summarize journal counts, date range, popular tags and entities, and mood distribution. Use for questions about overall mood or journaling frequency.",
)
def journal_stats() -> list[TextContent]:
    with _ro_conn() as conn:
        totals = conn.execute("SELECT COUNT(*) AS count, MIN(created_at) AS first, MAX(created_at) AS last FROM entries").fetchone()
        tags = conn.execute(
            "SELECT t.name,COUNT(*) AS count FROM tags t JOIN entry_tags et ON et.tag_id=t.id "
            "GROUP BY t.id ORDER BY count DESC,t.name LIMIT 10"
        ).fetchall()
        entities = conn.execute(
            "SELECT n.name,n.type,COUNT(*) AS count FROM entities n "
            "JOIN entry_entities ee ON ee.entity_id=n.id GROUP BY n.id "
            "ORDER BY count DESC,n.name LIMIT 10"
        ).fetchall()
        moods = conn.execute(
            "SELECT mood,COUNT(*) AS count FROM entries WHERE mood IS NOT NULL "
            "GROUP BY mood ORDER BY count DESC,mood"
        ).fetchall()
    return _text(
        _dump(
            {
                "count": totals["count"],
                "first": totals["first"],
                "last": totals["last"],
                "top_tags": [dict(row) for row in tags],
                "top_entities": [dict(row) for row in entities],
                "moods": [dict(row) for row in moods],
            }
        )
    )


if __name__ == "__main__":
    server.run(transport="stdio", log_level="ERROR")