import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive,
  ArrowLeft,
  AudioLines,
  BookHeart,
  Check,
  ChevronRight,
  CircleHelp,
  FileAudio,
  Headphones,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import '@fontsource-variable/dm-sans';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import './styles.css';

const queryPort = new URLSearchParams(window.location.search).get('port');
const API_ROOT = import.meta.env.VITE_API_URL || (
  queryPort && /^\d{1,5}$/.test(queryPort)
    ? `http://127.0.0.1:${queryPort}`
    : 'http://127.0.0.1:8000'
);

async function api(path, options) {
  const response = await fetch(`${API_ROOT}${path}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.answer || payload || `Request failed (${response.status})`);
  }
  return payload;
}

function formatDate(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function getAudioUrl(path) {
  const filename = path?.split(/[\\/]/).pop();
  const audioId = filename?.replace(/\.wav$/i, '');
  return audioId ? `${API_ROOT}/api/audio/${audioId}` : null;
}

function App() {
  const [view, setView] = useState('journal');
  const [entries, setEntries] = useState([]);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [health, setHealth] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [followUp, setFollowUp] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const savingRef = useRef(false);

  const selected = entries.find((item) => item.id === selectedId) || null;

  async function refreshData({ preserveSelection = true } = {}) {
    const [nextEntries, nextGraph] = await Promise.all([
      api('/api/entries?limit=1000'),
      api('/api/graph'),
    ]);
    setEntries(nextEntries);
    setGraph(nextGraph);
    if (!preserveSelection && nextEntries.length) setSelectedId(nextEntries[0].id);
    if (selectedId && !nextEntries.some((item) => item.id === selectedId)) setSelectedId(null);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      api('/api/health').catch(() => null),
      api('/api/entries?limit=1000'),
      api('/api/graph'),
    ]).then(([status, rows, nextGraph]) => {
      if (!active) return;
      setHealth(status);
      setEntries(rows);
      setGraph(nextGraph);
      if (rows.length) setSelectedId(rows[0].id);
    }).catch((err) => {
      if (active) setError(err.message);
    });
    return () => { active = false; };
  }, []);

  async function runSearch(event) {
    event.preventDefault();
    try {
      const rows = query.trim()
        ? await api(`/api/search?q=${encodeURIComponent(query.trim())}&limit=1000`)
        : await api('/api/entries?limit=1000');
      setEntries(rows);
      setSelectedId(rows[0]?.id ?? null);
      setCreating(false);
      setEditing(false);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  function startNewEntry() {
    setView('journal');
    setSelectedId(null);
    setDraftTitle('');
    setDraftText('');
    setAudioFile(null);
    setCreating(true);
    setEditing(true);
    setFollowUp(null);
    setError('');
  }

  function startEdit() {
    if (!selected) return;
    setDraftTitle(selected.title || '');
    setDraftText(selected.text || '');
    setAudioFile(null);
    setCreating(false);
    setEditing(true);
    setError('');
  }

  function cancelEdit() {
    setCreating(false);
    setEditing(false);
    setAudioFile(null);
    setError('');
  }

  async function saveEntry(event) {
    event.preventDefault();
    if (savingRef.current || !draftText.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      let audioId = null;
      if (creating && audioFile) {
        const form = new FormData();
        form.append('file', audioFile, audioFile.name);
        audioId = (await api('/api/audio/upload', { method: 'POST', body: form })).audio_id;
      }
      let saved = creating
        ? await api('/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: draftTitle.trim() || null,
              text: draftText.trim(),
              source: audioFile ? 'voice' : 'text',
              audio_id: audioId,
            }),
          })
        : await api(`/api/entries/${selected.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: draftTitle.trim() || null, text: draftText.trim() }),
          });
      const explicitTitle = draftTitle.trim();
      if (creating && explicitTitle && saved.entry?.title !== explicitTitle) {
        saved = {
          ...saved,
          entry: await api(`/api/entries/${saved.entry.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: explicitTitle }),
          }),
        };
      }
      const savedEntry = saved.entry || saved;
      setFollowUp(saved.follow_up || null);
      setSelectedId(savedEntry.id);
      setCreating(false);
      setEditing(false);
      setAudioFile(null);
      const [nextEntries, nextGraph] = await Promise.all([
        api('/api/entries?limit=1000'),
        api('/api/graph'),
      ]);
      setEntries(nextEntries);
      setGraph(nextGraph);
    } catch (err) {
      setError(err.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function deleteSelected() {
    if (!selected || !window.confirm(`Delete "${selected.title || 'Untitled entry'}"? This cannot be undone.`)) return;
    try {
      await api(`/api/entries/${selected.id}`, { method: 'DELETE' });
      setSelectedId(null);
      setFollowUp(null);
      await refreshData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function askJournal(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError('');
    try {
      const result = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      setAnswer(result);
      setQuestion('');
    } catch (err) {
      setError(err.message);
    } finally {
      setAsking(false);
    }
  }

  async function openSource(source) {
    try {
      let entry = entries.find((item) => item.id === source.id);
      if (!entry) entry = await api(`/api/entries/${source.id}`);
      if (!entries.some((item) => item.id === entry.id)) setEntries((current) => [entry, ...current]);
      setSelectedId(entry.id);
      setCreating(false);
      setEditing(false);
      setView('journal');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  const title = view === 'journal' ? 'Your journal' : view === 'connections' ? 'Connections' : 'Ask your journal';
  const statusText = !health
    ? 'Backend unavailable'
    : health.ok
      ? 'Private and ready'
      : health.ollama?.reachable
        ? 'Journal ready · AI models missing'
        : 'Journal ready · Ollama offline';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#journal" onClick={(event) => { event.preventDefault(); setView('journal'); }}>
          <span className="brand-mark"><BookHeart size={21} strokeWidth={1.8} /></span>
          <span><strong>Nomi</strong><small>PRIVATE JOURNAL</small></span>
        </a>
        <div className="nav-label">YOUR SPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={view === 'journal' ? 'nav-item active' : 'nav-item'} onClick={() => setView('journal')}>
            <BookHeart size={18} /><span>Journal</span><span className="nav-count">{entries.length}</span>
          </button>
          <button className={view === 'connections' ? 'nav-item active' : 'nav-item'} onClick={() => setView('connections')}>
            <Share2 size={18} /><span>Connections</span>
          </button>
          <button className={view === 'ask' ? 'nav-item active' : 'nav-item'} onClick={() => setView('ask')}>
            <MessageCircle size={18} /><span>Ask your journal</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className={health?.ok ? 'status-dot online' : 'status-dot'} />
          <div><strong>{statusText}</strong><small>Stored on this device</small></div>
          <CircleHelp size={17} aria-label="Local journal status" />
        </div>
      </aside>

      <main className="main-area">
        <header className="page-header">
          <div>
            <p className="eyebrow">A QUIET PLACE TO RETURN TO</p>
            <h1>{title}</h1>
          </div>
          {view === 'journal' && (
            <button className="button-primary" onClick={startNewEntry}><Plus size={17} /> New entry</button>
          )}
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={17} /></button>
          </div>
        )}

        {view === 'journal' && (
          <div className="journal-layout">
            <section className="entry-list-panel" aria-label="Journal entries">
              <form className="search-form" onSubmit={runSearch}>
                <Search size={17} aria-hidden="true" />
                <input aria-label="Search your journal" placeholder="Search words, people, places..." value={query} onChange={(event) => setQuery(event.target.value)} />
                {query && <button type="button" className="icon-button clear-search" aria-label="Clear search" onClick={() => { setQuery(''); api('/api/entries?limit=1000').then(setEntries).catch((err) => setError(err.message)); }}><X size={15} /></button>}
              </form>
              <div className="list-heading"><span>{query ? 'SEARCH RESULTS' : 'RECENT ENTRIES'}</span><MoreHorizontal size={17} /></div>
              <div className="entry-list">
                {entries.map((entry) => (
                  <button key={entry.id} className={selectedId === entry.id && !editing ? 'entry-row selected' : 'entry-row'} onClick={() => { setSelectedId(entry.id); setCreating(false); setEditing(false); setFollowUp(null); }}>
                    <span className="entry-date">{formatDate(entry.created_at)}</span>
                    <strong>{entry.title || 'Untitled entry'}</strong>
                    <span className="entry-preview">{entry.summary || entry.text}</span>
                    <span className="entry-row-meta">
                      {entry.mood && <span className="mood-tag">{entry.mood}</span>}
                      {entry.tags?.slice(0, 2).map((tag) => <span className="mini-tag" key={tag}>{tag}</span>)}
                    </span>
                  </button>
                ))}
                {!entries.length && (
                  <div className="list-empty">
                    <Archive size={20} />
                    <p>{query ? 'No entries match those words.' : 'Your journal is ready when you are.'}</p>
                    {!query && <button onClick={startNewEntry}>Write an entry <ChevronRight size={15} /></button>}
                  </div>
                )}
              </div>
              <div className="list-footer"><span>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span><span>ON THIS DEVICE</span></div>
            </section>

            <section className="entry-detail" aria-label="Selected entry">
              {editing ? (
                <form className="entry-editor" onSubmit={saveEntry}>
                  <div className="editor-topline">
                    <span>{creating ? 'NEW JOURNAL ENTRY' : 'EDITING ENTRY'}</span>
                    <button type="button" className="icon-button" aria-label="Close editor" onClick={cancelEdit}><X size={19} /></button>
                  </div>
                  <input className="title-input" aria-label="Entry title" placeholder="Give this entry a title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={80} />
                  <textarea className="text-input" aria-label="Entry text" placeholder="What is on your mind?" value={draftText} onChange={(event) => setDraftText(event.target.value)} required maxLength={200000} autoFocus />
                  {creating && (
                    <div className="attachment-row">
                      <label className="attach-button">
                        <FileAudio size={16} /> Attach audio
                        <input type="file" accept="audio/wav,audio/*" onChange={(event) => setAudioFile(event.target.files?.[0] || null)} />
                      </label>
                      {audioFile && <span className="attached-file">{audioFile.name}<button type="button" className="icon-button" aria-label="Remove audio" onClick={() => setAudioFile(null)}><X size={14} /></button></span>}
                    </div>
                  )}
                  <div className="editor-footer">
                    <span>{draftText.length.toLocaleString()} / 200,000</span>
                    <div>
                      <button type="button" className="button-quiet" onClick={cancelEdit}>Cancel</button>
                      <button className="button-primary" disabled={saving || !draftText.trim()}>
                        {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                        {saving ? 'Saving...' : 'Save entry'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : selected ? (
                <article className="reading-view">
                  <div className="reading-actions">
                    <span><span className="journal-glyph"><BookHeart size={16} /></span> JOURNAL ENTRY</span>
                    <div>
                      <button className="icon-button" aria-label="Edit entry" title="Edit entry" onClick={startEdit}><Pencil size={17} /></button>
                      <button className="icon-button danger-hover" aria-label="Delete entry" title="Delete entry" onClick={deleteSelected}><Trash2 size={17} /></button>
                    </div>
                  </div>
                  <time>{formatDate(selected.created_at)}</time>
                  <h2>{selected.title || 'Untitled entry'}</h2>
                  {selected.summary && <p className="entry-summary">{selected.summary}</p>}
                  <div className="reading-text">{selected.text}</div>
                  {(selected.tags?.length > 0 || selected.mood) && (
                    <div className="metadata-block">
                      <span className="metadata-label"><Tag size={14} /> NOTES</span>
                      <div className="metadata-tags">
                        {selected.mood && <span className="mood-tag">{selected.mood}</span>}
                        {selected.tags?.map((tag) => <span className="topic-tag" key={tag}>{tag}</span>)}
                      </div>
                    </div>
                  )}
                  {selected.audio_path && getAudioUrl(selected.audio_path) && (
                    <audio className="audio-player" controls preload="none" src={getAudioUrl(selected.audio_path)}>
                      Audio playback is not supported by this browser.
                    </audio>
                  )}
                  {followUp && <div className="follow-up"><Sparkles size={16} /><span>{followUp}</span></div>}
                </article>
              ) : (
                <div className="detail-empty">
                  <div className="empty-art"><BookHeart size={29} strokeWidth={1.4} /></div>
                  <p className="eyebrow">YOUR OWN PRIVATE SPACE</p>
                  <h2>{entries.length ? 'Choose an entry' : 'Begin anywhere.'}</h2>
                  <p>{entries.length ? 'Select an entry from your journal to read it here.' : 'A sentence, a small detail, a thought you want to keep.'}</p>
                  {!entries.length && <button className="button-primary" onClick={startNewEntry}><Plus size={16} /> Write your first entry</button>}
                </div>
              )}
            </section>
          </div>
        )}

        {view === 'connections' && <Connections graph={graph} onOpenEntry={openSource} />}

        {view === 'ask' && (
          <section className="ask-layout">
            <div className="ask-intro">
              <span className="ask-icon"><Sparkles size={20} /></span>
              <p className="eyebrow">GROUNDED IN YOUR OWN WORDS</p>
              <h2>What would you like to remember?</h2>
              <p>Ask about a person, a feeling, or a thread across your entries.</p>
              {!health?.ok && <span className="ai-note">Local AI models are unavailable. Start Ollama to ask questions.</span>}
            </div>
            {answer && (
              <article className="answer-panel" aria-live="polite">
                <div className="answer-label"><Sparkles size={15} /> JOURNAL RESPONSE</div>
                <p className="answer-text">{answer.answer}</p>
                {answer.sources?.length > 0 && (
                  <div className="source-list">
                    <span className="source-heading">FROM YOUR JOURNAL</span>
                    {answer.sources.map((source) => (
                      <button className="source-row" key={source.id} onClick={() => openSource(source)}>
                        <span><strong>{source.title || 'Untitled entry'}</strong><small>{source.date} · {source.snippet}</small></span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                )}
              </article>
            )}
            <form className="question-form" onSubmit={askJournal}>
              <textarea aria-label="Question for your journal" placeholder="What have I been looking forward to?" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} />
              <div><span>Answers are based only on your journal.</span><button className="button-primary" disabled={asking || !question.trim()}>{asking ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} Ask</button></div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

function Connections({ graph, onOpenEntry }) {
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const entryNodes = graph.nodes.filter((node) => node.type === 'entry');
  const topicNodes = graph.nodes.filter((node) => node.type !== 'entry').sort((a, b) => (b.count || 0) - (a.count || 0));

  return (
    <section className="connections-view">
      <div className="connections-summary">
        <div><span>ENTRIES MAPPED</span><strong>{entryNodes.length}</strong></div>
        <div><span>SHARED THEMES</span><strong>{topicNodes.length}</strong></div>
        <div><span>LINKS FOUND</span><strong>{graph.edges.length}</strong></div>
      </div>
      {!entryNodes.length ? (
        <div className="connections-empty"><Share2 size={24} /><h2>Connections will grow with your journal.</h2><p>Related topics, people, and entries appear here as you write.</p></div>
      ) : (
        <div className="connections-grid">
          <section>
            <div className="section-kicker">REPEATED THEMES</div>
            <div className="topic-list">
              {topicNodes.map((node) => (
                <div className="topic-row" key={node.id}>
                  <span className={node.type === 'tag' ? 'topic-dot tag-dot' : 'topic-dot entity-dot'} />
                  <span>{node.label}</span><small>{node.count} {node.count === 1 ? 'entry' : 'entries'}</small>
                </div>
              ))}
              {!topicNodes.length && <p className="muted-note">No shared topics yet.</p>}
            </div>
          </section>
          <section>
            <div className="section-kicker">YOUR ENTRIES</div>
            <div className="mapped-entries">
              {entryNodes.map((node) => {
                const connected = graph.edges
                  .filter((edge) => edge.source === node.id || edge.target === node.id)
                  .map((edge) => labels.get(edge.source === node.id ? edge.target : edge.source))
                  .filter(Boolean);
                return (
                  <button className="mapped-entry" key={node.id} onClick={() => onOpenEntry({ id: Number(node.id.slice(1)) })}>
                    <span className="mapped-entry-icon"><BookHeart size={17} /></span>
                    <span><strong>{node.label}</strong><small>{connected.length ? connected.slice(0, 4).join(' · ') : 'No connections yet'}</small></span>
                    <ChevronRight size={17} />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);