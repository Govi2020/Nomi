import json
import re
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

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
  mood_score  REAL CHECK (mood_score IS NULL OR (mood_score >= 0 AND mood_score <= 10)),
  energy      TEXT,
  organized   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS entry_media (
  id           TEXT PRIMARY KEY,
  entry_id     INTEGER,
  path         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  media_type   TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_entry_media_entry ON entry_media(entry_id);
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


def _seed_demo_entries():
    samples = [
        {
            "title": "Call Maya before Friday",
            "text": "I need to call Maya before Friday and ask whether she still wants to join the reading group next week. We talked about meeting on Thursday and I still need to send the shortlist of books we were comparing. I should also ask if she wants me to bring the notes I wrote after the coffee chat. I am trying to keep the momentum going and not leave this hanging for another week.",
            "mood": "Thoughtful",
            "energy": "Steady",
            "tags": ["family", "friendship", "planning"],
            "entities": [{"name": "Maya", "type": "person"}, {"name": "reading group", "type": "thing"}],
        },
        {
            "title": "Finish the design notes",
            "text": "I have to finish the design notes for the new dashboard before the team review on Monday. I want to make sure the flow is clear and that the summary reflects what we tested on Saturday. I should bring the version with the simplified navigation and leave out the extra experiments that never ended up being useful. Everything feels less noisy when I trim it back to the user path.",
            "mood": "Focused",
            "energy": "High",
            "tags": ["work", "design", "planning"],
            "entities": [{"name": "Monday review", "type": "event"}, {"name": "dashboard", "type": "thing"}],
        },
        {
            "title": "Book the train for London",
            "text": "I need to book the train to London before the weekend rush and I also want to check the hotel reservation I made last month. I am pretty sure the dates still match, but I should confirm them anyway because I do not want to arrive with the wrong plan. The trip is meant to be restorative, not stressful, so I need to make the logistics easier rather than harder.",
            "mood": "Hopeful",
            "energy": "Medium",
            "tags": ["travel", "planning", "rest"],
            "entities": [{"name": "London", "type": "place"}, {"name": "hotel", "type": "thing"}],
        },
        {
            "title": "Clean the studio desk",
            "text": "I should clean the studio desk and make a proper space for the next round of work. I have been leaving notes and tools everywhere and it is beginning to feel like a cluttered mess. A clean surface would help me start again with more clarity. I want to sort the sketches, file the receipts, and leave the area ready for the next project session.",
            "mood": "Calm",
            "energy": "Medium",
            "tags": ["studio", "creativity", "organization"],
            "entities": [{"name": "studio desk", "type": "thing"}],
        },
        {
            "title": "Call Dad and ask about the garden",
            "text": "I need to call Dad and ask about the garden before I forget the details again. He always knows what is ready to harvest, what needs more watering, and which plants are finally starting to settle in. I want to hear how things are looking after the rain and whether he needs any help with the tomatoes or the herbs. It would be good to spend a little time listening and making a plan for the weekend.",
            "mood": "Warm",
            "energy": "Steady",
            "tags": ["family", "home", "nature"],
            "entities": [{"name": "Dad", "type": "person"}, {"name": "tomatoes", "type": "thing"}],
        },
        {
            "title": "Submit the application",
            "text": "I really need to submit the application before the deadline and I want to avoid the last-minute scramble. I have been gathering the materials for days and I am ready to upload the final version. I should also send a short follow-up email to the admissions coordinator and ask whether they need anything else. It feels much calmer once I stop revising and actually send it.",
            "mood": "Determined",
            "energy": "High",
            "tags": ["work", "education", "responsibility"],
            "entities": [{"name": "admissions coordinator", "type": "person"}, {"name": "application", "type": "thing"}],
        },
        {
            "title": "Take the bike in for service",
            "text": "I should take the bike in for service this week because the brakes have felt slightly unsteady for the last few rides. I need to check the repair shop hours and choose a slot that does not interfere with work. Once I get it sorted, I want to add a short route to the weekend plan so I can get back outside without worrying about the gears. It is a small thing, but it affects the whole mood of the week.",
            "mood": "Grounded",
            "energy": "Medium",
            "tags": ["health", "maintenance", "weekend"],
            "entities": [{"name": "repair shop", "type": "place"}, {"name": "bike", "type": "thing"}],
        },
        {
            "title": "Prepare the weekend meal plan",
            "text": "I want to prepare the weekend meal plan before the market closes so I can buy the ingredients in one trip. I need to think ahead to lunches, dinners, and a few easy snacks for the days when I am tired. I should also keep the plan realistic instead of ambitious. A little structure at the start of the week makes the rest of the days feel easier.",
            "mood": "Practical",
            "energy": "Low",
            "tags": ["home", "food", "planning"],
            "entities": [{"name": "market", "type": "place"}],
        },
        {
            "title": "Check in with Priya",
            "text": "I need to check in with Priya because she has been carrying a lot lately and I do not want to miss the chance to support her. I should send a message this evening and ask whether she wants to talk or just take a walk. I want to keep the conversation simple and open, without trying to fix everything. I think listening is the main thing I can offer right now.",
            "mood": "Caring",
            "energy": "Steady",
            "tags": ["friendship", "support", "care"],
            "entities": [{"name": "Priya", "type": "person"}],
        },
        {
            "title": "Sort the photo archive",
            "text": "I want to sort the photo archive this week and pull out the best shots from the last six months. I need to group them by trip, family, and studio work and decide what deserves to be saved in the best folders. I should also move the duplicate files into a separate archive so it is easier to browse the collection later. It feels like a good task for a slower afternoon when I can take my time and enjoy the memory of it.",
            "mood": "Reflective",
            "energy": "Quiet",
            "tags": ["memory", "family", "archives"],
            "entities": [{"name": "photo archive", "type": "thing"}],
        },
    ]
    for sample in samples:
        entry_id = create_entry(
            sample["text"],
            sample["title"],
            source="text",
            audio_path=None,
            mood=sample["mood"],
            energy=sample["energy"],
        )
        set_entry_tags(entry_id, sample["tags"])
        set_entry_entities(entry_id, sample["entities"])


def _should_seed_demo_entries():
    project_data_dir = (Path(__file__).resolve().parent.parent / "data").resolve()
    return config.DATA_DIR.resolve() == project_data_dir


def init_db():
    config.ensure_dirs()
    with closing(connect()) as conn:
        conn.executescript(SCHEMA)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(entries)")}
        if "energy" not in columns:
            conn.execute("ALTER TABLE entries ADD COLUMN energy TEXT")
        if "mood_score" not in columns:
            conn.execute(
                "ALTER TABLE entries ADD COLUMN mood_score REAL "
                "CHECK (mood_score IS NULL OR (mood_score >= 0 AND mood_score <= 10))"
            )
        conn.commit()
    with closing(connect()) as conn:
        if _should_seed_demo_entries() and conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == 0:
            _seed_demo_entries()


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
    media = {}
    for row in conn.execute(
        f"SELECT id, entry_id, filename, media_type, content_type FROM entry_media "
        f"WHERE entry_id IN ({marks}) ORDER BY created_at, id",
        ids,
    ):
        media.setdefault(row["entry_id"], []).append({
            "id": row["id"],
            "filename": row["filename"],
            "media_type": row["media_type"],
            "content_type": row["content_type"],
            "url": f"/api/media/{row['id']}",
        })
    for entry in entries:
        entry["tags"] = tags.get(entry["id"], [])
        entry["entities"] = entities.get(entry["id"], [])
        entry["media"] = media.get(entry["id"], [])
    return entries


def register_media(media_id, path, filename, media_type, content_type):
    with closing(connect()) as conn:
        conn.execute(
            "INSERT INTO entry_media(id,path,filename,media_type,content_type) VALUES(?,?,?,?,?)",
            (media_id, str(path), filename, media_type, content_type),
        )
        conn.commit()


def get_media(media_id):
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT id, entry_id, path, filename, media_type, content_type FROM entry_media WHERE id=?",
            (media_id,),
        ).fetchone()
        return dict(row) if row else None


