import asyncio
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import config, db, insights, ollama_client, organize, rag

app = FastAPI(title="Private Journal Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class EntryCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200000)
    title: str | None = None
    source: str = "text"
    audio_id: str | None = None


class EntryUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=200000)
    title: str | None = None


class ChatIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


@app.on_event("startup")
def startup():
    db.init_db()


def _audio_path(audio_id):
    try:
        safe_id = str(uuid.UUID(audio_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=404, detail="audio not found")
    path = (config.AUDIO_DIR / f"{safe_id}.wav").resolve()
    if path.parent != config.AUDIO_DIR.resolve() or not path.is_file():
        raise HTTPException(status_code=404, detail="audio not found")
    return path


@app.get("/api/health")
async def health():
    reachable = await ollama_client.ping()
    models = await ollama_client.list_models() if reachable else []
    chat_ok = ollama_client._model_available(models, config.CHAT_MODEL)
    embed_ok = ollama_client._model_available(models, config.EMBED_MODEL)
    return {
        "ok": bool(reachable and chat_ok and embed_ok),
        "ollama": {
            "reachable": reachable,
            "chat_model": config.CHAT_MODEL,
            "chat_model_ok": chat_ok,
            "embed_model": config.EMBED_MODEL,
            "embed_model_ok": embed_ok,
        },
        "whisper": {
            "cli_found": bool(config.WHISPER_CLI and shutil.which(config.WHISPER_CLI)),
            "model_set": bool(config.WHISPER_MODEL),
        },
    }


@app.get("/api/entries")
def entries(limit: int = Query(default=200, ge=1, le=1000), offset: int = Query(default=0, ge=0)):
    return db.list_entries(limit, offset)


@app.get("/api/entries/{entry_id}")
def entry(entry_id: int):
    result = db.get_entry(entry_id)
    if result is None:
        raise HTTPException(status_code=404, detail="entry not found")
    return result


@app.post("/api/entries")
async def create_entry(body: EntryCreate):
    audio_path = None
    if body.audio_id:
        audio_path = str(_audio_path(body.audio_id))
    entry_id = db.create_entry(body.text, body.title, body.source, audio_path)
    organized = await organize.organize_entry(entry_id)
    follow_up = await insights.follow_up(entry_id)
    return {"entry": organized or db.get_entry(entry_id), "follow_up": follow_up}


@app.put("/api/entries/{entry_id}")
def update_entry(entry_id: int, body: EntryUpdate):
    if body.text is None and body.title is None:
        result = db.get_entry(entry_id)
        if result is None:
            raise HTTPException(status_code=404, detail="entry not found")
        return result
    if not db.update_entry(entry_id, text=body.text, title=body.title):
        raise HTTPException(status_code=404, detail="entry not found")
    return db.get_entry(entry_id)


@app.delete("/api/entries/{entry_id}")
def delete_entry(entry_id: int):
    if not db.delete_entry(entry_id):
        raise HTTPException(status_code=404, detail="entry not found")
    return {"ok": True}


@app.get("/api/entries/{entry_id}/related")
@app.get("/api/entries/{entry_id}/relateD", include_in_schema=False)
def related_entries(entry_id: int):
    if db.get_entry(entry_id) is None:
        raise HTTPException(status_code=404, detail="entry not found")
    return db.get_related(entry_id, limit=20)


@app.get("/api/entries/{entry_id}/follow-up")
async def follow_up(entry_id: int):
    if db.get_entry(entry_id) is None:
        raise HTTPException(status_code=404, detail="entry not found")
    return {"question": await insights.follow_up(entry_id)}


@app.get("/api/search")
def search(q: str = Query(default=""), limit: int = Query(default=50, ge=1, le=1000)):
    return db.search_entries(q, limit)


@app.get("/api/graph")
def graph():
    return db.get_graph()


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not config.WHISPER_CLI or not config.WHISPER_MODEL:
        raise HTTPException(status_code=503, detail="Secondary transcription is not configured.")
    cli = shutil.which(config.WHISPER_CLI)
    if not cli:
        raise HTTPException(status_code=503, detail=f"Whisper CLI not found: {config.WHISPER_CLI}")
    config.ensure_dirs()
    temporary = config.AUDIO_DIR / f"transcribe-{uuid.uuid4().hex}.wav"
    try:
        with temporary.open("wb") as output:
            shutil.copyfileobj(file.file, output)
        process = await asyncio.create_subprocess_exec(
            cli,
            "-m", config.WHISPER_MODEL,
            "-f", str(temporary),
            "-l", config.WHISPER_LANG,
            "-nt",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=180)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise HTTPException(status_code=504, detail="Whisper transcription timed out.")
        if process.returncode:
            detail = stderr.decode(errors="replace")[-500:]
            raise HTTPException(status_code=500, detail=f"Whisper failed: {detail}")
        return {"text": stdout.decode(errors="replace").strip()}
    finally:
        temporary.unlink(missing_ok=True)
        await file.close()


@app.post("/api/audio/upload")
async def upload_audio(file: UploadFile = File(...)):
    config.ensure_dirs()
    audio_id = str(uuid.uuid4())
    target = config.AUDIO_DIR / f"{audio_id}.wav"
    size = 0
    try:
        with target.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Audio file exceeds 100 MB.")
                output.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    return {"audio_id": audio_id}


@app.get("/api/audio/{audio_id}")
def get_audio(audio_id: str):
    return FileResponse(_audio_path(audio_id), media_type="audio/wav")


@app.post("/api/chat")
async def chat(body: ChatIn):
    try:
        return await rag.answer_question(body.question)
    except RuntimeError as exc:
        return {"answer": f"⚠ {exc}", "sources": []}