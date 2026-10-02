import json
import sqlite3
import uuid
from contextlib import closing

import numpy as np

from . import config

SCHEMA = """
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
  energy      TEXT,
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
CREATE TABLE IF NOT EXISTS ask_chats (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS ask_turns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT NOT NULL,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  mode       TEXT NOT NULL,
  sources    TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (chat_id) REFERENCES ask_chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ask_turns_chat ON ask_turns(chat_id, id);
"""


def connect():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    config.ensure_dirs()
    with closing(connect()) as conn:
        conn.executescript(SCHEMA)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(entries)")}
        if "energy" not in columns:
            conn.execute("ALTER TABLE entries ADD COLUMN energy TEXT")
        conn.commit()


def _row_to_dict(row):
    if row is None:
        return None
    result = dict(row)
    result.pop("vector", None)
    return result


def _attach_meta(conn, entries):
    if not entries:
        return entries
    ids = [entry["id"] for entry in entries]
    marks = ",".join("?" for _ in ids)
    tags = {}
    entities = {}
    for row in conn.execute(
        f"SELECT et.entry_id, t.name FROM entry_tags et JOIN tags t ON t.id=et.tag_id "
        f"WHERE et.entry_id IN ({marks}) ORDER BY t.name COLLATE NOCASE",
        ids,
    ):
        tags.setdefault(row["entry_id"], []).append(row["name"])
    for row in conn.execute(
        f"SELECT ee.entry_id, e.name, e.type FROM entry_entities ee "
        f"JOIN entities e ON e.id=ee.entity_id WHERE ee.entry_id IN ({marks}) "
        "ORDER BY e.name COLLATE NOCASE",
        ids,
    ):
        entities.setdefault(row["entry_id"], []).append(
            {"name": row["name"], "type": row["type"]}
        )
    for entry in entries:
        entry["tags"] = tags.get(entry["id"], [])
        entry["entities"] = entities.get(entry["id"], [])
    return entries


def _entry_with_meta(entry_id):
    with closing(connect()) as conn:
        row = conn.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        if row is None:
            return None
        return _attach_meta(conn, [_row_to_dict(row)])[0]


def list_entries(limit=200, offset=0):
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT * FROM entries ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            (max(0, min(int(limit), 1000)), max(0, int(offset))),
        ).fetchall()
        return _attach_meta(conn, [_row_to_dict(row) for row in rows])


def get_entry(entry_id):
    return _entry_with_meta(entry_id)


def create_entry(text, title=None, source="text", audio_path=None, mood=None, energy=None):
    with closing(connect()) as conn:
        cur = conn.execute(
            "INSERT INTO entries(text,title,source,audio_path,mood,energy) VALUES(?,?,?,?,?,?)",
            (text, title, source, audio_path, mood, energy),
        )
        conn.commit()
        return cur.lastrowid


def update_entry(entry_id, text=None, title=None, ai_fields_only=False, mood=None, energy=None):
    fields, values = [], []
    if not ai_fields_only:
        if text is not None:
            fields.append("text=?")
            values.append(text)
    if title is not None:
        fields.append("title=?")
        values.append(title)
    if mood is not None:
        fields.append("mood=?")
        values.append(mood)
    if energy is not None:
        fields.append("energy=?")
        values.append(energy)
    if not fields:
        return get_entry(entry_id) is not None
    fields.append("updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    with closing(connect()) as conn:
        cur = conn.execute(
            f"UPDATE entries SET {', '.join(fields)} WHERE id=?", (*values, entry_id)
        )
        conn.commit()
        return cur.rowcount > 0


def update_ai_fields(entry_id, summary=None, mood=None, organized=False):
    with closing(connect()) as conn:
        cur = conn.execute(
            "UPDATE entries SET summary=?, mood=?, organized=?, "
            "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
            (summary, mood, int(bool(organized)), entry_id),
        )
        conn.commit()
        return cur.rowcount > 0


def create_ask_chat():
    chat_id = str(uuid.uuid4())
    with closing(connect()) as conn:
        conn.execute("INSERT INTO ask_chats(id) VALUES(?)", (chat_id,))
        conn.commit()
    return get_ask_chat(chat_id)


def list_ask_chats():
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT c.id, c.title, c.created_at, c.updated_at, "
            "(SELECT m.question FROM ask_turns m WHERE m.chat_id=c.id "
            "ORDER BY m.id DESC LIMIT 1) AS last_message "
            "FROM ask_chats c ORDER BY c.updated_at DESC, c.created_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def get_ask_chat(chat_id):
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT id, title, created_at, updated_at FROM ask_chats WHERE id=?",
            (chat_id,),
        ).fetchone()
        if row is None:
            return None
        chat = dict(row)
        messages = conn.execute(
            "SELECT id, question, answer, mode, sources, created_at FROM ask_turns "
            "WHERE chat_id=? ORDER BY id",
            (chat_id,),
        ).fetchall()
        turns = [dict(message) for message in messages]
        for turn in turns:
            turn["sources"] = json.loads(turn["sources"])
        return {"chat": chat, "turns": turns}


