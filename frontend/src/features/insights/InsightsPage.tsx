import { useEffect, useState } from 'react'
import { ChevronRight, Sparkles } from 'lucide-react'
import { PageHeading } from '../../components/PageHeading'
import { insightsService, type JournalInsights } from '../../services/insightsService'
import type { InsightSource } from '../../services/insightsService'

export function InsightsPage({ onOpenEntry }: { onOpenEntry: (id: string) => void }) {
  const [result, setResult] = useState<JournalInsights | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void insightsService.getJournalInsights().then(data => {
      if (active) {
        setResult(data)
        setError('')
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load insights from your diary.')
    })
    return () => { active = false }
  }, [])

  const openSource = (source: InsightSource) => onOpenEntry(source.id)

  return <section className="page-content">
    <PageHeading
      eyebrow="GENTLE CONNECTIONS OVER TIME"
      title="What your days are telling you."
      subtitle="Not conclusions. Just small patterns grounded in your own entries."
    />
    <div className="insight-intro">
      <div className="insight-illustration"><span /><i /><i /><i /><b>✳</b></div>
      <div><span className="eyebrow">A REFLECTION, NOT A RULE</span><p>Patterns to explore, with the moments that brought them into view.</p></div>
    </div>
    {error && <div className="insight-message insight-error" role="alert">Could not distill insights from your diary: {error}</div>}
    {!result && !error && <div className="insight-message" role="status"><Sparkles size={17} /> Looking for patterns across your entries…</div>}
    {result && !error && result.entry_count < 3 && <div className="insight-message">
      {result.entry_count === 0
        ? 'Your diary is empty. Add a few entries and your insights will grow from them.'
        : `${result.entry_count} ${result.entry_count === 1 ? 'entry' : 'entries'} found. Add at least 3 diary entries to look for patterns.`}
    </div>}
    {result && !error && result.entry_count >= 3 && !result.insights.length && <div className="insight-message">
      There are {result.entry_count} entries in your diary, but no clear recurring patterns surfaced yet. More entries may reveal a thread.
    </div>}
    {!!result?.insights.length && <div className="insight-list">
      {result.insights.map((insight, index) => <article className="insight-item" key={`${insight.title}-${index}`}>
        <span className="insight-number">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <small>A THREAD · {insight.period.toUpperCase()}</small>
          <h2>{insight.title}</h2>
          <p>{insight.summary}</p>
          <div className="insight-tags" aria-label="Diary entries used as evidence">
            {insight.sources.map(source => <button key={source.id} onClick={() => openSource(source)} title={`Open: ${source.title}`}>
              {source.date} · {source.title}
            </button>)}
          </div>
        </div>
        <ChevronRight size={16} aria-hidden="true" />
      </article>)}
    </div>}
    <p className="insight-footnote">Patterns are invitations to reflect, not conclusions about you. Each one is grounded in the linked diary entries.</p>
  </section>
}