def entry_media_paths(entry_id):
    with closing(connect()) as conn:
        return [row["path"] for row in conn.execute("SELECT path FROM entry_media WHERE entry_id=?", (entry_id,))]


def set_entry_media(entry_id, media_ids):
    media_ids = list(dict.fromkeys(str(media_id) for media_id in media_ids))
    with closing(connect()) as conn:
        if conn.execute("SELECT 1 FROM entries WHERE id=?", (entry_id,)).fetchone() is None:
            return None
        marks = ",".join("?" for _ in media_ids)
        requested = conn.execute(
            f"SELECT id, entry_id FROM entry_media WHERE id IN ({marks})" if media_ids else "SELECT id, entry_id FROM entry_media WHERE 0",
            media_ids,
        ).fetchall()
        if len(requested) != len(media_ids) or any(row["entry_id"] not in (None, entry_id) for row in requested):
            raise ValueError("One or more uploaded media files are unavailable.")
        previous = conn.execute("SELECT id, path FROM entry_media WHERE entry_id=?", (entry_id,)).fetchall()
        removed = [dict(row) for row in previous if row["id"] not in media_ids]
        if removed:
            removed_marks = ",".join("?" for _ in removed)
            conn.execute(f"DELETE FROM entry_media WHERE id IN ({removed_marks})", [row["id"] for row in removed])
        if media_ids:
            conn.execute(f"UPDATE entry_media SET entry_id=? WHERE id IN ({marks})", [entry_id, *media_ids])
        conn.commit()
        return [row["path"] for row in removed]


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


