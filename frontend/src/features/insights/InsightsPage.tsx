import { useEffect, useMemo, useState } from 'react'
import { ArtificialIntelligence, Cancel, ChevronRight, Download } from '../../components/icons'
import { PageHeading } from '../../components/PageHeading'
import { insightsService, type JournalInsights } from '../../services/insightsService'
import type { InsightSource } from '../../services/insightsService'
import { clinicalReportService, type ClinicalReport, type ClinicalReportObservation, type ClinicalReportSource } from '../../services/clinicalReportService'
import { downloadClinicalReportPdf } from '../../services/pdfExportService'
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

function dailyAverage(scores: (number | null | undefined)[]) {
  const values = scores.filter((score): score is number => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10)
  return values.length ? values.reduce((sum, score) => sum + score, 0) / values.length : null
}

function createPreviewEntries(): DiaryEntry[] {
  const samples = [
    ['Calm', 'Steady', 'A quieter start', ['Rest', 'Morning routine'], 7],
    ['Thoughtful', 'Low', 'A lot to carry today', ['Work', 'Balance'], 5],
    ['Hopeful', 'High', 'One small win', ['Work', 'Progress'], 8],
    ['Calm', 'Steady', 'Room to breathe', ['Rest', 'Walk'], 7],
    ['Grateful', 'High', 'Dinner with friends', ['Friends', 'Connection'], 9],
    ['Thoughtful', 'Steady', 'Finding my rhythm', ['Work', 'Balance'], 6],
    ['Happy', 'High', 'A day that flowed', ['Friends', 'Progress'], 9],
    ['Anxious', 'Low', 'Before the deadline', ['Work', 'Balance'], 3],
    ['Calm', 'Steady', 'A slow Sunday', ['Rest', 'Walk'], 7],
    ['Grateful', 'Steady', 'Help from a friend', ['Friends', 'Connection'], 8],
  ] as const
  return samples.map(([mood, energy, title, topics, moodScore], index) => {
    const date = new Date()
    date.setDate(date.getDate() - [0, 1, 2, 4, 6, 9, 13, 16, 20, 24][index])
    date.setHours(12, 0, 0, 0)
    return { id: `preview-${index}`, createdAt: date.toISOString(), date: new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date), title, content: '', mood, moodScore, energy, topics: [...topics], people: [], memoryIds: [] }
  })
}

