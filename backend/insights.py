import re

from . import config, db, ollama_client
from .rag import _retrieve

PROMPT = """You are a warm, curious companion to someone who journals.
Today the person wrote a new journal entry. Below it are a few of their PAST entries that relate to it (by
similarity score and shared tags/people). Write EXACTLY ONE follow-up question that:
- refers to something specific from the related past entries (a person, an event, a feeling, a topic) and connects it to today's entry,
- sounds like a thoughtful friend who wants to understand more, not a therapist,
- is a single plain-text sentence ending with "?".
Do not invent facts about the person. A superficial link (e.g. only 'same person wrote both') is NOT a real
connection. If the past entries do not clearly relate to today's entry, reply with exactly: none"""

DEEPER_PROMPT = """You are a thoughtful, emotionally attuned journaling companion.
Respond to the person's latest journal thoughts with one or two concise, open-ended questions.
Use their exact situation and feeling as context; do not merely repeat or paraphrase their words.
Be curious and nonjudgmental, do not diagnose, assume motives, or minimize feelings.
If the person describes hurting someone, ask what was happening for them and what led up to the moment,
without excusing harm or escalating blame. Return only the question or questions, with no preamble."""

PERSPECTIVE_PROMPT = """You are a thoughtful journaling companion. Offer one gentle alternative perspective grounded only
in the person's latest journal thoughts, then ask one open-ended question. Do not diagnose, make assumptions,
or dismiss their feelings. Return only the perspective and question, with no preamble."""


def _first_question(answer):
    for line in (answer or "").splitlines():
        candidate = line.strip().lstrip("-*•\"'“").rstrip("\"'” ")
        if candidate.lower().startswith("none"):
            return None
        if candidate.endswith("?"):
            return candidate[:300]
    return None


async def follow_up(entry_id):
    entry = db.get_entry(entry_id)
    if not entry:
        return None
    try:
        ids, scores = await _retrieve(entry["text"])
    except Exception:
        return None
    if ids is None or max((score for key, score in scores.items() if key != entry_id), default=0) < config.FOLLOWUP_MIN_SIM:
        return None
    candidates = [item for item in ids if item != entry_id]
    for related in db.get_related(entry_id, limit=8):
        if related["id"] not in candidates and any(
            link["kind"] in {"shared_tag", "shared_entity"} for link in related.get("links", [])
        ):
            candidates.append(related["id"])
    candidates = candidates[:6]
    if not candidates:
        return None
    entries = {item["id"]: item for item in db.get_entries_by_ids(candidates)}
    excerpts = "\n\n".join(
        f"({entries[item]['created_at'][:10]}) {entries[item].get('title') or 'Untitled'}\n"
        f"{entries[item].get('summary') or entries[item]['text'][:500]}"
        for item in candidates if item in entries
    )
    try:
        answer = await ollama_client.chat(
            PROMPT,
            f"Today's entry:\n{entry['text'][:1200]}\n\nRelated past entries:\n{excerpts}",
            temperature=0.8,
        )
        return _first_question(answer)
    except RuntimeError:
        return None


async def writing_feedback(action, content):
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", content.strip()) if part.strip()]
    recent = " ".join(sentences[-2:])
    recent = recent[-1500:]
    if not recent:
        raise ValueError("Journal text is required.")

    prompt = DEEPER_PROMPT if action == "dig_deeper" else PERSPECTIVE_PROMPT
    result = await ollama_client.chat(prompt, f"Latest journal sentences:\n{recent}", temperature=0.7)
    feedback = result.strip().strip('"“”')
    if not feedback:
        raise RuntimeError("The AI returned no reflection.")
    return feedback[:1000]