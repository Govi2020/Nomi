import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("JOURNAL_DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "journal.db"
AUDIO_DIR = DATA_DIR / "audio"

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "qwen2.5:3b")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")

WHISPER_CLI = os.environ.get("WHISPER_CLI", "").strip()
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "").strip()
WHISPER_LANG = os.environ.get("WHISPER_LANG", "en")

LINK_SIM_THRESHOLD = float(os.environ.get("LINK_SIM_THRESHOLD", "0.35"))
REL_SIM_THRESHOLD = float(os.environ.get("REL_SIM_THRESHOLD", "0.20"))
FOLLOWUP_MIN_SIM = float(os.environ.get("FOLLOWUP_MIN_SIM", "0.45"))
RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "6"))
GRAPH_MAX_ENTRIES = int(os.environ.get("GRAPH_MAX_ENTRIES", "300"))


def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)