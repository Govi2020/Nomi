import { Bookmark, ChevronRight, Feather, Sparkles } from 'lucide-react'
import type { DiaryEntry, Memory, Page } from '../../types'
import CalendarSection from '../../components/CalendarSection'

export function HomePage({ now, diary, onNavigate, onNewEntry, memories, onOpenMemory, onOpenDiary }: { now: Date; diary: DiaryEntry[]; onNavigate: (page: Page) => void; onNewEntry: () => void; memories: Memory[]; onOpenMemory: (memory: Memory) => void; onOpenDiary: (entry: DiaryEntry) => void }) {
  const recent = memories[0]
  const recentEntry = diary[0]
  const todayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)
  return <div className="home-page">
    <header className="home-dashboard-heading"><div><span className="home-dashboard-date">{todayLabel}</span><h1>Today</h1><p>A little space to notice what matters.</p></div><button className="home-ask-button" aria-label="Ask Memory" onClick={() => onNavigate('Ask AI')}><Sparkles size={18} /></button></header>
    <section className="home-capture-card"><div className="home-capture-copy"><span className="eyebrow">A MOMENT FOR YOURSELF</span><h2>What would you like to remember?</h2><p>Start with a few words, or tell the story out loud.</p></div><div className="home-capture-actions"><button className="home-write-button" onClick={onNewEntry}><Feather size={17} /><span>Write an entry</span><ChevronRight size={16} /></button></div></section>
    <CalendarSection now={now} diary={diary} />
    <section className="home-recent-section"><div className="home-section-heading"><div><span className="eyebrow">A PLACE TO PICK UP</span><h2>Recently remembered</h2></div><button onClick={() => onNavigate('Diary')}>Your diary <ChevronRight size={14} /></button></div><div className="home-recent-grid">{recentEntry && <button className="home-entry-card" onClick={() => onOpenDiary(recentEntry)}><span className="home-recent-type"><Feather size={14} /> DIARY ENTRY</span><b>{recentEntry.title || 'Untitled entry'}</b><p>{recentEntry.content || 'A moment you captured.'}</p><span className="home-recent-date">{recentEntry.date}</span></button>}{recent && <button className="home-memory-card" onClick={() => onOpenMemory(recent)}><span className="home-recent-type"><Bookmark size={14} /> MEMORY</span><p>“{recent.content}”</p><span className="home-recent-date">{recent.date}</span></button>}{!recentEntry && !recent && <div className="home-empty-note">Your saved moments will appear here.</div>}</div></section>
  </div>
}
