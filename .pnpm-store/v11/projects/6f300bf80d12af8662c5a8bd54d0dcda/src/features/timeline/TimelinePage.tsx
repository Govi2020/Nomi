import { ArtificialIntelligence, AudioLines, Bookmark, ChevronDown, ChevronRight, Clock as Clock3, Feather, Sparkles, Cancel as X } from '../../components/icons'
import { useEffect, useRef, useState } from 'react'
import type { DiaryEntry } from '../../types'
import { PageHeading } from '../../components/PageHeading'
import { timelineService, type ReviewPeriod, type TimelineReview } from '../../services/timelineService'

type DayGroup = { date: string; entries: DiaryEntry[] }

function groupByDay(entries: DiaryEntry[]): DayGroup[] {
  const groups = new Map<string, DiaryEntry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.date) ?? []
    group.push(entry)
    groups.set(entry.date, group)
  }
  return [...groups].map(([date, groupedEntries]) => ({ date, entries: groupedEntries }))
}

function monthLabel(date: string) {
  const match = date.match(/,\s+([A-Za-z]+)\s+\d+,\s+(\d{4})$/)
  return match ? `${match[1]} ${match[2]}`.toUpperCase() : date.toUpperCase()
}

function highlightScore(entry: DiaryEntry) {
  return Math.min(entry.content.trim().length, 1400)
    + (entry.title.trim() ? 80 : 0)
    + entry.topics.length * 45
    + entry.people.length * 35
    + (entry.mood && entry.mood !== 'Thoughtful' ? 20 : 0)
}

function excerpt(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 240 ? `${compact.slice(0, 237).trimEnd()}…` : compact
}

function timeLabel(createdAt?: string) {
  if (!createdAt) return 'DIARY'
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(createdAt))
}

function reviewDate() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