_TASK_COMMITMENT = re.compile(
    r"\b(?:i|we)\s+(?:(?:really|still|also|definitely|probably)\s+)*(?:"
    r"need(?: to)?|have to|should|must|plan to|intend to|hope to|aim to|"
    r"want to|will|am going to|are going to)\s+(.+)",
    re.IGNORECASE,
)
_TASK_COMPLETION = re.compile(
    r"\b(?:i|we)\s+(?:already\s+)?(?:finished|completed|did|handled|resolved|"
    r"took care of)\s+(.+)",
    re.IGNORECASE,
)


def _task_due_from_entry(text, created_at):
    combined = (text or "").strip()
    for label in ["tomorrow", "today", "this week", "next week", "later", "soon"]:
        if label.lower() in combined.lower():
            return label.title()
    try:
        if created_at:
            return created_at[:10]
    except (TypeError, ValueError):
        pass
    return "Soon"


def _clean_task_phrase(phrase):
    phrase = re.split(r"\b(?:because|so that|since|but|although)\b", phrase, maxsplit=1, flags=re.IGNORECASE)[0]
    phrase = re.sub(r"^(?:to\s+)?", "", phrase, flags=re.IGNORECASE)
    phrase = re.sub(r"^(?:also|still|really|finally|eventually|maybe|probably)\s+", "", phrase, flags=re.IGNORECASE)
    phrase = re.sub(r"\s+", " ", phrase).strip(" \t\r\n.,;:!?\"'()")
    return phrase


def _task_title(phrase):
    phrase = _clean_task_phrase(phrase)
    if not phrase or len(phrase.split()) < 2:
        return ""
    # A task should read as the action itself, not as the original diary sentence.
    phrase = phrase[:1].upper() + phrase[1:]
    return phrase[:100].rstrip(" ,;:")


