import json
import re

import numpy as np

from . import config, db, mcp_client, ollama_client

MAX_STEPS = 10
VACUOUS = (
    "do not have", "don't have", "no information", "no entries", "cannot",
    "no evidence", "not written about", "did not write", "does not contain",
    "no mention", "no record", "not something that can be found", "not in",
    "no such", "not found in",
)

SYSTEM_RETRIEVAL = """You are a private journal assistant. You answer questions ONLY about what is in the user's own journal,
using the dated excerpts below. Rules:
- Base your answer on the excerpts. Prefer the most relevant ones.
- After any claim drawn from an excerpt, cite it inline like [E3] using the id shown.
- Only cite entries you actually used — never cite every excerpt.
- You may synthesize across entries, but never invent facts or dates not in the journal.
- If the journal does not contain the answer, say so plainly and suggest what to journal about.
Answer in a warm, attentive voice. Acknowledge the feeling or intent behind the question when it is clear, then answer directly and gently. Be receptive to corrections and follow-up questions. Keep it plain-text (no markdown headers), grounded in the journal, and avoid performative empathy or invented details."""

SYSTEM_TOOLS = """You are a private journal assistant. You answer questions ONLY about what is in the user's own journal,
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
Answer in a warm, attentive voice. Acknowledge the feeling or intent behind the question when it is clear, then answer directly and gently. Be receptive to corrections and follow-up questions. Keep it plain-text (no markdown headers), grounded in tool results, and avoid performative empathy or invented details."""


def _snippet(text, limit=700):
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _sources_from(answer, entries):
    ids = {int(value) for value in re.findall(r"\[E(\d+)\]", answer or "")}
    by_id = {entry["id"]: entry for entry in entries}
    return [
        {
            "id": entry_id,
            "date": by_id[entry_id]["created_at"][:10],
            "title": by_id[entry_id].get("title") or "",
            "snippet": _snippet(by_id[entry_id].get("summary") or by_id[entry_id]["text"], 300),
        }
        for entry_id in ids
        if entry_id in by_id
    ][:6]


def _tool_result_is_empty(result):
    try:
        payload = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return not (result or "").strip()
    if isinstance(payload, list):
        return not payload
    if isinstance(payload, dict):
        return "error" in payload or not payload or payload.get("rows") == [] or payload.get("results") == []
    return not bool(payload)


