import { useState } from 'react'
import { ChevronRight, Download, LockKeyhole, Moon, Sun, Trash2 } from 'lucide-react'
import type { DiaryEntry, Page } from '../../types'
import { PageHeading } from '../../components/PageHeading'
import { energyOptions, moodOptions, type UserPreferences } from '../../services/userPreferences'

type Props = {
  page: Page
  theme: 'dark' | 'light'
  onThemeChange: (theme: 'dark' | 'light') => void
  preferences: UserPreferences
  onPreferenceChange: (changes: Partial<UserPreferences>) => void
  diaryCount: number
  onExportDiary: () => Promise<DiaryEntry[]>
  onDeleteDiary: () => Promise<number>
}

export function SupportPage({ page, theme, onThemeChange, preferences, onPreferenceChange, diaryCount, onExportDiary, onDeleteDiary }: Props) {
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const content: Record<string, { eyebrow: string; title: string; subtitle: string; rows: string[] }> = {
    People: { eyebrow: 'THE PEOPLE IN YOUR STORY', title: 'People', subtitle: 'The names that show up in your memories.', rows: ['Arun · 8 moments together', 'Rahul · 5 moments together', 'Maya · 3 moments together'] },
    Projects: { eyebrow: 'WHAT HAS YOUR ATTENTION', title: 'Projects', subtitle: 'Ideas and work you’ve been giving your time to.', rows: ['Memory · 7 memories', 'College · 5 memories', 'Personal · 3 memories'] },
    Tasks: { eyebrow: 'SMALL STEPS, HELD LIGHTLY', title: 'Tasks', subtitle: 'Things you meant to come back to.', rows: ['Finish the diary view · Today', 'Try the recording flow · Today', 'Ask Arun about the time capsule idea · Tomorrow'] },
    Settings: { eyebrow: 'YOUR SPACE, YOUR CHOICES', title: 'Settings', subtitle: 'Set up your writing space, voice, and saved data.', rows: [] },
  }
  const data = content[page]

  const exportDiary = async () => {
    setExporting(true)
    setError('')
    setMessage('')
    try {
      const entries = await onExportDiary()
      const file = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), entries }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = `memory-diary-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`Exported ${entries.length} ${entries.length === 1 ? 'diary entry' : 'diary entries'}.`)
    } catch (reason) {
      setError(reason instanceof Error ? `Could not export your diary: ${reason.message}` : 'Could not export your diary.')
    } finally {
      setExporting(false)
    }
  }

  const deleteDiary = async () => {
    setDeleting(true)
    setError('')
    setMessage('')
    try {
      const deletedCount = await onDeleteDiary()
      setMessage(`Deleted ${deletedCount} ${deletedCount === 1 ? 'diary entry' : 'diary entries'}. Ask AI conversation history was kept.`)
      setConfirmDelete(false)
      setConfirmation('')
    } catch (reason) {
      setError(reason instanceof Error ? `Could not delete diary entries: ${reason.message}` : 'Could not delete diary entries.')
    } finally {
      setDeleting(false)
    }
  }

  return <section className="page-content">
    <PageHeading eyebrow={data.eyebrow} title={data.title} subtitle={data.subtitle} />
    {page !== 'Settings' && <div className="support-list">{data.rows.map((row, i) => <div className="support-row" key={row}><span className="support-index">0{i + 1}</span><span>{row}</span><ChevronRight size={15} /></div>)}</div>}
    {page === 'Settings' && <>
      <section className="settings-section" aria-labelledby="settings-appearance">
        <div className="settings-section-heading"><h2 id="settings-appearance">Appearance</h2><p>Saved in this browser on this device.</p></div>
        <div className="settings-control-row">
          <span>Color theme</span>
          <div className="theme-toggle" role="group" aria-label="Color theme">
            <button className={theme === 'light' ? 'selected' : ''} aria-pressed={theme === 'light'} onClick={() => onThemeChange('light')}><Sun size={15} />Light</button>
            <button className={theme === 'dark' ? 'selected' : ''} aria-pressed={theme === 'dark'} onClick={() => onThemeChange('dark')}><Moon size={15} />Dark</button>
          </div>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="settings-writing">
        <div className="settings-section-heading"><h2 id="settings-writing">Writing preferences</h2><p>Starting points for new entries; you can change them any time.</p></div>
        <div className="settings-fields">
          <label>Default feeling<select value={preferences.defaultMood} onChange={event => onPreferenceChange({ defaultMood: event.target.value })}>{moodOptions.map(option => <option key={option}>{option}</option>)}</select></label>
          <label>Default energy<select value={preferences.defaultEnergy} onChange={event => onPreferenceChange({ defaultEnergy: event.target.value })}>{energyOptions.map(option => <option key={option}>{option}</option>)}</select></label>
          <label>Editor text size<select value={preferences.editorTextSize} onChange={event => onPreferenceChange({ editorTextSize: Number(event.target.value) })}><option value={15}>Compact</option><option value={16}>Standard</option><option value={18}>Large</option></select></label>
        </div>
        <label className="settings-check"><input type="checkbox" checked={preferences.spellCheck} onChange={event => onPreferenceChange({ spellCheck: event.target.checked })} /><span><b>Spell check while writing</b><small>Use your browser’s spelling suggestions in the diary editor.</small></span></label>
      </section>
      <section className="settings-section" aria-labelledby="settings-voice">
        <div className="settings-section-heading"><h2 id="settings-voice">Voice and dictation</h2><p>Talk replies use the warmest available English voice on this device. Dictation is processed locally.</p></div>
        <label className="settings-check"><input type="checkbox" checked={preferences.voiceReplies} onChange={event => onPreferenceChange({ voiceReplies: event.target.checked })} /><span><b>Speak replies in Talk to Me</b><small>Voice replies can also be muted directly from the Talk to Me page.</small></span></label>
        <div className="settings-control-row settings-rate-row"><label htmlFor="speech-rate">Speaking pace</label><select id="speech-rate" value={preferences.speechRate} onChange={event => onPreferenceChange({ speechRate: Number(event.target.value) })}><option value={0.85}>Slower</option><option value={0.94}>Natural</option><option value={1.05}>Faster</option></select></div>
      </section>
      <section className="settings-section settings-data" aria-labelledby="settings-data">
        <div className="settings-section-heading"><h2 id="settings-data">Your diary data</h2><p>{diaryCount} {diaryCount === 1 ? 'entry' : 'entries'} saved. Export a copy or remove all diary entries from this journal. Ask AI chat history is kept.</p></div>
        <div className="settings-data-actions">
          <button className="settings-secondary-action" onClick={() => void exportDiary()} disabled={exporting}><Download size={16} />{exporting ? 'Preparing export…' : 'Export diary as JSON'}</button>
          {!confirmDelete && <button className="settings-danger-action" onClick={() => { setConfirmDelete(true); setError(''); setMessage('') }} disabled={!diaryCount}><Trash2 size={16} />Delete all diary entries</button>}
        </div>
        {confirmDelete && <div className="settings-delete-confirm" role="group" aria-label="Confirm diary deletion">
          <p>This permanently deletes all {diaryCount} diary entries and their derived diary data. Ask AI conversation history will remain. Type <b>DELETE</b> to confirm.</p>
          <label htmlFor="delete-confirmation">Confirmation</label>
          <input id="delete-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" />
          <div><button className="settings-secondary-action" onClick={() => { setConfirmDelete(false); setConfirmation('') }} disabled={deleting}>Keep my diary</button><button className="settings-danger-action" onClick={() => void deleteDiary()} disabled={deleting || confirmation !== 'DELETE'}>{deleting ? 'Deleting…' : 'Permanently delete'}</button></div>
        </div>}
        {message && <p className="settings-feedback" role="status">{message}</p>}
        {error && <p className="settings-feedback is-error" role="alert">{error}</p>}
      </section>
      <div className="privacy-note-large"><LockKeyhole size={17} /><p>Whisper Tiny downloads once, then dictation runs on this device. Manage microphone access in your browser’s site settings.</p></div>
    </>}
  </section>
}