def get_people(limit=10):
    limit = max(1, min(int(limit), 100))
    with closing(connect()) as conn:
        rows = conn.execute(
            """
            SELECT e.id, e.name, COUNT(DISTINCT ee.entry_id) AS moment_count, MAX(en.created_at) AS last_seen
            FROM entities e
            JOIN entry_entities ee ON ee.entity_id = e.id
            JOIN entries en ON en.id = ee.entry_id
            WHERE lower(e.type) = 'person'
            GROUP BY e.id, e.name
            ORDER BY moment_count DESC, last_seen DESC, e.name COLLATE NOCASE
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        people = []
        for row in rows:
            entity_id = row["id"]
            entry_ids = [gift["entry_id"] for gift in conn.execute(
                "SELECT entry_id FROM entry_entities WHERE entity_id=? ORDER BY entry_id DESC",
                (entity_id,),
            ).fetchall()]
            recent_entry = conn.execute(
                "SELECT id, title, summary, text, created_at FROM entries WHERE id IN ({marks}) ORDER BY created_at DESC, id DESC LIMIT 1".format(
                    marks=",".join("?" for _ in entry_ids) if entry_ids else "?"
                ),
                tuple(entry_ids) if entry_ids else (0,),
            ).fetchone()
            tag_rows = conn.execute(
                """
                SELECT t.name, COUNT(*) AS score
                FROM entry_tags et
                JOIN tags t ON t.id = et.tag_id
                WHERE et.entry_id IN ({marks})
                GROUP BY t.name
                ORDER BY score DESC, t.name COLLATE NOCASE
                LIMIT 3
                """.format(
                    marks=",".join("?" for _ in entry_ids) if entry_ids else "?"
                ),
                tuple(entry_ids) if entry_ids else (0,),
            ).fetchall()
            recent_title = None
            if recent_entry is not None:
                recent_title = (recent_entry["title"] or recent_entry["summary"] or recent_entry["text"] or "").strip()
                if recent_title:
                    recent_title = recent_title[:140]
            people.append({
                "name": row["name"],
                "moment_count": int(row["moment_count"]),
                "last_seen": row["last_seen"],
                "top_tags": [item["name"] for item in tag_rows],
                "recent_title": recent_title,
            })
        return people


def get_tasks(limit=8):
    limit = max(1, min(int(limit), 50))
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT id, title, summary, text, created_at FROM entries ORDER BY created_at DESC, id DESC LIMIT 500"
        ).fetchall()
        tasks = []
        seen = set()
        for row in rows:
            text = (row["text"] or "").strip()
            for sentence in re.split(r"(?<=[.!?])\s+|[\r\n]+", text):
                completion = _TASK_COMPLETION.search(sentence)
                match = completion or _TASK_COMMITMENT.search(sentence)
                if not match:
                    continue
                title = _task_title(match.group(1))
                if not title:
                    continue
                identity = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
                if identity in seen:
                    continue
                seen.add(identity)
                due = _task_due_from_entry(sentence, row["created_at"])
                context_title = (row["title"] or "").strip()
                summary = f"From your diary{f' entry “{context_title}”' if context_title else ''}."
                tasks.append({
                    "id": f"{row['id']}-{len(tasks)}",
                    "title": title,
                    "due": due,
                    "status": "done" if completion else "open",
                    "summary": summary,
                    "source_date": row["created_at"][:10] if row["created_at"] else None,
                })
                if len(tasks) >= limit:
                    return tasks
        return tasks


def get_entry(entry_id):
    return _entry_with_meta(entry_id)


_UNSET = object()


def create_entry(text, title=None, source="text", audio_path=None, mood=None, energy=None, mood_score=None):
    with closing(connect()) as conn:
        cur = conn.execute(
            "INSERT INTO entries(text,title,source,audio_path,mood,energy,mood_score) VALUES(?,?,?,?,?,?,?)",
            (text, title, source, audio_path, mood, energy, mood_score),
        )
        conn.commit()
        return cur.lastrowid


def update_entry(entry_id, text=None, title=None, ai_fields_only=False, mood=None, energy=None, mood_score=_UNSET):
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
    if mood_score is not _UNSET:
        fields.append("mood_score=?")
        values.append(mood_score)
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
        media_paths = [row["path"] for row in conn.execute("SELECT path FROM entry_media")]
        count = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        conn.execute("DELETE FROM entries")
        conn.execute("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM entry_tags WHERE tag_id=tags.id)")
        conn.execute(
            "DELETE FROM entities WHERE NOT EXISTS "
            "(SELECT 1 FROM entry_entities WHERE entity_id=entities.id)"
        )
        conn.commit()
        return {"deleted_count": count, "audio_paths": audio_paths, "media_paths": media_paths}


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