export function InsightsPage({ diary, onOpenEntry }: { diary: DiaryEntry[]; onOpenEntry: (id: string) => void }) {
  const [result, setResult] = useState<JournalInsights | null>(null)
  const [error, setError] = useState('')
  const [expandedRecap, setExpandedRecap] = useState<string | null>(null)
  const [report, setReport] = useState<ClinicalReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const preparePdf = async () => {
    setReportLoading(true)
    setReportError('')
    try {
      setReport(await clinicalReportService.getReport())
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : 'Could not prepare the journal report.')
    } finally {
      setReportLoading(false)
    }
  }

  const savePdf = () => {
    if (!report) return
    try {
      downloadClinicalReportPdf(report)
      setReportError('')
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : 'Could not create the PDF file.')
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
    return { date, entries: dayEntries, score: dailyAverage(dayEntries.map(entry => entry.moodScore)) }
  })
  const scoredWeekEntries = weekEntries.filter(entry => entry.moodScore != null && Number.isFinite(entry.moodScore) && entry.moodScore >= 0 && entry.moodScore <= 10)
  const chartPoint = (index: number, score: number) => ({ x: 48 + index * 104, y: 211 - score * 16 })
  const reportSources = (sources: ClinicalReportSource[]) => <div className="insight-report-sources">{sources.map(source => <button key={source.id} type="button" onClick={() => onOpenEntry(source.id)}>[E{source.id}] {source.date} · {source.title}</button>)}</div>
  const reportObservations = (title: string, items: ClinicalReportObservation[], empty: string) => <section className="report-section" key={title}>
    <h2>{title}</h2>
    {!items.length ? <p>{empty}</p> : items.map((item, index) => <article className="report-observation" key={`${item.title}-${index}`}><h3>{item.title}</h3><p>{item.description}</p><ul>{item.sources.map(source => <li key={source.id}><b>[E{source.id}] {source.date} · {source.title}</b><span>{source.excerpt}</span></li>)}</ul></article>)}
  </section>

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

  return <section className="page-content">
    <PageHeading eyebrow="GENTLE CONNECTIONS OVER TIME" title="What your days are telling you." subtitle="Not conclusions. Just small patterns grounded in your own entries." action={<button className="settings-secondary-action" onClick={() => void preparePdf()} disabled={reportLoading || diary.length === 0}><Download size={15} />{reportLoading ? 'Preparing report…' : 'Export to PDF'}</button>} />
    <div className="insight-intro"><div className="insight-illustration"><span /><i /><i /><i /><b>✳</b></div><div><span className="eyebrow">A REFLECTION, NOT A RULE</span><p>Patterns to explore, with the moments that brought them into view.</p></div></div>

    <section className="insight-section mood-chart-card" aria-labelledby="mood-chart-title">
      <div className="insight-section-heading"><div><span className="eyebrow">YOUR LAST 7 DAYS</span><h2 id="mood-chart-title">Mood, day by day</h2></div><span className="insight-period">{periodLabel(weekStart, today)}</span></div>
      {usingPreview && <p className="insight-preview-note">Preview data · Sample entries are shown because your diary is empty. They are not saved.</p>}
      {chartDays.some(day => day.score != null) ? <>
        <div className="mood-mini-card">
          <div className="mood-mini-header"><div><strong>{scoredWeekEntries.length}</strong><span>{scoredWeekEntries.length === 1 ? 'mood score' : 'mood scores'} this week</span></div><span className="mood-score-range">Average per day · 0 to 10</span></div>
          <svg className="mood-score-chart" viewBox="0 0 720 250" role="img" aria-label={`Average mood score by day over the last seven days. ${chartDays.map(day => `${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(day.date)}: ${day.score == null ? 'no score' : day.score.toFixed(1)}`).join('; ')}`}>
            {[0, 2, 4, 6, 8, 10].map(score => <g key={score}><line x1="44" x2="700" y1={211 - score * 16} y2={211 - score * 16} /><text x="32" y={215 - score * 16}>{score}</text></g>)}
            {chartDays.map((day, index) => { const point = day.score == null ? null : chartPoint(index, day.score); return <g key={day.date.toISOString()}>{index > 0 && point && chartDays[index - 1].score != null && <line className="mood-score-segment" x1={chartPoint(index - 1, chartDays[index - 1].score!).x} y1={chartPoint(index - 1, chartDays[index - 1].score!).y} x2={point.x} y2={point.y} />}<text className="mood-score-day" x={48 + index * 104} y="239">{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day.date)}</text>{point && <g><title>{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' }).format(day.date)}: average {day.score!.toFixed(1)} from {day.entries.filter(entry => entry.moodScore != null).length} {day.entries.filter(entry => entry.moodScore != null).length === 1 ? 'entry' : 'entries'}</title><circle className="mood-score-point" cx={point.x} cy={point.y} r="5" /><text className="mood-score-value" x={point.x} y={point.y - 12}>{day.score!.toFixed(1)}</text></g>}</g>})}
          </svg>
        </div>
      </> : <p className="insight-empty-note">Add an optional 0–10 mood score to a diary entry to start your week in view.</p>}
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
      <div className="insight-section-heading"><div><span className="eyebrow">SYNTHESIZED FROM YOUR WRITING</span><h2 id="pattern-title">Behavior patterns</h2><p>Tentative interpretations drawn from more than one entry. Check each one against your experience.</p></div></div>
      {error && <div className="insight-message insight-error" role="alert">Could not interpret diary patterns: {error}</div>}
      {!result && !error && <div className="insight-message" role="status"><ArtificialIntelligence size={17} /> Looking across entries for recurring patterns…</div>}
      {result && !error && !!result.insights.length && <div className="insight-list">{result.insights.map((insight, index) => <article className="insight-item" key={`${insight.title}-${index}`}><span className="insight-number">{String(index + 1).padStart(2, '0')}</span><div><small>POSSIBLE PATTERN · {insight.period.toUpperCase()}</small><h2>{insight.title}</h2><p>{insight.summary}</p><div className="insight-tags" aria-label="Diary entries supporting this interpretation">{insight.sources.map(source => <button key={source.id} onClick={() => openSource(source)} title={`Review: ${source.title}`}>{source.date} · {source.title}</button>)}</div></div><ChevronRight size={16} aria-hidden="true" /></article>)}</div>}
      {result && !error && (!result.insights.length || result.entry_count < 3) && <p className="insight-empty-note">There isn’t enough repeated evidence in the available entries to suggest a behavior pattern. That does not mean a pattern is absent.</p>}
    </section>

    <section className="insight-section pattern-section" aria-labelledby="pattern-title-descriptive">
      <div className="insight-section-heading"><div><span className="eyebrow">DESCRIPTIVE COUNTS</span><h2 id="pattern-title-descriptive">Repeated diary details</h2><p>Counts of labels and topics only; these are not behavioral interpretations.</p></div></div>
      {patterns.length ? <div className="pattern-table-wrap"><table className="pattern-table"><thead><tr><th scope="col">Pattern</th><th scope="col">Frequency</th><th scope="col">Recent moments</th></tr></thead><tbody>{patterns.map(pattern => <tr key={`${pattern.type}-${pattern.value}`}><th scope="row"><span className={`pattern-type pattern-type-${pattern.type.toLowerCase()}`}>{pattern.type}</span><strong>{pattern.value}</strong></th><td><span className="pattern-count"><b>{pattern.count}</b><small>{pattern.count === 1 ? 'time' : 'times'}</small></span></td><td><div className="pattern-sources">{pattern.examples.map(entry => usingPreview ? <span className="pattern-source-label" key={entry.id}>{entry.title || entry.date}</span> : <button key={entry.id} onClick={() => onOpenEntry(entry.id)}>{entry.title || entry.date}<ChevronRight size={13} /></button>)}</div></td></tr>)}</tbody></table></div> : <p className="insight-empty-note">Recurring patterns will appear after a mood, topic, or energy level shows up in more than one entry.</p>}
    </section>

    <p className="insight-footnote">These are tentative interpretations of selected journal entries, not a diagnosis or complete account of you. Follow the citations, and correct anything that does not fit.</p>
    {reportError && <div className="insight-message insight-error" role="alert">Could not prepare the PDF report: {reportError}</div>}
    {report && <section className="insight-export-preview" aria-label="PDF report preview">
      <div className="report-actions"><p role="status">Review the report, then download its PDF. It stays on this device and is not shared.</p><button className="settings-secondary-action" onClick={savePdf}><Download size={15} />Download PDF</button><button className="report-close" onClick={() => setReport(null)} aria-label="Close report preview"><Cancel size={16} /></button></div>
      <article className="clinician-report-print">
        <header className="report-title"><p>NOMI · PERSONAL JOURNAL SUMMARY</p><h1>Journal overview for counseling</h1><p>Prepared {report.generated_at} · Journal period: {report.first_entry_date ?? '—'} to {report.last_entry_date ?? '—'}</p></header>
        <div className="report-caution"><b>Context and limitations</b><p>This is a descriptive summary of self-selected journal writing, not a diagnosis, validated psychological test, or clinical opinion. It may reflect what was recorded rather than a person’s full experience. Please check each observation with the person and add context or corrections.</p></div>
        <section className="report-section"><h2>Coverage and mood scores</h2><p>{report.analyzed_entry_count} text entries reviewed across {report.writing_days} writing days. {(report.mood_score_days ?? []).length ? `Daily scores average ${(((report.mood_score_days ?? []).reduce((sum, day) => sum + day.average_score, 0) / (report.mood_score_days ?? []).length)).toFixed(1)} / 10 across ${(report.mood_score_days ?? []).length} scored days.` : 'No numeric mood scores have been recorded yet.'}</p>{report.analysis_sample_count < report.analyzed_entry_count && <p className="report-small-note">Qualitative observations were generated from a chronological sample of {report.analysis_sample_count} entries; descriptive counts cover all text entries.</p>}<p className="report-small-note">Each day’s score is the average of all entries with a 0–10 rating that day. Unrated entries and days are omitted.</p>{!!report.mood_score_days?.length && <dl className="report-metrics">{report.mood_score_days.map(day => <div key={day.date}><dt>{day.date}</dt><dd>{day.average_score.toFixed(1)} / 10 · {day.entry_count} {day.entry_count === 1 ? 'entry' : 'entries'}</dd></div>)}</dl>}</section>
        {reportObservations('Self-described preferences and personal tendencies', report.personality_details ?? [], 'The available entries did not support a repeated, evidence-linked self-description. This is not evidence that such preferences are absent.')}
        {reportObservations('Behavior patterns and possible meaning', report.behavior_patterns ?? report.observations, 'There were not enough repeated, evidence-linked observations to summarize.')}
        {reportObservations('Changes across time', report.behavioral_shifts ?? [], 'The available entries did not support a clear, evidence-linked behavioral shift across time.')}
        <section className="report-section"><h2>Overall comment</h2><p>{report.overall_comment?.text ?? 'This report reflects a partial, self-selected diary record. Its observations can support discussion but do not establish a complete picture of the person.'}</p>{reportSources(report.overall_comment?.sources ?? [])}</section>
        <section className="report-section"><h2>Questions for discussion</h2><ul className="report-prompts"><li>Which observations feel representative, and which need more context?</li><li>What was happening around the dates shown in the cited entries?</li><li>Are there other experiences or sources of information to consider?</li></ul></section>
      </article>
    </section>}
  </section>
}
