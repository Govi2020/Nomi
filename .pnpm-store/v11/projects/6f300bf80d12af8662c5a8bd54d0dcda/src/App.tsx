import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArtificialIntelligence, AudioLines, CalendarDays, Check, HelpCircle as CircleHelp, Compass, Feather, FolderKanban, Home, LockKeyhole, Menu, Settings as Settings2, Users } from './components/icons'
import { gsap } from 'gsap'
import type { DiaryEntry, Memory, Page } from './types'
import { memoryService } from './services/memoryService'
import { aiService } from './services/aiService'
import type { AskChat, AskMode, AskTurn } from './services/aiService'
import { AskPage } from './features/ask/AskPage'
import { DiaryPage } from './features/diary/DiaryPage'
import { HomePage } from './features/home/HomePage'
import { InsightsPage } from './features/insights/InsightsPage'
import { MemoryDetail } from './features/memories/MemoryDetail'
import { TimelinePage } from './features/timeline/TimelinePage'
import { SupportPage } from './features/support/SupportPage'
import { TalkToMePage } from './features/talk/TalkToMePage'
import { NavButton } from './components/navigation/NavButton'
import { loadUserPreferences, type UserPreferences } from './services/userPreferences'
import { colorThemes, getColorTheme, type ThemeId } from './theme'

const primary: { label: Page; icon: typeof Home }[] = [
  { label: 'Home', icon: Home }, { label: 'Diary', icon: Feather }, { label: 'Talk to Me', icon: AudioLines }, { label: 'Ask AI', icon: ArtificialIntelligence }, { label: 'Timeline', icon: CalendarDays }, { label: 'Insights', icon: Compass },
]
const secondary: { label: Page; icon: typeof Home }[] = [{ label: 'People', icon: Users }, { label: 'Projects', icon: FolderKanban }, { label: 'Tasks', icon: Check }]