def add_ask_turn(chat_id, question, answer, mode, sources):
    with closing(connect()) as conn:
        chat = conn.execute(
            "SELECT title FROM ask_chats WHERE id=?", (chat_id,)
        ).fetchone()
        if chat is None:
            return None
        conn.execute(
            "INSERT INTO ask_turns(chat_id, question, answer, mode, sources) VALUES(?,?,?,?,?)",
            (chat_id, question, answer, mode, json.dumps(sources)),
        )
        if chat["title"] == "New conversation":
            title = " ".join(question.split())[:60] or "New conversation"
            conn.execute(
                "UPDATE ask_chats SET title=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
                (title, chat_id),
            )
        else:
            conn.execute(
                "UPDATE ask_chats SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
                (chat_id,),
            )
        conn.commit()
    return True


def search_entries(q, limit=50):
    term = f"%{(q or '').lower()}%"
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT DISTINCT e.* FROM entries e "
            "LEFT JOIN entry_tags et ON et.entry_id=e.id LEFT JOIN tags t ON t.id=et.tag_id "
            "LEFT JOIN entry_entities ee ON ee.entry_id=e.id "
            "LEFT JOIN entities n ON n.id=ee.entity_id "
            "WHERE lower(e.text) LIKE ? OR lower(coalesce(e.title,'')) LIKE ? "
            "OR lower(t.name) LIKE ? OR lower(n.name) LIKE ? "
            "ORDER BY e.created_at DESC, e.id DESC LIMIT ?",
            (term, term, term, term, max(1, min(int(limit), 1000))),
        ).fetchall()
        return _attach_meta(conn, [_row_to_dict(row) for row in rows])


def delete_entry(entry_id):
    with closing(connect()) as conn:
        cur = conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
        conn.commit()
        return cur.rowcount > 0


def delete_all_entries():
    with closing(connect()) as conn:
        audio_paths = [
            row["audio_path"]
            for row in conn.execute("SELECT audio_path FROM entries WHERE audio_path IS NOT NULL")
        ]
        count = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        conn.execute("DELETE FROM entries")
        conn.execute("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM entry_tags WHERE tag_id=tags.id)")
        conn.execute(
            "DELETE FROM entities WHERE NOT EXISTS "
            "(SELECT 1 FROM entry_entities WHERE entity_id=entities.id)"
        )
        conn.commit()
        return {"deleted_count": count, "audio_paths": audio_paths}


def get_entries_by_ids(ids):
    ids = list(dict.fromkeys(int(item) for item in ids))
    if not ids:
        return []
    marks = ",".join("?" for _ in ids)
    with closing(connect()) as conn:
        rows = conn.execute(
            f"SELECT * FROM entries WHERE id IN ({marks}) ORDER BY created_at DESC, id DESC",
            ids,
        ).fetchall()
        return _attach_meta(conn, [_row_to_dict(row) for row in rows])


