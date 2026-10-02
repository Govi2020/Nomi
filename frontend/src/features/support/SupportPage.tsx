import { useState } from 'react'
import { ChevronRight, Download, LockKeyhole, Moon, Printer, RefreshCw, Sun, Trash2, X } from 'lucide-react'
import type { DiaryEntry, Page } from '../../types'
import { PageHeading } from '../../components/PageHeading'
import { energyOptions, moodOptions, type UserPreferences } from '../../services/userPreferences'
import { clinicalReportService, type ClinicalReport } from '../../services/clinicalReportService'

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
  const [report, setReport] = useState<ClinicalReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
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
                <li>Are there important experiences or strengths that this journal does not capture?</li>
              </ul>
            </section>
            <footer className="report-footer">Generated from the person’s saved diary at their request. Interpretations are tentative and should be checked with the person; the report does not provide a diagnosis or treatment recommendation.</footer>
          </article>
        </>}
      </section>
      <div className="privacy-note-large"><LockKeyhole size={17} /><p>Diary dictation uses Whisper Tiny locally. Talk audio is sent to the configured backend for Parakeet TDT transcription; the model downloads from Hugging Face there on first use. Manage microphone access in your browser’s site settings.</p></div>
    </>}
  </section>
}
