import httpx

from . import config

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=config.OLLAMA_HOST,
            timeout=httpx.Timeout(180.0, connect=5.0),
        )
    return _client


async def ping():
    try:
        return (await _get_client().get("/api/tags")).status_code == 200
    except httpx.HTTPError:
        return False


async def list_models():
    try:
        response = await _get_client().get("/api/tags")
        _raise_for_response(response)
        return response.json().get("models", [])
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Could not reach Ollama ({config.OLLAMA_HOST}). Is it running? ({exc})") from exc


def _model_available(installed, name):
    names = [item.get("name", "") if isinstance(item, dict) else str(item) for item in installed]
    if name in names:
        return True
    base = name.split(":", 1)[0]
    return any(candidate.split(":", 1)[0] == base for candidate in names)


def _raise_for_response(response, model=None):
    if response.status_code < 400:
        return
    try:
        body = response.text[:300]
    except Exception:
        body = ""
    if response.status_code == 404 and "model" in body.lower():
        missing = model or config.CHAT_MODEL
        raise RuntimeError(f"Ollama model '{missing}' not found. Run: ollama pull {missing}")
    raise RuntimeError(f"Ollama error {response.status_code}: {body}")


async def _check_model():
    models = await list_models()
    if not _model_available(models, config.CHAT_MODEL):
        raise RuntimeError(
            f"Ollama model '{config.CHAT_MODEL}' not found. Run: ollama pull {config.CHAT_MODEL}"
        )


async def chat(system, user, json_mode=False, temperature=0.4):
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    result = await chat_messages(messages, temperature=temperature, json_mode=json_mode)
    return result.get("content", "")


async def chat_messages(messages, tools=None, temperature=0.4, json_mode=False, tool_choice=None):
    await _check_model()
    payload = {
        "model": config.CHAT_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature},
    }
    if tools:
        payload["tools"] = tools
    if tool_choice:
        payload["tool_choice"] = tool_choice
    if json_mode:
        payload["format"] = "json"
    try:
        response = await _get_client().post("/api/chat", json=payload)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Could not reach Ollama ({config.OLLAMA_HOST}). Is it running? ({exc})") from exc
    _raise_for_response(response)
    message = response.json().get("message", {})
    tool_calls = []
    for call in message.get("tool_calls", []) or []:
        function = call.get("function", {})
        tool_calls.append(
            {
                "function": {
                    "name": function.get("name", ""),
                    "arguments": function.get("arguments", {}),
                }
            }
        )
    return {"content": message.get("content", "") or "", "tool_calls": tool_calls}


async def embed(text):
    client = _get_client()
    try:
        response = await client.post("/api/embed", json={"model": config.EMBED_MODEL, "input": text})
        if response.status_code < 400:
            data = response.json().get("embeddings", [])
            if data:
                return data[0]
    except httpx.HTTPError:
        response = None
    try:
        response = await client.post(
            "/api/embeddings", json={"model": config.EMBED_MODEL, "prompt": text}
        )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Could not reach Ollama ({config.OLLAMA_HOST}). Is it running? ({exc})") from exc
    if response.status_code >= 400:
        _raise_for_response(response, config.EMBED_MODEL)
    embedding = response.json().get("embedding")
    if not embedding:
        raise RuntimeError("Ollama returned no embedding")
    return embedding