def set_entry_tags(entry_id, names):
    with closing(connect()) as conn:
        conn.execute("DELETE FROM entry_tags WHERE entry_id=?", (entry_id,))
        for name in dict.fromkeys(str(value).strip() for value in names if str(value).strip()):
            conn.execute("INSERT INTO tags(name) VALUES(?) ON CONFLICT(name) DO NOTHING", (name,))
            conn.execute(
                "INSERT OR IGNORE INTO entry_tags(entry_id,tag_id) "
                "SELECT ?,id FROM tags WHERE name=?",
                (entry_id, name),
            )
        conn.commit()


def set_entry_entities(entry_id, entities):
    with closing(connect()) as conn:
        conn.execute("DELETE FROM entry_entities WHERE entry_id=?", (entry_id,))
        for entity in entities:
            name = str(entity.get("name", "")).strip()
            kind = str(entity.get("type", "thing")).strip() or "thing"
            if not name:
                continue
            conn.execute(
                "INSERT INTO entities(name,type) VALUES(?,?) "
                "ON CONFLICT(name) DO UPDATE SET type=excluded.type",
                (name, kind),
            )
            conn.execute(
                "INSERT OR IGNORE INTO entry_entities(entry_id,entity_id) "
                "SELECT ?,id FROM entities WHERE name=?",
                (entry_id, name),
            )
        conn.commit()


def save_embedding(entry_id, vector, model):
    array = np.asarray(vector, dtype=np.float32).reshape(-1)
    with closing(connect()) as conn:
        conn.execute(
            "INSERT INTO embeddings(entry_id,vector,dim,model) VALUES(?,?,?,?) "
            "ON CONFLICT(entry_id) DO UPDATE SET vector=excluded.vector, "
            "dim=excluded.dim, model=excluded.model",
            (entry_id, array.tobytes(), int(array.size), model),
        )
        conn.commit()


def load_embedding(entry_id):
    with closing(connect()) as conn:
        row = conn.execute("SELECT vector FROM embeddings WHERE entry_id=?", (entry_id,)).fetchone()
        return np.frombuffer(row["vector"], dtype=np.float32).copy() if row else None


def load_all_embeddings():
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT entry_id,vector,dim FROM embeddings ORDER BY entry_id"
        ).fetchall()
    if not rows:
        return [], np.empty((0, 0), dtype=np.float32)
    ids, vectors = [], []
    for row in rows:
        vector = np.frombuffer(row["vector"], dtype=np.float32).copy()
        ids.append(row["entry_id"])
        vectors.append(vector)
    dims = {vector.size for vector in vectors}
    if len(dims) != 1:
        size = min(dims)
        vectors = [vector[:size] for vector in vectors]
    return ids, np.vstack(vectors).astype(np.float32, copy=False)


def rebuild_links_for_entry(entry_id, matrix_ids, matrix, threshold=None):
    threshold = config.LINK_SIM_THRESHOLD if threshold is None else threshold
    candidates = {}
    vector = load_embedding(entry_id)
    if vector is not None and len(matrix_ids) and matrix.size:
        matrix = np.asarray(matrix, dtype=np.float32)
        if matrix.ndim == 2 and matrix.shape[1] == vector.size:
            sims = matrix @ vector
            denom = np.linalg.norm(matrix, axis=1) * np.linalg.norm(vector)
            np.divide(sims, denom, out=sims, where=denom > 0)
            for other_id, similarity in zip(matrix_ids, sims):
                if other_id != entry_id and similarity >= threshold:
                    pair = (min(entry_id, other_id), max(entry_id, other_id), "semantic")
                    candidates[pair] = max(candidates.get(pair, 0.0), float(similarity))
    with closing(connect()) as conn:
        for kind, table, id_column in (
            ("shared_tag", "entry_tags", "tag_id"),
            ("shared_entity", "entry_entities", "entity_id"),
        ):
            rows = conn.execute(
                f"SELECT other.entry_id, COUNT(*) AS weight FROM {table} own "
                f"JOIN {table} other ON own.{id_column}=other.{id_column} "
                f"WHERE own.entry_id=? AND other.entry_id<>? GROUP BY other.entry_id",
                (entry_id, entry_id),
            )
            for row in rows:
                other_id = row["entry_id"]
                pair = (min(entry_id, other_id), max(entry_id, other_id), kind)
                candidates[pair] = max(candidates.get(pair, 0.0), float(row["weight"]))
        conn.execute("DELETE FROM links WHERE src_id=? OR dst_id=?", (entry_id, entry_id))
        conn.executemany(
            "INSERT INTO links(src_id,dst_id,kind,weight) VALUES(?,?,?,?)",
            [(src, dst, kind, weight) for (src, dst, kind), weight in candidates.items()],
        )
        conn.commit()


