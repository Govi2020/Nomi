import { useEffect, useMemo, useState } from 'react'
import { ArtificialIntelligence, ChevronRight, Printer, RefreshCw } from '../../components/icons'
import { PageHeading } from '../../components/PageHeading'
import { insightsService, type JournalInsights } from '../../services/insightsService'
import type { InsightSource } from '../../services/insightsService'
import { clinicalReportService, type ClinicalReport } from '../../services/clinicalReportService'
import type { DiaryEntry } from '../../types'

type DatedEntry = DiaryEntry & { timestamp: number }

function entryTimestamp(entry: DiaryEntry) {
  const value = entry.createdAt ? new Date(entry.createdAt).getTime() : new Date(entry.date).getTime()
  return Number.isFinite(value) ? value : 0
}

function countBy<T extends string>(values: T[]) {
  const counts = new Map<T, number>()
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts].sort((a, b) => b[1] - a[1])
}

function periodLabel(from: Date, to: Date) {
  return `${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(from)} – ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(to)}`
}

function moodBand(mood: string) {
  if (['Happy', 'Hopeful', 'Grateful'].includes(mood)) return 'lifted'
  if (['Frustrated', 'Anxious', 'Sad'].includes(mood)) return 'heavy'
  return 'steady'
}

function createPreviewEntries(): DiaryEntry[] {
  const samples = [
    ['Calm', 'Steady', 'A quieter start', ['Rest', 'Morning routine']],
    ['Thoughtful', 'Low', 'A lot to carry today', ['Work', 'Balance']],
    ['Hopeful', 'High', 'One small win', ['Work', 'Progress']],
    ['Calm', 'Steady', 'Room to breathe', ['Rest', 'Walk']],
    ['Grateful', 'High', 'Dinner with friends', ['Friends', 'Connection']],
    ['Thoughtful', 'Steady', 'Finding my rhythm', ['Work', 'Balance']],
    ['Happy', 'High', 'A day that flowed', ['Friends', 'Progress']],
    ['Anxious', 'Low', 'Before the deadline', ['Work', 'Balance']],
    ['Calm', 'Steady', 'A slow Sunday', ['Rest', 'Walk']],
    ['Grateful', 'Steady', 'Help from a friend', ['Friends', 'Connection']],
  ] as const
  return samples.map(([mood, energy, title, topics], index) => {
    const date = new Date()
    date.setDate(date.getDate() - [0, 1, 2, 4, 6, 9, 13, 16, 20, 24][index])
    date.setHours(12, 0, 0, 0)
    return { id: `preview-${index}`, createdAt: date.toISOString(), date: new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date), title, content: '', mood, energy, topics: [...topics], people: [], memoryIds: [] }
  })
}

