import { ChevronRight, LockKeyhole, Moon, Sun } from 'lucide-react'
import type { Page } from '../../types'
import { PageHeading } from '../../components/PageHeading'

export function SupportPage({ page, theme, onThemeChange }: { page: Page; theme: 'dark' | 'light'; onThemeChange: (theme: 'dark' | 'light') => void }) {
  const content: Record<string, { eyebrow: string; title: string; subtitle: string; rows: string[] }> = {
    People: { eyebrow: 'THE PEOPLE IN YOUR STORY', title: 'People', subtitle: 'The names that show up in your memories.', rows: ['Arun · 8 moments together', 'Rahul · 5 moments together', 'Maya · 3 moments together'] },
    Projects: { eyebrow: 'WHAT HAS YOUR ATTENTION', title: 'Projects', subtitle: 'Ideas and work you’ve been giving your time to.', rows: ['Memory · 7 memories', 'College · 5 memories', 'Personal · 3 memories'] },
    Tasks: { eyebrow: 'SMALL STEPS, HELD LIGHTLY', title: 'Tasks', subtitle: 'Things you meant to come back to.', rows: ['Finish the diary view · Today', 'Try the recording flow · Today', 'Ask Arun about the time capsule idea · Tomorrow'] },
    Settings: { eyebrow: 'YOUR SPACE, YOUR CHOICES', title: 'Settings', subtitle: 'Choose how your journal looks and how dictation works.', rows: [] },
  }
  const data = content[page]
  return <section className="page-content"><PageHeading eyebrow={data.eyebrow} title={data.title} subtitle={data.subtitle} />{page !== 'Settings' && <div className="support-list">{data.rows.map((row, i) => <div className="support-row" key={row}><span className="support-index">0{i + 1}</span><span>{row}</span><ChevronRight size={15} /></div>)}</div>}{page === 'Settings' && <><div className="theme-setting"><div><b>Appearance</b><small>Saved in this browser on this device.</small></div><div className="theme-toggle" role="group" aria-label="Color theme"><button className={theme === 'light' ? 'selected' : ''} aria-pressed={theme === 'light'} onClick={() => onThemeChange('light')}><Sun size={15} />Light</button><button className={theme === 'dark' ? 'selected' : ''} aria-pressed={theme === 'dark'} onClick={() => onThemeChange('dark')}><Moon size={15} />Dark</button></div></div><div className="privacy-note-large"><LockKeyhole size={17} /><p>Whisper Tiny downloads once, then dictation runs on this device. Manage microphone access in your browser’s site settings.</p></div></>}</section>
}