export default function App() {
  const [page, setPage] = useState<Page>('Home')
  const [memories, setMemories] = useState<Memory[]>([])
  const [diary, setDiary] = useState<DiaryEntry[]>([])
  const [diaryLoadError, setDiaryLoadError] = useState('')
  const [diaryLoading, setDiaryLoading] = useState(true)
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null)
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null)
  const [theme, setTheme] = useState<ThemeId>(() => {
    const savedTheme = window.localStorage.getItem('memory-theme')
    return colorThemes.some(option => option.id === savedTheme) ? savedTheme as ThemeId : 'dark'
  })
  const [preferences, setPreferences] = useState<UserPreferences>(loadUserPreferences)
  const [query, setQuery] = useState('')
  const [askTurns, setAskTurns] = useState<AskTurn[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('memory-ask-history') ?? '[]') as AskTurn[] } catch { return [] }
  })
  const [askChats, setAskChats] = useState<AskChat[]>([])
  const [selectedAskChatId, setSelectedAskChatId] = useState<string | null>(null)
  const [askChatsLoading, setAskChatsLoading] = useState(true)
  const [askChatError, setAskChatError] = useState('')
  const askChatRequestRef = useRef(0)
  const [asking, setAsking] = useState(false)
  const [mode, setMode] = useState<AskMode>('Recall')
  const [contextOpen, setContextOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const mainAreaRef = useRef<HTMLElement>(null)
  const sidebarPointerInside = useRef(false)
  const [now, setNow] = useState(() => new Date())

  useLayoutEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 761px)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timeline: gsap.core.Timeline | undefined
    const animate = (expanded: boolean) => {
      if (!desktopMedia.matches) return
      timeline?.kill()
      const duration = reducedMotion.matches ? 0.01 : 0.24
      const sidebar = sidebarRef.current
      const main = mainAreaRef.current
      if (!sidebar || !main) return
      const navButtons = sidebar.querySelectorAll<HTMLElement>('.nav-button')
      const navLabels = sidebar.querySelectorAll<HTMLElement>('.nav-button-label, .nav-count')
      const brand = sidebar.querySelector<HTMLElement>('.brand')
      const brandLabel = sidebar.querySelector<HTMLElement>('.brand-name')
      const divider = sidebar.querySelector<HTMLElement>('.nav-group-separator')
      timeline = gsap.timeline({ defaults: { ease: 'power3.out', overwrite: 'auto' } })
      timeline.to(sidebar, { width: expanded ? 220 : 76, paddingLeft: expanded ? 14 : 12, paddingRight: expanded ? 14 : 12, boxShadow: expanded ? '10px 0 24px #090b0838' : '0 0 0 rgba(0,0,0,0)', duration }, 0)
        .to(main, { marginLeft: expanded ? 220 : 76, duration }, 0)
        .to(navButtons, { width: expanded ? '100%' : 48, justifyContent: expanded ? 'flex-start' : 'center', gap: expanded ? 11 : 0, paddingLeft: expanded ? 10 : 0, paddingRight: expanded ? 10 : 0, fontSize: expanded ? 12 : 0, duration, stagger: 0.012 }, 0)
        .to(navLabels, { autoAlpha: expanded ? 1 : 0, x: expanded ? 0 : -5, duration: duration * 0.72, stagger: expanded ? 0.018 : 0 }, expanded ? 0.055 : 0)
      if (brand) timeline.to(brand, { width: expanded ? 112 : 48, justifyContent: expanded ? 'flex-start' : 'center', paddingLeft: expanded ? 4 : 0, paddingRight: expanded ? 4 : 0, duration }, 0)
      if (brandLabel) timeline.to(brandLabel, { autoAlpha: expanded ? 1 : 0, x: expanded ? 0 : -5, duration: duration * 0.72 }, expanded ? 0.04 : 0)
      if (divider) timeline.to(divider, { width: expanded ? '100%' : 34, duration }, 0)
    }
    const onBreakpointChange = (event: MediaQueryListEvent) => {
      timeline?.kill()
      if (event.matches) animate(sidebarExpanded)
      else {
        const sidebar = sidebarRef.current
        const main = mainAreaRef.current
        if (sidebar && main) gsap.set([sidebar, main, ...sidebar.querySelectorAll<HTMLElement>('*')], { clearProps: 'all' })
      }
    }
    animate(sidebarExpanded)
    desktopMedia.addEventListener('change', onBreakpointChange)
    return () => {
      timeline?.kill()
      desktopMedia.removeEventListener('change', onBreakpointChange)
    }
  }, [sidebarExpanded])

  useEffect(() => {
    memoryService.getMemories().then(setMemories)
    memoryService.getDiary().then(entries => {
      setDiary(entries)
      setDiaryLoadError('')
    }).catch(error => {
      setDiaryLoadError(error instanceof Error ? error.message : 'Could not load diary entries. Check the backend connection and try again.')
    }).finally(() => setDiaryLoading(false))
  }, [])
  useEffect(() => {
    let mounted = true
    void aiService.getChats().then(async chats => {
      if (!mounted) return
      setAskChats(chats)
      if (chats.length) {
        const requestId = ++askChatRequestRef.current
        setSelectedAskChatId(chats[0].id)
        try {
          const conversation = await aiService.getConversation(chats[0].id)
          if (!mounted || requestId !== askChatRequestRef.current) return
          setAskTurns(conversation.turns.map(({ question, answer, mode: turnMode, sources }) => ({
            question,
            answer,
            mode: turnMode,
            sources: sources.map(source => ({ kind: 'Diary entry', date: source.date, id: String(source.id) })),
          })))
          setMode(conversation.turns.at(-1)?.mode ?? 'Recall')
          setAskChatError('')
          setAskChatsLoading(false)
        } catch (error) {
          if (!mounted) return
          setAskChatError(error instanceof Error ? error.message : 'Could not load this conversation.')
          setAskChatsLoading(false)
        }
      } else {
        try {
          const chat = await aiService.createChat(askTurns)
          if (!mounted) return
          setAskChats([chat])
          setSelectedAskChatId(chat.id)
          if (askTurns.length) {
            const conversation = await aiService.getConversation(chat.id)
            if (!mounted) return
            setAskTurns(conversation.turns.map(({ question, answer, mode: turnMode, sources }) => ({
              question,
              answer,
              mode: turnMode,
              sources: sources.map(source => ({ kind: 'Diary entry', date: source.date, id: String(source.id) })),
            })))
            setMode(conversation.turns.at(-1)?.mode ?? 'Recall')
          } else {
            setAskTurns([])
          }
          setAskChatError('')
        } catch (error) {
          if (mounted) setAskChatError(error instanceof Error ? error.message : 'Could not start a conversation.')
        } finally {
          if (mounted) setAskChatsLoading(false)
        }
      }
    }).catch(error => {
      if (mounted) {
        setAskChatError(error instanceof Error ? error.message : 'Could not load your conversations.')
        setAskChatsLoading(false)
      }
    })
    return () => {
      mounted = false
      askChatRequestRef.current += 1
    }
  }, [])
  useEffect(() => { window.localStorage.setItem('memory-ask-history', JSON.stringify(askTurns)) }, [askTurns])
  useEffect(() => {
    const root = document.documentElement
    const selectedTheme = getColorTheme(theme)
    root.dataset.theme = selectedTheme.mode
    const customTheme = selectedTheme.id !== 'light' && selectedTheme.id !== 'dark'
    if (customTheme) root.dataset.palette = selectedTheme.id
    else delete root.dataset.palette
    for (const option of colorThemes) {
      for (const token of Object.keys(option.tokens)) root.style.removeProperty(token)
    }
    if (customTheme) {
      for (const [token, value] of Object.entries(selectedTheme.tokens)) root.style.setProperty(token, value)
    }
    window.localStorage.setItem('memory-theme', theme)
  }, [theme])
  useEffect(() => {
    window.localStorage.setItem('memory-preferences', JSON.stringify(preferences))
  }, [preferences])
  const updatePreferences = (changes: Partial<UserPreferences>) => {
    setPreferences(current => ({ ...current, ...changes }))
  }
  const saveDiaryEntry = async (entry: DiaryEntry) => {
    const saved = await memoryService.saveDiaryEntry(entry)
    setDiary(current => current.some(item => item.id === saved.id) ? current.map(item => item.id === saved.id ? saved : item) : [saved, ...current])
    setDiaryLoadError('')
    return saved
  }
  const exportDiary = () => memoryService.getAllDiaryEntries()
  const deleteDiary = async () => {
    const result = await memoryService.deleteAllDiaryEntries()
    setDiary([])
    setSelectedDiary(null)
    setDiaryLoadError('')
    return result.deleted_count
  }
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id) }, [])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(''), 2500); return () => window.clearTimeout(id) }, [toast])
  const navigate = (next: Page) => { setPage(next); setSelectedMemory(null); setSelectedDiary(null); setMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const selectAskChat = async (chatId: string) => {
    if (asking || chatId === selectedAskChatId) return
    const requestId = ++askChatRequestRef.current
    setAskChatsLoading(true)
    setAskChatError('')
    setSelectedAskChatId(chatId)
    setAskTurns([])
    try {
      const conversation = await aiService.getConversation(chatId)
      if (requestId !== askChatRequestRef.current) return
      setAskTurns(conversation.turns.map(({ question, answer, mode: turnMode, sources }) => ({
        question,
        answer,
        mode: turnMode,
        sources: sources.map(source => ({ kind: 'Diary entry', date: source.date, id: String(source.id) })),
      })))
      setMode(conversation.turns.at(-1)?.mode ?? 'Recall')
    } catch (error) {
      if (requestId === askChatRequestRef.current) setAskChatError(error instanceof Error ? error.message : 'Could not load this conversation.')
    } finally {
      if (requestId === askChatRequestRef.current) setAskChatsLoading(false)
    }
  }
  const createAskChat = async () => {
    if (asking) return
    const requestId = ++askChatRequestRef.current
    setAskChatsLoading(true)
    setAskChatError('')
    try {
      const chat = await aiService.createChat()
      if (requestId !== askChatRequestRef.current) return
      setAskChats(current => [chat, ...current])
      setSelectedAskChatId(chat.id)
      setAskTurns([])
      setMode('Recall')
    } catch (error) {
      if (requestId === askChatRequestRef.current) setAskChatError(error instanceof Error ? error.message : 'Could not start a new conversation.')
    } finally {
      if (requestId === askChatRequestRef.current) setAskChatsLoading(false)
    }
  }
  const ask = async (value = query) => {
    if (asking) return
    const question = value.trim()
    if (!question) { setToast('Add a question to begin.'); return }
    if (!selectedAskChatId || askChatsLoading) {
      setAskChatError('Wait for your conversation to finish loading, then try again.')
      return
    }
    setQuery('')
    setAsking(true)
    setAskChatError('')
    const history = askTurns.filter(turn => !turn.error)
    const pending: AskTurn = { question, answer: '', mode, sources: [] }
    const chatId = selectedAskChatId
    setAskTurns(current => [...current, pending])
    try {
      const result = await aiService.ask(question, mode, history, chatId)
      setAskTurns(current => current.map((turn, index) => index === current.length - 1 ? { ...turn, answer: result.answer, sources: result.sources } : turn))
      try {
        setAskChats(await aiService.getChats())
      } catch (error) {
        setAskChatError(error instanceof Error ? error.message : 'The answer was saved, but the chat list could not refresh.')
      }
    } catch {
      setAskTurns(current => current.map((turn, index) => index === current.length - 1 ? { ...turn, error: true } : turn))
      setAskChatError('Could not save this answer. Check the backend connection and try again.')
    } finally { setAsking(false) }
  }
  const openInsightEntry = async (id: string) => {
    try {
      const entry = await memoryService.getDiaryEntry(id)
      setSelectedDiary(entry)
      setSelectedMemory(null)
      setPage('Diary')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setToast(error instanceof Error ? `Could not open that diary entry: ${error.message}` : 'Could not open that diary entry.')
    }
  }

  return <div className="app-shell">
    <aside ref={sidebarRef} className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`} onPointerEnter={() => { sidebarPointerInside.current = true; setSidebarExpanded(true) }} onPointerLeave={() => { sidebarPointerInside.current = false; if (!mobileNav) setSidebarExpanded(false) }} onFocusCapture={() => setSidebarExpanded(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSidebarExpanded(sidebarPointerInside.current) }}>
      <button className="brand" onClick={() => navigate('Home')}><span className="brand-symbol"><i /><i /><i /></span><span className="brand-name">Nomi</span></button>
      <nav className="nav-group" aria-label="Primary navigation">{primary.map(item => <NavButton key={item.label} item={item} active={page === item.label} onClick={() => navigate(item.label)} />)}</nav>
      <div className="nav-group-separator" aria-hidden="true" />
      <nav className="nav-group secondary-nav" aria-label="Your life">{secondary.map(item => <NavButton key={item.label} item={item} active={page === item.label} onClick={() => navigate(item.label)} />)}</nav>
      <div className="sidebar-bottom"><button className={`nav-button ${page === 'Settings' ? 'active' : ''}`} onClick={() => navigate('Settings')} aria-label="Settings" aria-current={page === 'Settings' ? 'page' : undefined} title="Settings"><Settings2 size={17} /><span className="nav-button-label">Settings</span></button></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main ref={mainAreaRef} className="main-area"><header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><span className="crumb-dot" /><span>{page === 'Home' ? 'A quieter way to remember' : page}</span></div><div className="topbar-right"><span className="date-today">{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(now).toUpperCase()}</span><button className="help-button" aria-label="About Memory" onClick={() => setToast('Memory helps you capture moments and find them again.')}><CircleHelp size={17} /></button></div></header>
      {page === 'Home' && <HomePage now={now} diary={diary} onNavigate={navigate} onNewEntry={() => { const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()); navigate('Diary'); setSelectedDiary({ id: 'new', date, title: '', content: '', mood: preferences.defaultMood, energy: preferences.defaultEnergy, topics: [], people: [], memoryIds: [] }) }} memories={memories} onOpenMemory={setSelectedMemory} onOpenDiary={entry => { navigate('Diary'); setSelectedDiary(entry) }} />}
      {page === 'Diary' && <DiaryPage diary={diary} selected={selectedDiary} onSelect={setSelectedDiary} onSave={saveDiaryEntry} loadError={diaryLoadError} defaultMood={preferences.defaultMood} defaultEnergy={preferences.defaultEnergy} spellCheck={preferences.spellCheck} editorTextSize={preferences.editorTextSize} />}
      {page === 'Talk to Me' && <TalkToMePage voiceReplies={preferences.voiceReplies} speechRate={preferences.speechRate} onVoiceRepliesChange={voiceReplies => updatePreferences({ voiceReplies })} />}
      {page === 'Ask AI' && <AskPage query={query} setQuery={setQuery} onAsk={ask} turns={askTurns} chats={askChats} selectedChatId={selectedAskChatId} chatsLoading={askChatsLoading} chatError={askChatError} onSelectChat={selectAskChat} onNewChat={createAskChat} asking={asking} mode={mode} setMode={setMode} contextOpen={contextOpen} setContextOpen={setContextOpen} onOpenSource={source => { if (source.kind === 'Memory') { const found = memories.find(item => item.id === source.id); if (found) setSelectedMemory(found) } else if (source.kind === 'Diary entry') { setSelectedDiary(diary.find(entry => entry.id === source.id) ?? diary[0]); setPage('Diary') } else setPage('Timeline') }} />}
      {page === 'Timeline' && <TimelinePage entries={diary} loading={diaryLoading} loadError={diaryLoadError} onOpenEntry={id => { const entry = diary.find(item => item.id === id); if (entry) { setSelectedDiary(entry); setPage('Diary') } }} />}
      {page === 'Insights' && <InsightsPage diary={diary} onOpenEntry={openInsightEntry} />}
      {['People', 'Projects', 'Tasks', 'Settings'].includes(page) && <SupportPage page={page} theme={theme} onThemeChange={setTheme} preferences={preferences} onPreferenceChange={updatePreferences} diaryCount={diary.length} onExportDiary={exportDiary} onDeleteDiary={deleteDiary} />}
      {selectedMemory && <MemoryDetail memory={selectedMemory} onClose={() => setSelectedMemory(null)} onDiary={() => { setSelectedDiary(diary[0]); setPage('Diary'); setSelectedMemory(null) }} />}
      <footer className="app-footer"><span>Memory is a place to return to yourself.</span><span><LockKeyhole size={12} /> Your moments stay yours</span></footer>
    </main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}