export function TimelinePage({
  entries,
  loading,
  loadError,
  onOpenEntry,
}: {
  entries: DiaryEntry[]
  loading: boolean
  loadError: string
  onOpenEntry: (id: string) => void
}) {
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)
  const [reviewPeriod, setReviewPeriod] = useState<ReviewPeriod | null>(null)
  const [review, setReview] = useState<TimelineReview | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const reviewRequest = useRef(0)
  const days = groupByDay(entries)

  useEffect(() => () => { reviewRequest.current += 1 }, [])

  const showReview = async (period: ReviewPeriod) => {
    if (reviewPeriod === period) {
      setReviewPeriod(null)
      setReview(null)
      setReviewError('')
      reviewRequest.current += 1
      setReviewLoading(false)
      return
    }
    const requestId = ++reviewRequest.current
    setReviewPeriod(period)
    setReview(null)
    setReviewError('')
    setReviewLoading(true)
    try {
      const result = await timelineService.getReview(period, reviewDate())
      if (requestId === reviewRequest.current) setReview(result)
    } catch (error) {
      if (requestId === reviewRequest.current) {
        setReviewError(error instanceof Error ? error.message : 'Could not prepare this diary review.')
      }
    } finally {
      if (requestId === reviewRequest.current) setReviewLoading(false)
    }
  }

  return <section className="page-content">
    <PageHeading
      eyebrow="A LIFE, IN MOMENTS"
      title="Timeline"
      subtitle="Your diary, gathered into days, with a little space to look back."
      action={<div className="timeline-review-actions">
        <button className="filter-button" onClick={() => void showReview('month')} aria-expanded={reviewPeriod === 'month'}>
          Month in review
        </button>
        <button className="filter-button" onClick={() => void showReview('year')} aria-expanded={reviewPeriod === 'year'}>
          Year in review
        </button>
      </div>}
    />

    {reviewPeriod && <section className="timeline-review" aria-label={`${reviewPeriod} in review`}>
      <div className="timeline-review-heading">
        <div>
          <span className="eyebrow">{reviewPeriod === 'month' ? 'A MONTH IN REVIEW' : 'A YEAR IN REVIEW'}</span>
          <h2>{review?.period_label ?? (reviewPeriod === 'month' ? 'This month' : 'This year')}</h2>
        </div>
        <button className="timeline-review-close" onClick={() => void showReview(reviewPeriod)} aria-label="Close review"><X size={16} /></button>
      </div>
      {reviewLoading && <p className="timeline-review-status" role="status"><ArtificialIntelligence size={15} /> Gathering the moments you saved…</p>}
      {reviewError && <p className="timeline-review-status timeline-review-error" role="alert">Could not prepare this review: {reviewError}</p>}
      {review && <>
        <p className="timeline-review-summary">{review.summary}</p>
        <p className="timeline-review-count">{review.entry_count} {review.entry_count === 1 ? 'entry' : 'entries'} in this period</p>
        {!!review.themes.length && <div className="timeline-review-themes" aria-label="Themes in this review">
          {review.themes.map(theme => <span key={theme}>{theme}</span>)}
        </div>}
        {!!review.highlights.length && <div className="timeline-review-highlights">
          <span className="section-caption">MOMENTS TO REMEMBER</span>
          {review.highlights.map(highlight => <button key={highlight.id} onClick={() => onOpenEntry(highlight.id)}>
            <span><b>{highlight.title}</b><small>{highlight.date} · {excerpt(highlight.summary)}</small></span>
            <ChevronRight size={15} />
          </button>)}
        </div>}
      </>}
    </section>}

    {loadError && <div className="timeline-empty timeline-error" role="alert">Could not load the timeline: {loadError}</div>}
    {loading && !loadError && <div className="timeline-empty" role="status">Loading your diary timeline…</div>}
    {!loading && !loadError && !days.length && <div className="timeline-empty">Your timeline will take shape as you add diary entries.</div>}
    {!loading && !loadError && !!days.length && <div className="timeline">
      {days.map((day, dayIndex) => {
        const highlight = day.entries.reduce((best, entry) => highlightScore(entry) > highlightScore(best) ? entry : best)
        const currentMonth = monthLabel(day.date)
        const previousMonth = dayIndex ? monthLabel(days[dayIndex - 1].date) : null
        return <div key={day.date}>
          {currentMonth !== previousMonth && <div className="timeline-month"><span>{currentMonth}</span><i /></div>}
          <div className="timeline-day-heading">
            <span>{day.date}</span>
            <small>{day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}</small>
          </div>
          {day.entries.map(entry => {
            const isOpen = openEntryId === entry.id
            const isHighlight = entry.id === highlight.id
            return <article className="timeline-item" key={entry.id}>
              <div className="timeline-rail"><span className={`timeline-dot${isHighlight ? ' current' : ''}`} /><i /></div>
              <div className={`timeline-card${isHighlight ? ' is-highlight' : ''}`}>
                <button className="timeline-event" onClick={() => setOpenEntryId(isOpen ? null : entry.id)} aria-expanded={isOpen}>
                  <div className="timeline-date">{timeLabel(entry.createdAt)}</div>
                  <div className="timeline-event-content">
                    {isHighlight && <small className="timeline-highlight-label">DAY HIGHLIGHT</small>}
                    <h3>{entry.title.trim() || 'A moment from your day'}</h3>
                    <p>{excerpt(entry.content)}</p>
                    <div className="timeline-counts">
                      {entry.mood && <span><Sparkles size={12} />{entry.mood}</span>}
                      {entry.topics.slice(0, 3).map(topic => <span key={topic}><Bookmark size={12} />{topic}</span>)}
                      {entry.people.slice(0, 2).map(person => <span key={person}><AudioLines size={12} />{person}</span>)}
                      {!entry.mood && !entry.topics.length && !entry.people.length && <span><Feather size={12} />Diary entry</span>}
                    </div>
                  </div>
                  <ChevronDown size={15} className={isOpen ? 'rotate' : ''} />
                </button>
                {isOpen && <div className="timeline-expanded">
                  <div className="timeline-entry-detail">
                    <p>{entry.content}</p>
                    <div className="timeline-entry-meta">
                      {entry.mood && <span><Sparkles size={13} />{entry.mood}</span>}
                      {entry.topics.map(topic => <span key={topic}>{topic}</span>)}
                      {entry.people.map(person => <span key={person}>{person}</span>)}
                    </div>
                    <button className="timeline-open-entry" onClick={() => onOpenEntry(entry.id)}>
                      <Clock3 size={13} /> Open diary entry <ChevronRight size={14} />
                    </button>
                  </div>
                </div>}
              </div>
            </article>
          })}
        </div>
      })}
    </div>}
  </section>
}
