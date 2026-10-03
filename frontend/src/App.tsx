import { useEffect, useRef, useState } from 'react'
import { AudioLines, CalendarDays, Check, CircleHelp, Compass, Feather, FolderKanban, Home, LockKeyhole, Menu, MoreHorizontal, Settings2, Sparkles, Users } from 'lucide-react'
import type { DiaryEntry, Memory, Page, TimelineEvent } from './types'
import { memoryService } from './services/memoryService'
import { aiService } from './services/aiService'
import { AskPage } from './features/ask/AskPage'
import { DiaryPage } from './features/diary/DiaryPage'
import { HomePage } from './features/home/HomePage'
import { InsightsPage } from './features/insights/InsightsPage'
import { MemoryDetail } from './features/memories/MemoryDetail'
import { TimelinePage } from './features/timeline/TimelinePage'
import { SupportPage } from './features/support/SupportPage'
import { TalkToMePage } from './features/talk/TalkToMePage'
import { NavButton } from './components/navigation/NavButton'

const primary: { label: Page; icon: typeof Home }[] = [
  { label: 'Home', icon: Home }, { label: 'Diary', icon: Feather }, { label: 'Talk to Me', icon: AudioLines }, { label: 'Ask AI', icon: Sparkles }, { label: 'Timeline', icon: CalendarDays }, { label: 'Insights', icon: Compass },
]
const secondary: { label: Page; icon: typeof Home }[] = [{ label: 'People', icon: Users }, { label: 'Projects', icon: FolderKanban }, { label: 'Tasks', icon: Check }]

export default function App() {
  const [page, setPage] = useState<Page>('Home')
  const [memories, setMemories] = useState<Memory[]>([])
  const [diary, setDiary] = useState<DiaryEntry[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null)
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => window.localStorage.getItem('memory-theme') === 'light' ? 'light' : 'dark')
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<{ kind: string; date: string; id: string }[]>([])
  const [asking, setAsking] = useState(false)
  const [mode, setMode] = useState('Recall')
  const [contextOpen, setContextOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [queryError, setQueryError] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    memoryService.getMemories().then(setMemories)
    memoryService.getDiary().then(setDiary)
    memoryService.getTimeline().then(setTimeline)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('memory-theme', theme)
  }, [theme])
  const saveDiaryEntry = (entry: DiaryEntry) => setDiary(current => current.some(item => item.id === entry.id) ? current.map(item => item.id === entry.id ? entry : item) : [entry, ...current])
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id) }, [])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(''), 2500); return () => window.clearTimeout(id) }, [toast])
  const navigate = (next: Page) => { setPage(next); setSelectedMemory(null); setSelectedDiary(null); setMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const ask = async (value = query) => { if (!value.trim()) { setToast('Add a question to begin.'); return } setQuery(value); setAnswer(''); setAsking(true); setQueryError(false); try { const result = await aiService.ask(value); setAnswer(result.answer); setSources(result.sources) } catch { setQueryError(true) } finally { setAsking(false) } }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <button className="brand" onClick={() => navigate('Home')}><span className="brand-symbol"><i /><i /><i /></span><span>memory</span></button>
      <div className="nav-label">YOUR SPACE</div>
      <nav className="nav-group" aria-label="Primary navigation">{primary.map(item => <NavButton key={item.label} item={item} active={page === item.label} onClick={() => navigate(item.label)} />)}</nav>
      <div className="nav-label secondary-label">YOUR LIFE</div>
      <nav className="nav-group secondary-nav" aria-label="Your life">{secondary.map(item => <NavButton key={item.label} item={item} active={page === item.label} onClick={() => navigate(item.label)} />)}</nav>
      <div className="sidebar-bottom"><button className={`nav-button ${page === 'Settings' ? 'active' : ''}`} onClick={() => navigate('Settings')}><Settings2 size={17} /><span>Settings</span></button><div className="privacy-mini"><div className="privacy-icon"><LockKeyhole size={15} /></div><div><b>Your space, your pace</b><small>Private by design</small></div></div><button className="profile-button" onClick={() => navigate('Settings')}><span className="avatar">A</span><span className="profile-copy"><b>Alex Morgan</b><small>Personal space</small></span><MoreHorizontal size={18} className="profile-more" /></button></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><span className="crumb-dot" /><span>{page === 'Home' ? 'A quieter way to remember' : page}</span></div><div className="topbar-right"><span className="date-today">{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(now).toUpperCase()}</span><button className="help-button" aria-label="About Memory" onClick={() => setToast('Memory helps you capture moments and find them again.')}><CircleHelp size={17} /></button></div></header>
      {page === 'Home' && <HomePage now={now} diary={diary} onNavigate={navigate} onNewEntry={() => { const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()); navigate('Diary'); setSelectedDiary({ id: 'new', date, title: '', content: '', mood: 'Thoughtful', energy: 'Steady', topics: [], people: [], memoryIds: [] }) }} memories={memories} onOpenMemory={setSelectedMemory} onOpenDiary={entry => { navigate('Diary'); setSelectedDiary(entry) }} />}
      {page === 'Diary' && <DiaryPage diary={diary} selected={selectedDiary} onSelect={setSelectedDiary} onSave={saveDiaryEntry} />}
      {page === 'Talk to Me' && <TalkToMePage />}
      {page === 'Ask AI' && <AskPage query={query} setQuery={setQuery} onAsk={ask} answer={answer} sources={sources} asking={asking} mode={mode} setMode={setMode} contextOpen={contextOpen} setContextOpen={setContextOpen} onOpenSource={source => { if (source.kind === 'Memory') { const found = memories.find(item => item.id === source.id); if (found) setSelectedMemory(found) } else if (source.kind === 'Diary entry') { setSelectedDiary(diary.find(entry => entry.id === source.id) ?? diary[0]); setPage('Diary') } else setPage('Timeline') }} error={queryError} />}
      {page === 'Timeline' && <TimelinePage events={timeline} />}
      {page === 'Insights' && <InsightsPage />}
      {['People', 'Projects', 'Tasks', 'Settings'].includes(page) && <SupportPage page={page} theme={theme} onThemeChange={setTheme} />}
      {selectedMemory && <MemoryDetail memory={selectedMemory} onClose={() => setSelectedMemory(null)} onDiary={() => { setSelectedDiary(diary[0]); setPage('Diary'); setSelectedMemory(null) }} />}
      <footer className="app-footer"><span>Memory is a place to return to yourself.</span><span><LockKeyhole size={12} /> Your moments stay yours</span></footer>
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}
