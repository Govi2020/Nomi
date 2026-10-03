import json
import re

import numpy as np

from . import config, db, ollama_client

ALLOWED_ENTITY_TYPES = {"person", "place", "org", "project", "event", "thing"}
SYSTEM = """Extract structured metadata from the journal entry. Return strict JSON with exactly these keys:
{"title":"short title, at most 8 words, or null","summary":"1-2 sentence factual summary of what happened/was felt","tags":["3-7 lowercase concise topic keywords/short phrases"],"entities":[{"name":"...","type":"person|place|org|project|event|thing"}],"mood":"one lowercase English word describing the emotional tone, or null"}
Do not invent details. Use null for unknown title or mood."""


def _extract_json(content):
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError):
        match = re.search(r"\{.*\}", content or "", re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    raise ValueError(f"Ollama did not return valid JSON: {(content or '')[:300]}")


def _sanitize(data):
    data = data if isinstance(data, dict) else {}
    title = data.get("title")
    title = str(title).strip()[:80] if title else None
    summary = str(data.get("summary") or "").strip()[:500] or None
    mood = str(data.get("mood") or "").strip().lower()[:24] or None
    raw_tags = data.get("tags") or []
    if isinstance(raw_tags, str):
        raw_tags = re.split(r"[,;]", raw_tags)
    tags, seen_tags = [], set()
    for value in raw_tags if isinstance(raw_tags, list) else []:
        tag = re.sub(r"[^a-z0-9 ._-]", "-", str(value).lower()).strip()[:40]
        if tag and tag not in seen_tags:
            seen_tags.add(tag)
            tags.append(tag)
        if len(tags) == 8:
            break
    raw_entities = data.get("entities") or []
    if isinstance(raw_entities, dict):
        raw_entities = [raw_entities]
    entities, seen_entities = [], set()
    for entity in raw_entities if isinstance(raw_entities, list) else []:
        if isinstance(entity, str):
            entity = {"name": entity}
        if not isinstance(entity, dict):
            continue
        name = str(entity.get("name") or "").strip()[:60]
        key = name.casefold()
        if not name or key in seen_entities:
            continue
        kind = str(entity.get("type") or "thing").lower()
        entities.append({"name": name, "type": kind if kind in ALLOWED_ENTITY_TYPES else "thing"})
        seen_entities.add(key)
        if len(entities) == 15:
            break
    return {
        "title": title,
        "summary": summary,
        "tags": tags,
        "entities": entities,
        "mood": mood,
        "organize_error": None,
    }


def _fallback_title(text):
    sentence = re.split(r"(?<=[.!?])\s+", " ".join((text or "").split()), maxsplit=1)[0]
    words = sentence.split()
    title = " ".join(words[:9]).strip(" ,;:-")
    if len(words) > 9:
        title = title.rstrip(".!?") + "…"
    title = title[:80]
    return title[0].upper() + title[1:] if title else "A moment from your diary"


def _fallback_summary(text):
    cleaned = " ".join((text or "").split())
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    summary = " ".join(sentences[:2]).strip()
    if len(summary) > 500:
        summary = summary[:497].rsplit(" ", 1)[0].rstrip(".,;:") + "…"
    return summary or None


async def organize_entry(entry_id):
    entry = db.get_entry(entry_id)
    if not entry:
        return None
    fallback_title = _fallback_title(entry.get("text", ""))
    fallback_summary = _fallback_summary(entry.get("text", ""))
    try:
        vector = np.asarray(await ollama_client.embed(entry["text"]), dtype=np.float32)
    except Exception:
        db.update_ai_fields(
            entry_id,
            summary=entry.get("summary") or fallback_summary,
            mood=entry.get("mood"),
            organized=False,
        )
        if not (entry.get("title") or "").strip():
            db.update_entry(entry_id, title=fallback_title, ai_fields_only=True)
        return db.get_entry(entry_id)
    db.save_embedding(entry_id, vector, config.EMBED_MODEL)
    try:
        content = await ollama_client.chat(
            SYSTEM,
            "Journal entry:\n" + entry["text"][:4000],
            json_mode=True,
            temperature=0.2,
        )
        organized = _sanitize(_extract_json(content))
    except Exception as exc:
        organized = _sanitize({})
        organized["organize_error"] = str(exc)
    organized["title"] = organized["title"] or entry.get("title") or fallback_title
    organized["summary"] = organized["summary"] or entry.get("summary") or fallback_summary
    organized["mood"] = organized["mood"] or entry.get("mood")
    is_organized = not organized["organize_error"]
    db.update_ai_fields(
        entry_id,
        organized["summary"],
        entry.get("mood") or organized["mood"],
        is_organized,
    )
    if organized["title"] and not (entry.get("title") or "").strip():
        db.update_entry(entry_id, title=organized["title"], ai_fields_only=True)
    if is_organized:
        db.set_entry_tags(entry_id, organized["tags"])
        db.set_entry_entities(entry_id, organized["entities"])
    ids, matrix = db.load_all_embeddings()
    db.rebuild_links_for_entry(entry_id, ids, matrix)
    return db.get_entry(entry_id)