def get_related(entry_id, limit=20):
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT CASE WHEN l.src_id=? THEN l.dst_id ELSE l.src_id END AS other_id, "
            "l.kind,l.weight FROM links l WHERE l.src_id=? OR l.dst_id=? "
            "ORDER BY l.weight DESC LIMIT ?",
            (entry_id, entry_id, entry_id, max(1, min(int(limit), 100))),
        ).fetchall()
        ids = list(dict.fromkeys(row["other_id"] for row in rows))
        entries = {entry["id"]: entry for entry in get_entries_by_ids(ids)}
        result = {}
        for row in rows:
            item = entries.get(row["other_id"])
            if item:
                if row["other_id"] not in result:
                    result[row["other_id"]] = dict(item, links=[])
                result[row["other_id"]]["links"].append(
                    {"kind": row["kind"], "weight": row["weight"]}
                )
        return list(result.values())


def get_graph():
    with closing(connect()) as conn:
        entries = conn.execute(
            "SELECT * FROM entries ORDER BY id DESC LIMIT ?",
            (config.GRAPH_MAX_ENTRIES,),
        ).fetchall()
        base = [_row_to_dict(row) for row in entries]
        included = {entry["id"] for entry in base}
        _attach_meta(conn, base)
        nodes, edges = [], []
        for entry in base:
            label = entry.get("title") or entry.get("summary") or entry["text"]
            nodes.append({"id": f"e{entry['id']}", "type": "entry", "label": label[:40]})
            for row in conn.execute(
                "SELECT t.id,t.name FROM entry_tags et JOIN tags t ON t.id=et.tag_id "
                "WHERE et.entry_id=?",
                (entry["id"],),
            ):
                node_id = f"t{row['id']}"
                existing = next((node for node in nodes if node["id"] == node_id), None)
                if existing:
                    existing["count"] += 1
                else:
                    nodes.append({"id": node_id, "type": "tag", "label": row["name"], "count": 1})
                edges.append({"source": f"e{entry['id']}", "target": node_id, "kind": "has_tag"})
            for row in conn.execute(
                "SELECT n.id,n.name,n.type FROM entry_entities ee JOIN entities n "
                "ON n.id=ee.entity_id WHERE ee.entry_id=?",
                (entry["id"],),
            ):
                node_id = f"n{row['id']}"
                existing = next((node for node in nodes if node["id"] == node_id), None)
                if existing:
                    existing["count"] += 1
                else:
                    nodes.append({"id": node_id, "type": row["type"], "label": row["name"], "count": 1})
                edges.append({"source": f"e{entry['id']}", "target": node_id, "kind": "has_entity"})
        pairs = set()
        if included:
            marks = ",".join("?" for _ in included)
            for row in conn.execute(
                f"SELECT src_id,dst_id FROM links WHERE src_id IN ({marks}) AND dst_id IN ({marks})",
                (*included, *included),
            ):
                pair = tuple(sorted((row["src_id"], row["dst_id"])))
                if pair not in pairs:
                    pairs.add(pair)
                    edges.append({"source": f"e{pair[0]}", "target": f"e{pair[1]}", "kind": "link"})
        return {"nodes": nodes, "edges": edges}