async def _retrieve(text, top_k=None):
    ids, matrix = db.load_all_embeddings()
    if not ids:
        return None, {}
    vector = np.asarray(await ollama_client.embed(text), dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[1] != vector.size:
        return [], {}
    sims = matrix @ vector
    denom = np.linalg.norm(matrix, axis=1) * np.linalg.norm(vector)
    np.divide(sims, denom, out=sims, where=denom > 0)
    found = {}
    cap = top_k or config.RAG_TOP_K
    for index in np.argsort(sims)[::-1]:
        if sims[index] < config.REL_SIM_THRESHOLD:
            break
        found[ids[index]] = float(sims[index])
        if len(found) >= cap:
            break
    return list(found), found


MODE_GUIDANCE = {
    "Recall": "Answer factual questions from journal entries. Be clear when the journal has no answer.",
    "Reflect": "Help the user notice patterns, feelings, and changes across their journal. Be thoughtful and tentative, not diagnostic.",
    "Plan": "Help turn the user's journal context into a practical, gentle next-step plan. Separate remembered priorities from suggestions.",
}


def _history_messages(history):
    return [
        {"role": item.role, "content": item.content}
        for item in (history or [])[-12:]
        if item.role in ("user", "assistant") and item.content.strip()
    ]


async def _answer_with_tools(question, tools, mode="Recall", history=None):
    messages = [
        {"role": "system", "content": SYSTEM_TOOLS + "\n\nMode: " + MODE_GUIDANCE.get(mode, MODE_GUIDANCE["Recall"])},
        *_history_messages(history),
        {"role": "user", "content": question},
    ]
    used_ids = set()
    answer = ""
    force_tool = True
    failed_tools = set()
    for _ in range(MAX_STEPS):
        retrying = bool(failed_tools)
        available_tools = (
            [tool for tool in tools if tool["function"]["name"] not in failed_tools]
            if retrying
            else tools
        )
        if retrying:
            messages.append(
                {
                    "role": "user",
                    "content": "The previous tool returned no useful result. Call a different tool before answering.",
                }
            )
        response = await ollama_client.chat_messages(
            messages,
            tools=available_tools,
            temperature=0.3,
            tool_choice="required" if force_tool or retrying else None,
        )
        force_tool = False
        calls = response["tool_calls"]
        if not calls:
            if retrying:
                continue
            answer = response["content"]
            break
        failed_tools.clear()
        messages.append(
            {"role": "assistant", "content": response["content"] or "", "tool_calls": calls}
        )
        for call in calls:
            function = call.get("function", {})
            name = function.get("name", "")
            arguments = function.get("arguments") or {}
            try:
                result = await mcp_client.call_tool(name, arguments)
                for match in re.findall(r'"?id"?\s*[:=]\s*(\d+)', result[:4000]):
                    used_ids.add(int(match))
            except Exception as exc:
                result = json.dumps({"error": str(exc)})
            if _tool_result_is_empty(result):
                failed_tools.add(name)
            messages.append({"role": "tool", "name": name, "content": (result or "")[:8000]})
    if not answer:
        answer = (
            "I searched your journal but couldn't put together a confident answer. "
            "Try rephrasing the question."
            if used_ids
            else "I couldn't answer that from your journal — I couldn't find anything relevant "
            "when I looked. Try rephrasing, or write more about it."
        )
    entries = db.get_entries_by_ids(used_ids)
    cited = _sources_from(answer, entries)
    if not cited and any(phrase in answer.lower() for phrase in VACUOUS):
        used_ids.clear()
    elif not cited:
        cited = _sources_from(" ".join(f"[E{entry_id}]" for entry_id in used_ids), entries)
    return {"answer": answer, "sources": cited if used_ids else []}


async def _answer_fallback(question, mode="Recall", history=None):
    ids, scores = await _retrieve(question)
    if ids is None:
        raise RuntimeError("No journal embeddings are available yet. Add an entry while Ollama is running.")
    entries = {entry["id"]: entry for entry in db.get_entries_by_ids(ids)}
    selected = list(ids)
    for entry_id in ids[: max(1, config.RAG_TOP_K // 2)]:
        for related in db.get_related(entry_id, limit=20):
            if related["id"] not in entries:
                entries[related["id"]] = related
                selected.append(related["id"])
            if len(selected) >= config.RAG_TOP_K + 4:
                break
    excerpts = []
    for entry_id in selected:
        entry = entries[entry_id]
        excerpts.append(
            f"[E{entry_id}] ({entry['created_at'][:10]}) {entry.get('title') or 'Untitled'}\n"
            f"{_snippet(entry.get('summary') or entry['text'])}"
        )
    prompt = "Journal excerpts:\n\n" + "\n\n".join(excerpts or ["(No relevant entries found.)"])
    messages = [
        {"role": "system", "content": SYSTEM_RETRIEVAL + "\n\nMode: " + MODE_GUIDANCE.get(mode, MODE_GUIDANCE["Recall"])},
        *_history_messages(history),
        {"role": "user", "content": f"{prompt}\n\nQuestion: {question}"},
    ]
    response = await ollama_client.chat_messages(messages, temperature=0.3)
    answer = response.get("content", "")
    sources = _sources_from(answer, [entries[item] for item in selected])
    if not sources and not any(phrase in answer.lower() for phrase in VACUOUS):
        sources = [
            {
                "id": entries[item]["id"],
                "date": entries[item]["created_at"][:10],
                "title": entries[item].get("title") or "",
                "snippet": _snippet(entries[item].get("summary") or entries[item]["text"], 300),
            }
            for item in ids[:2]
            if scores.get(item, 0) >= config.REL_SIM_THRESHOLD
        ]
    return {"answer": answer, "sources": sources}


async def answer_question(question, mode="Recall", history=None):
    history = history or []
    if mode == "General":
        messages = [
            {"role": "system", "content": "You are a warm, helpful assistant. Answer general questions directly and conversationally. Use prior turns for context. Do not claim personal experiences. If the user asks about their own past, explain that Recall or Search can look through their journal."},
            *_history_messages(history),
            {"role": "user", "content": question},
        ]
        response = await ollama_client.chat_messages(messages, temperature=0.5)
        return {"answer": response.get("content", ""), "sources": []}
    if not db.list_entries(limit=1):
        message = "Your journal is empty right now, so there aren't any saved moments to look through yet. Add an entry and I'll be able to help you reflect on it."
        if mode == "Search":
            message = "I couldn't find a match because your journal is empty. Once you add an entry, I can search it for you."
        return {"answer": message, "sources": []}
    if mode == "Search":
        ignored = {"about", "what", "when", "where", "which", "find", "search", "show", "tell", "from", "with", "that", "this", "have", "did", "was", "were", "the", "and", "for", "entries", "entry", "journal", "notes", "note"}
        terms = [term for term in re.findall(r"[\w'-]+", question.lower()) if len(term) > 2 and term not in ignored]
        matches = []
        seen = set()
        for term in terms or [question]:
            for entry in db.search_entries(term, limit=8):
                if entry["id"] not in seen:
                    seen.add(entry["id"])
                    matches.append(entry)
                if len(matches) >= 8:
                    break
            if len(matches) >= 8:
                break
        excerpts = [
            f"[E{entry['id']}] ({entry['created_at'][:10]}) {entry.get('title') or 'Untitled'}\n{_snippet(entry.get('summary') or entry['text'])}"
            for entry in matches
        ]
        messages = [
            {"role": "system", "content": "You search the user's journal for literal keyword matches. Report what matched in a concise, friendly way. Only use the supplied entries; cite used entries with [E{id}]. If none match, say no exact matches were found and suggest a related phrase."},
            *_history_messages(history),
            {"role": "user", "content": f"Search phrase: {question}\n\nMatching entries:\n" + "\n\n".join(excerpts or ["(No matches.)"])},
        ]
        response = await ollama_client.chat_messages(messages, temperature=0.2)
        answer = response.get("content", "")
        return {"answer": answer, "sources": _sources_from(answer, matches)}
    try:
        tools = await mcp_client.get_tools()
    except Exception:
        tools = []
    if tools:
        try:
            return await _answer_with_tools(question, tools, mode, history)
        except Exception:
            pass
    return await _answer_fallback(question, mode, history)
