import { useEffect, useState } from 'react'
import { Check, ChevronRight, Download, LockKeyhole, Printer, RefreshCw, Trash as Trash2, Cancel as X } from '../../components/icons'
import type { DiaryEntry, Page } from '../../types'
import { PageHeading } from '../../components/PageHeading'
import { energyOptions, moodOptions, type UserPreferences } from '../../services/userPreferences'
import { clinicalReportService, type ClinicalReport } from '../../services/clinicalReportService'
import { apiClient } from '../../services/apiClient'
import { colorThemes, type ThemeId } from '../../theme'

type SupportPerson = {
  name: string
  moment_count: number
  last_seen: string | null
  top_tags: string[]
  recent_title: string | null
}

type SupportTask = {
  id: string
  title: string
  due: string
  status: 'open' | 'done'
  summary: string
  source_date: string
}

type Props = {
  page: Page
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
  preferences: UserPreferences
  onPreferenceChange: (changes: Partial<UserPreferences>) => void
  diaryCount: number
  onExportDiary: () => Promise<DiaryEntry[]>
  onDeleteDiary: () => Promise<number>
}

const formatShortDate = (value: string | null) => {
  if (!value) return 'recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date)
}

export function SupportPage({ page, theme, onThemeChange, preferences, onPreferenceChange, diaryCount, onExportDiary, onDeleteDiary }: Props) {
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<ClinicalReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [people, setPeople] = useState<SupportPerson[]>([])
  const [tasks, setTasks] = useState<SupportTask[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')

  useEffect(() => {
    if (page !== 'People' && page !== 'Tasks') return

    let active = true
    setListLoading(true)
    setListError('')

    const endpoint = page === 'People' ? '/api/people' : '/api/tasks'
    void apiClient.get<SupportPerson[] | SupportTask[]>(endpoint)
      .then((payload) => {
        if (!active) return
        if (page === 'People') setPeople(payload as SupportPerson[])
        else setTasks(payload as SupportTask[])
      })
      .catch((reason) => {
        if (!active) return
        setListError(reason instanceof Error ? reason.message : 'Could not load this list from the backend.')
      })
      .finally(() => {
        if (active) setListLoading(false)
      })

    return () => { active = false }
  }, [page])

  const content: Record<string, { eyebrow: string; title: string; subtitle: string; rows: string[] }> = {
    People: { eyebrow: 'THE PEOPLE IN YOUR STORY', title: 'People', subtitle: 'The names that keep resurfacing in your memories.', rows: [] },
    Tasks: { eyebrow: 'SMALL STEPS, HELD LIGHTLY', title: 'Tasks', subtitle: 'Things you were going to come back to and the ones that still matter.', rows: [] },
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

  const generateReport = async () => {
    setReportLoading(true)
    setReportError('')
    setReport(null)
    try {
      setReport(await clinicalReportService.getReport())
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : 'Could not prepare the diary discussion report.')
    } finally {
      setReportLoading(false)
    }
  }

  const reportRange = report?.first_entry_date
    ? `${report.first_entry_date} to ${report.last_entry_date}`
    : 'No dated diary entries'
  const countSummary = (counts: Record<string, number>) => Object.entries(counts)
    .map(([label, count]) => `${label}: ${count}`)
    .join(' · ')

  const renderPeopleRows = () => {
    if (listLoading) return <div className="support-list"><div className="support-row"><span className="support-index">..</span><span>Loading the people who keep showing up…</span></div></div>
    if (listError) return <div className="support-list"><div className="support-row"><span className="support-index">!</span><span>{listError}</span></div></div>
    if (!people.length) return <div className="support-list"><div className="support-row"><span className="support-index">0</span><span>No people have been identified yet. Add more diary entries and they’ll appear here automatically.</span></div></div>

    return <div className="support-list support-card-list">
      {people.map((person, index) => <div className="support-row support-card" key={person.name}>
        <span className="support-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="support-card-body">
          <div className="support-card-head"><strong>{person.name}</strong><span>{person.moment_count} {person.moment_count === 1 ? 'moment' : 'moments'}</span></div>
          <p>{person.recent_title ? `Most recent: ${person.recent_title}` : 'This person has shown up in a recent entry.'}</p>
          <div className="support-tag-row">{person.top_tags.length ? person.top_tags.slice(0, 3).map(tag => <span key={`${person.name}-${tag}`} className="support-tag">{tag}</span>) : <span className="support-tag">story</span>}</div>
        </div>
        <div className="support-card-meta"><small>Last seen</small><b>{formatShortDate(person.last_seen)}</b></div>
        <ChevronRight size={15} />
      </div>)}
    </div>
  }

  const renderTaskRows = () => {
    if (listLoading) return <div className="support-list"><div className="support-row"><span className="support-index">..</span><span>Checking your recent notes for follow-up tasks…</span></div></div>
    if (listError) return <div className="support-list"><div className="support-row"><span className="support-index">!</span><span>{listError}</span></div></div>
    if (!tasks.length) return <div className="support-list"><div className="support-row"><span className="support-index">0</span><span>No active tasks surfaced from your journal yet. A few more entries will make this a much better guide.</span></div></div>

    return <div className="support-list support-card-list">
      {tasks.map((task, index) => <div className="support-row support-card" key={task.id}>
        <span className="support-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="support-card-body">
          <div className="support-card-head"><strong>{task.title}</strong><span className={`task-badge ${task.status}`}>{task.status === 'done' ? 'Done' : 'Open'}</span></div>
          <p>{task.summary}</p>
          <div className="support-tag-row"><span className="support-tag">{task.due}</span><span className="support-tag">{formatShortDate(task.source_date)}</span></div>
        </div>
        <div className="support-card-meta"><small>Next</small><b>{task.due}</b></div>
        <ChevronRight size={15} />
      </div>)}
    </div>
  }

  return <section className="page-content">
    <PageHeading eyebrow={data.eyebrow} title={data.title} subtitle={data.subtitle} />
    {page === 'People' && renderPeopleRows()}
    {page === 'Tasks' && renderTaskRows()}
    {page !== 'Settings' && page !== 'People' && page !== 'Tasks' && <div className="support-list">{data.rows.map((row, i) => <div className="support-row" key={row}><span className="support-index">0{i + 1}</span><span>{row}</span><ChevronRight size={15} /></div>)}</div>}
    {page === 'Settings' && <>
      <section className="settings-section" aria-labelledby="settings-appearance">
        <div className="settings-section-heading"><h2 id="settings-appearance">Appearance</h2><p>Choose a palette for your writing space. Your choice is saved in this browser.</p></div>
        <fieldset className="theme-picker" aria-label="Color theme">
          <legend>Color theme</legend>
          <div className="theme-choice-grid">
            {colorThemes.map(option => <label className={`theme-choice${theme === option.id ? ' selected' : ''}`} key={option.id}>
              <input type="radio" name="color-theme" value={option.id} checked={theme === option.id} onChange={() => onThemeChange(option.id)} />
              <span className="theme-choice-swatches" aria-hidden="true">{option.swatches.map((color, index) => <i key={`${option.id}-${index}`} style={{ backgroundColor: color }} />)}</span>
              <span className="theme-choice-details"><b>{option.name}</b><small>{option.description}</small></span>
              <span className="theme-choice-check" aria-hidden="true"><Check size={13} /></span>
            </label>)}
          </div>
        </fieldset>
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
        <div className="settings-section-heading"><h2 id="settings-voice">Voice and dictation</h2><p>Talk replies use the Kokoro American English voice in your browser. Diary dictation runs locally; Talk speech input is processed by your configured backend.</p></div>
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
      <section className="settings-section settings-report" aria-labelledby="settings-report-heading">
        <div className="settings-section-heading">
          <h2 id="settings-report-heading">Diary discussion report</h2>
          <p>Create a private, evidence-linked summary of recurring journal observations to bring to a clinician. It is not a diagnosis or clinical assessment.</p>
        </div>
        <button className="settings-secondary-action" onClick={() => void generateReport()} disabled={reportLoading || diaryCount === 0}>
          <RefreshCw size={15} className={reportLoading ? 'is-spinning' : ''} />
          {reportLoading ? 'Reviewing diary patterns…' : report ? 'Regenerate report' : 'Generate report'}
        </button>
        {reportError && <p className="settings-feedback is-error" role="alert">Could not prepare the report: {reportError}</p>}
        {report && <>
          <div className="report-actions"><p role="status">Report is ready to review. Nothing is saved or shared by the report feature.</p><button className="settings-secondary-action" onClick={() => window.print()}><Printer size={15} />Print / Save as PDF</button><button className="report-close" onClick={() => setReport(null)} aria-label="Close report preview"><X size={16} /></button></div>
          <article className="clinician-report-print">
            <header className="report-title">
              <p>MEMORY · PERSONAL DIARY SUMMARY</p>
              <h1>Diary patterns for clinical discussion</h1>
              <p>Prepared {report.generated_at} · Journal period: {reportRange}</p>
            </header>
            <div className="report-caution"><b>Context and limitations</b><p>This is a descriptive summary of self-selected diary writing, not a diagnosis, validated psychological test, or clinical opinion. Patterns may reflect what was written down rather than a person’s overall life. Counts are descriptive, not severity measures. Use the source entries and the person’s own account to add context or correct these observations.</p></div>
            <section className="report-section">
              <h2>Coverage</h2>
              <p>{report.analyzed_entry_count} text entries reviewed out of {report.entry_count} saved diary entries, spanning {reportRange}. Entries were written on {report.writing_days} distinct dates.</p>
              {report.analysis_sample_count < report.analyzed_entry_count && <p>The descriptive counts below cover all text entries. The qualitative observations were generated from a chronological sample of {report.analysis_sample_count} entries spanning the available period.</p>}
            </section>
            <section className="report-section">
              <h2>Journal metadata (descriptive only)</h2>
              <dl className="report-metrics">
                <div><dt>Recorded mood labels</dt><dd>{countSummary(report.mood_counts) || 'No mood labels recorded'}</dd></div>
                <div><dt>Recorded energy labels</dt><dd>{countSummary(report.energy_counts) || 'No energy labels recorded'}</dd></div>
                <div><dt>Frequently tagged topics</dt><dd>{report.top_tags.length ? report.top_tags.map(item => `${item.tag} (${item.count})`).join(' · ') : 'No recurring tags recorded'}</dd></div>
                <div><dt>Diary-writing days by weekday</dt><dd>{countSummary(report.writing_days_by_weekday) || 'Not available'}</dd></div>
              </dl>
              <p className="report-small-note">Mood, energy, and topic labels may be automatically organized from entry text; they are not standardized measures.</p>
            </section>
            <section className="report-section">
              <h2>Repeated behaviour and self-described preferences</h2>
              {!report.observations.length
                ? <p>There were not enough repeated, evidence-linked observations to summarize. This does not imply anything about the person; the journal may be brief or cover varied topics.</p>
                : report.observations.map((observation, index) => <article className="report-observation" key={`${observation.title}-${index}`}>
                  <h3>{observation.title}</h3>
                  <p>{observation.description}</p>
                  <ul>{observation.sources.map(source => <li key={source.id}><b>[E{source.id}] {source.date} · {source.title}</b><span>{source.excerpt}</span></li>)}</ul>
                </article>)}
            </section>
            <section className="report-section">
              <h2>Questions the person may wish to explore</h2>
              <ul className="report-prompts">
                <li>Which observations feel representative, and which need more context?</li>
                <li>What was happening in daily life around the dates shown in the cited entries?</li>
                <li>Are there other sources of evidence to compare with the diary record?</li>
              </ul>
            </section>
          </article>
        </>}
      </section>
    </>}
  </section>
}