export function InsightsPage({ diary, onOpenEntry }: { diary: DiaryEntry[]; onOpenEntry: (id: string) => void }) {
  const [result, setResult] = useState<JournalInsights | null>(null)
  const [error, setError] = useState('')
  const [expandedRecap, setExpandedRecap] = useState<string | null>(null)
  const [clinicalReport, setClinicalReport] = useState<ClinicalReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const generateClinicalReport = async () => {
    setReportLoading(true)
    setReportError('')
    setClinicalReport(null)
    try {
      setClinicalReport(await clinicalReportService.getReport())
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : 'Could not prepare the diary discussion report.')
    } finally {
      setReportLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void insightsService.getJournalInsights().then(data => {
      if (active) { setResult(data); setError('') }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load insights from your diary.')
    })
    return () => { active = false }
  }, [])

  const usingPreview = diary.length === 0
  const entries = useMemo<DatedEntry[]>(() => (usingPreview ? createPreviewEntries() : diary)
    .map(entry => ({ ...entry, timestamp: entryTimestamp(entry) }))
    .filter(entry => entry.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp), [diary, usingPreview])
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - 6)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekEntries = entries.filter(entry => entry.timestamp >= weekStart.getTime() && entry.timestamp < today.getTime() + 86400000)
  const monthEntries = entries.filter(entry => entry.timestamp >= monthStart.getTime() && entry.timestamp < today.getTime() + 86400000)

  const chartDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)
    const dayEntries = entries.filter(entry => {
      const d = new Date(entry.timestamp)
      return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate()
    })
    return { date, entries: dayEntries, mood: countBy(dayEntries.map(entry => entry.mood))[0]?.[0] ?? '' }
  })

  const patterns = useMemo(() => {
    const moods = countBy(entries.map(entry => entry.mood)).filter(([, count]) => count >= 2).slice(0, 3)
    const topics = countBy(entries.flatMap(entry => entry.topics ?? [])).filter(([, count]) => count >= 2).slice(0, 3)
    const energies = countBy(entries.map(entry => entry.energy)).filter(([, count]) => count >= 2).slice(0, 2)
    return [
      ...moods.map(([value, count]) => ({ type: 'Mood', value, count, examples: entries.filter(entry => entry.mood === value).slice(-2) })),
      ...topics.map(([value, count]) => ({ type: 'Topic', value, count, examples: entries.filter(entry => entry.topics?.includes(value)).slice(-2) })),
      ...energies.map(([value, count]) => ({ type: 'Energy', value, count, examples: entries.filter(entry => entry.energy === value).slice(-2) })),
    ].sort((a, b) => b.count - a.count).slice(0, 6)
  }, [entries])

  const openSource = (source: InsightSource) => onOpenEntry(source.id)
  const topMood = (periodEntries: DatedEntry[]) => countBy(periodEntries.map(entry => entry.mood))[0]
  const reportRange = clinicalReport?.first_entry_date
    ? `${clinicalReport.first_entry_date} to ${clinicalReport.last_entry_date}`
    : 'No dated diary entries'
  const countSummary = (counts: Record<string, number>) => Object.entries(counts)
    .map(([label, count]) => `${label}: ${count}`)
    .join(' · ')

  return <section className="page-content">
    <PageHeading eyebrow="GENTLE CONNECTIONS OVER TIME" title="What your days are telling you." subtitle="Not conclusions. Just small patterns grounded in your own entries." />
    <div className="insight-intro"><div className="insight-illustration"><span /><i /><i /><i /><b>✳</b></div><div><span className="eyebrow">A REFLECTION, NOT A RULE</span><p>Patterns to explore, with the moments that brought them into view.</p></div></div>

    <section className="insight-section mood-chart-card" aria-labelledby="mood-chart-title">
      <div className="insight-section-heading"><div><span className="eyebrow">YOUR LAST 7 DAYS</span><h2 id="mood-chart-title">Mood, day by day</h2></div><span className="insight-period">{periodLabel(weekStart, today)}</span></div>
      {usingPreview && <p className="insight-preview-note">Preview data · Sample entries are shown because your diary is empty. They are not saved.</p>}
      {chartDays.some(day => day.mood) ? <>
        <div className="mood-mini-card">
          <div className="mood-mini-header"><div><strong>{weekEntries.length}</strong><span>{weekEntries.length === 1 ? 'mood note' : 'mood notes'} this week</span></div><button onClick={() => document.getElementById('recap-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Weekly recap <ChevronRight size={13} /></button></div>
          <div className="mood-bars" role="img" aria-label={`Daily mood entries for the last seven days. ${chartDays.map(day => `${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(day.date)}: ${day.entries.length ? day.entries.map(entry => entry.mood).join(', ') : 'no entry'}`).join('; ')}`}>
            {chartDays.map(day => <div className="mood-bar-column" key={day.date.toISOString()} title={`${new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' }).format(day.date)}: ${day.entries.length ? day.entries.map(entry => entry.mood).join(', ') : 'No entries'}`}>
              <span className="mood-bar-count">{day.entries.length || ''}</span>
              <div className="mood-bar-track">{day.entries.length ? <div className="mood-bar" style={{ height: `${Math.min(18 + day.entries.length * 12, 78)}px` }}>{day.entries.slice(0, 5).map((entry, index) => <i className={`mood-bar-segment tone-${moodBand(entry.mood)}`} key={`${entry.id}-${index}`} />)}</div> : <span className="mood-bar-empty" />}</div>
              <b>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day.date)}</b>
            </div>)}
          </div>
          <div className="mood-readings"><span className="mood-readings-title">RECENT MOODS</span>{weekEntries.slice().sort((a, b) => a.timestamp - b.timestamp).slice(-2).reverse().map(entry => <div className="mood-reading" key={entry.id}><span>{new Intl.DateTimeFormat('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(entry.timestamp))}</span><b className={`tone-text-${moodBand(entry.mood)}`}>{entry.mood}</b></div>)}</div>
        </div>
      </> : <p className="insight-empty-note">Add a diary entry with a mood to start your week in view.</p>}
    </section>

    <section className="insight-section recap-section" aria-labelledby="recap-title">
      <div className="insight-section-heading"><div><span className="eyebrow">LOOKING BACK</span><h2 id="recap-title">Your recaps</h2></div></div>
      <div className="recap-grid">{[
        { title: 'This week', label: periodLabel(weekStart, today), data: weekEntries },
        { title: 'This month', label: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(now), data: monthEntries },
      ].map(recap => {
        const mood = topMood(recap.data)
        const topic = countBy(recap.data.flatMap(entry => entry.topics ?? []))[0]
        const expanded = expandedRecap === recap.title
        return <article className={`recap-card ${expanded ? 'is-expanded' : ''}`} key={recap.title}>
          <button className="recap-trigger" aria-expanded={expanded} aria-controls={`recap-details-${recap.title.replaceAll(' ', '-')}`} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setExpandedRecap(recap.title) }} onClick={event => setExpandedRecap(current => event.detail === 0 ? recap.title : current === recap.title ? null : recap.title)}>
            <span><span className="eyebrow">{recap.title.toUpperCase()}</span><small>{recap.label}</small></span>
            <span className="recap-summary">{recap.data.length} {recap.data.length === 1 ? 'entry' : 'entries'}</span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
          <div className="recap-reveal" id={`recap-details-${recap.title.replaceAll(' ', '-')}`} aria-hidden={!expanded}>
            <div className="recap-reveal-inner">{recap.data.length ? <><p>{mood ? `You most often noted feeling ${mood[0].toLowerCase()}${mood[1] > 1 ? ` (${mood[1]} times)` : ''}.` : 'No mood was recorded in these entries.'}</p><p>{topic ? `“${topic[0]}” came up ${topic[1]} ${topic[1] === 1 ? 'time' : 'times'}.` : 'No recurring topics yet.'}</p></> : <p>No entries in this period yet. Your next reflection will appear here.</p>}</div>
          </div>
        </article>
      })}</div>
    </section>

    <section className="insight-section pattern-section" aria-labelledby="pattern-title">
      <div className="insight-section-heading"><div><span className="eyebrow">REPEATED DETAILS</span><h2 id="pattern-title">Behavior patterns</h2><p>Recurring moods, topics, and energy levels from your entries.</p></div></div>
      {patterns.length ? <div className="pattern-table-wrap"><table className="pattern-table"><thead><tr><th scope="col">Pattern</th><th scope="col">Frequency</th><th scope="col">Recent moments</th></tr></thead><tbody>{patterns.map(pattern => <tr key={`${pattern.type}-${pattern.value}`}><th scope="row"><span className={`pattern-type pattern-type-${pattern.type.toLowerCase()}`}>{pattern.type}</span><strong>{pattern.value}</strong></th><td><span className="pattern-count"><b>{pattern.count}</b><small>{pattern.count === 1 ? 'time' : 'times'}</small></span></td><td><div className="pattern-sources">{pattern.examples.map(entry => usingPreview ? <span className="pattern-source-label" key={entry.id}>{entry.title || entry.date}</span> : <button key={entry.id} onClick={() => onOpenEntry(entry.id)}>{entry.title || entry.date}<ChevronRight size={13} /></button>)}</div></td></tr>)}</tbody></table></div> : <p className="insight-empty-note">Recurring patterns will appear after a mood, topic, or energy level shows up in more than one entry.</p>}
    </section>

    {error && <div className="insight-message insight-error" role="alert">Could not distill longer reflections from your diary: {error}</div>}
    {!result && !error && <div className="insight-message" role="status"><ArtificialIntelligence size={17} /> Looking for longer reflections across your entries…</div>}
    {result && !error && result.entry_count >= 3 && !!result.insights.length && <div className="insight-list">{result.insights.map((insight, index) => <article className="insight-item" key={`${insight.title}-${index}`}><span className="insight-number">{String(index + 1).padStart(2, '0')}</span><div><small>A THREAD · {insight.period.toUpperCase()}</small><h2>{insight.title}</h2><p>{insight.summary}</p><div className="insight-tags" aria-label="Diary entries used as evidence">{insight.sources.map(source => <button key={source.id} onClick={() => openSource(source)} title={`Open: ${source.title}`}>{source.date} · {source.title}</button>)}</div></div><ChevronRight size={16} aria-hidden="true" /></article>)}</div>}

    <section className="insight-section insight-clinical-report" aria-labelledby="clinical-report-title">
      <div className="insight-section-heading"><div><span className="eyebrow">FOR A CONVERSATION WITH A CLINICIAN</span><h2 id="clinical-report-title">A whole-person reflection brief</h2><p>A private, evidence-linked overview of journal patterns, self-described preferences, and recorded context.</p></div></div>
      <p className="clinical-report-limit">This describes what appears in the journal; it does not diagnose, screen for disorders, assign personality types, or measure severity. It cannot represent experiences that were not written down. Review each observation with the person.</p>
      <button className="settings-secondary-action" onClick={() => void generateClinicalReport()} disabled={reportLoading || diary.length === 0}>
        <RefreshCw size={15} className={reportLoading ? 'is-spinning' : ''} />
        {reportLoading ? 'Preparing report…' : clinicalReport ? 'Refresh report' : 'Prepare discussion report'}
      </button>
      {diary.length === 0 && <p className="insight-report-hint">Add diary entries before preparing a report. Preview examples on this page are never included.</p>}
      {reportError && <p className="settings-feedback is-error" role="alert">Could not prepare the report: {reportError}</p>}
      {clinicalReport && <>
        <div className="report-actions"><p role="status">Ready to review. The report is not saved or shared by this feature.</p><button className="settings-secondary-action" onClick={() => window.print()}><Printer size={15} />Print / Save as PDF</button></div>
        <article className="clinician-report-print">
          <header className="report-title"><p>NOMI · PERSONAL JOURNAL SUMMARY</p><h1>Diary patterns for clinical discussion</h1><p>Prepared {clinicalReport.generated_at} · Journal period: {reportRange}</p></header>
          <div className="report-caution"><b>Context and limitations</b><p>This is a descriptive summary of self-selected diary writing, not a diagnosis, validated psychological test, or clinical opinion. Counts are descriptive, not severity measures. Use the cited entries and the person’s own account to add context or correct these observations.</p></div>
          <section className="report-section"><h2>Coverage</h2><p>{clinicalReport.analyzed_entry_count} text entries reviewed out of {clinicalReport.entry_count} saved diary entries, spanning {reportRange}. Entries were written on {clinicalReport.writing_days} distinct dates.</p>{clinicalReport.analysis_sample_count < clinicalReport.analyzed_entry_count && <p>Descriptive counts cover all text entries. Qualitative observations use a chronological sample of {clinicalReport.analysis_sample_count} entries spanning the available period.</p>}</section>
          <section className="report-section"><h2>Recorded context</h2><dl className="report-metrics"><div><dt>Recorded mood labels</dt><dd>{countSummary(clinicalReport.mood_counts) || 'No mood labels recorded'}</dd></div><div><dt>Recorded energy labels</dt><dd>{countSummary(clinicalReport.energy_counts) || 'No energy labels recorded'}</dd></div><div><dt>Frequently tagged topics</dt><dd>{clinicalReport.top_tags.length ? clinicalReport.top_tags.map(item => `${item.tag} (${item.count})`).join(' · ') : 'No recurring tags recorded'}</dd></div><div><dt>Writing days by weekday</dt><dd>{countSummary(clinicalReport.writing_days_by_weekday) || 'Not available'}</dd></div></dl><p className="report-small-note">Labels and tags are not standardized clinical measures. Mood, energy, and topic labels may be organized from entry text.</p></section>
          <section className="report-section"><h2>Recurring behaviour and self-described preferences</h2>{!clinicalReport.observations.length ? <p>There were not enough repeated, evidence-linked observations to summarize. This does not imply anything about the person; the journal may be brief or cover varied topics.</p> : clinicalReport.observations.map((observation, index) => <article className="report-observation" key={`${observation.title}-${index}`}><h3>{observation.title}</h3><p>{observation.description}</p><ul>{observation.sources.map(source => <li key={source.id}><b>[E{source.id}] {source.date} · {source.title}</b><span>{source.excerpt}</span></li>)}</ul></article>)}</section>
          <section className="report-section"><h2>Questions to explore together</h2><ul className="report-prompts"><li>Which observations feel representative, and which need more context?</li><li>What was happening in daily life around the dates shown in the cited entries?</li><li>What important experiences, values, or strengths does this journal not capture?</li></ul></section>
          <footer className="report-footer">Generated from the person’s saved diary at their request. Interpretations are tentative and should be checked with the person. This report does not provide a diagnosis or treatment recommendation.</footer>
        </article>
      </>}
    </section>
    <p className="insight-footnote">These are simple diary counts and reflections, not conclusions about you. Follow any pattern back to the moments behind it.</p>
  </section>
}
