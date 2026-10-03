import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Feather, Flame } from './icons'
import type { DiaryEntry } from '../types'

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const sameDay = (a: Date, b: Date) => dateKey(a) === dateKey(b)
const monthLabel = (date: Date) => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date)
const selectedLabel = (date: Date) => `${new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)}, ${date.getDate()} ${new Intl.DateTimeFormat('en', { month: 'short' }).format(date)} ${date.getFullYear()}`

function diaryDate(value: string): Date | null {
  const match = value.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  if (!match) return null
  const month = new Date(`${match[1]} 1, ${match[3]}`).getMonth()
  const date = new Date(Number(match[3]), month, Number(match[2]))
  return Number.isNaN(month) || date.getDate() !== Number(match[2]) ? null : date
}

function streakEndingAt(activeDates: Set<string>, end: Date) {
  let cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  let total = 0
  while (activeDates.has(dateKey(cursor))) {
    total += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return total
}

function longestStreak(keys: string[]) {
  let longest = 0
  let run = 0
  let previous: Date | null = null
  for (const key of keys) {
    const [year, month, day] = key.split('-').map(Number)
    const current = new Date(year, month - 1, day)
    if (previous) {
      const next = new Date(previous.getFullYear(), previous.getMonth(), previous.getDate())
      next.setDate(next.getDate() + 1)
      run = dateKey(next) === key ? run + 1 : 1
    } else run = 1
    longest = Math.max(longest, run)
    previous = current
  }
  return longest
}

export default function CalendarSection({ now, diary }: { now: Date; diary: DiaryEntry[] }) {
  const [viewMonth, setViewMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  const entriesByDate = useMemo(() => {
    const activity = new Map<string, DiaryEntry[]>()
    diary.forEach(entry => {
      const date = diaryDate(entry.date)
      if (!date) return
      const key = dateKey(date)
      activity.set(key, [...(activity.get(key) ?? []), entry])
    })
    return activity
  }, [diary])
  const activityByDate = useMemo(() => new Map([...entriesByDate].map(([key, entries]) => [key, entries.length])), [entriesByDate])
  const activityDates = useMemo(() => [...activityByDate.keys()].sort(), [activityByDate])
  const activeDateSet = useMemo(() => new Set(activityDates), [activityDates])
  const currentStreak = streakEndingAt(activeDateSet, activeDateSet.has(dateKey(now)) ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const bestStreak = longestStreak(activityDates)
  const selectedCount = activityByDate.get(dateKey(selectedDate)) ?? 0
  const selectedEntries = entriesByDate.get(dateKey(selectedDate)) ?? []
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const viewingCurrentMonth = viewMonth.getFullYear() === today.getFullYear() && viewMonth.getMonth() === today.getMonth()
  const monthPrefix = dateKey(viewMonth).slice(0, 7)
  const monthActiveDays = activityDates.filter(key => key.startsWith(monthPrefix)).length
  const monthEntries = [...activityByDate].reduce((total, [key, count]) => total + (key.startsWith(monthPrefix) ? count : 0), 0)
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay())
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)
    return date
  })
  const nextMilestone = [3, 7, 14, 30].find(days => days > bestStreak) ?? Math.ceil((bestStreak + 1) / 30) * 30

  const dates = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
    const count = Math.ceil((first.getDay() + daysInMonth) / 7) * 7
    return Array.from({ length: count }, (_, index) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), index - first.getDay() + 1))
  }, [viewMonth])

  const moveMonth = (amount: number) => {
    const next = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + amount, 1)
    if (next > new Date(today.getFullYear(), today.getMonth(), 1)) return
    const day = Math.min(selectedDate.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())
    setViewMonth(next)
    setSelectedDate(new Date(next.getFullYear(), next.getMonth(), day))
  }
  const goToday = () => {
    const current = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    setViewMonth(new Date(current.getFullYear(), current.getMonth(), 1))
    setSelectedDate(current)
  }
  const selectDate = (date: Date) => {
    setSelectedDate(date)
    if (date.getMonth() !== viewMonth.getMonth() || date.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    }
  }

  return <section className="calendar-section" aria-labelledby="calendar-title">
    <div className="calendar-heading">
      <div className="calendar-title-copy"><div className="section-caption"><span>YOUR DIARY RHYTHM</span><span className="caption-rule"/></div><h2 id="calendar-title">A month in moments</h2><p>A living map of the days you made room for yourself.</p></div>
      <div className="calendar-month-controls"><button className="calendar-today" onClick={goToday}>Jump to today</button><div className="calendar-month-stepper"><button className="calendar-nav" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17}/></button><strong>{monthLabel(viewMonth)}</strong><button className="calendar-nav" aria-label="Next month" onClick={() => moveMonth(1)} disabled={viewingCurrentMonth} aria-disabled={viewingCurrentMonth}><ChevronRight size={17}/></button></div></div>
    </div>
    <div className="calendar-streak-summary">
      <div className="calendar-metric-row">
        <div className="calendar-streak-topline"><span className="calendar-streak-icon"><Flame size={16}/></span><span><small>RIGHT NOW</small><b>{currentStreak} {currentStreak === 1 ? 'day' : 'days'}</b></span></div>
        <div className="calendar-stat"><small>PERSONAL BEST</small><b>{bestStreak} <span>{bestStreak === 1 ? 'day' : 'days'}</span></b></div>
        <div className="calendar-stat"><small>THIS MONTH</small><b>{monthActiveDays} <span>{monthActiveDays === 1 ? 'day' : 'days'}</span></b><em>{monthEntries} {monthEntries === 1 ? 'entry' : 'entries'}</em></div>
        <div className="calendar-month-mark"><CalendarDays size={19}/><span><b>{String(viewMonth.getMonth() + 1).padStart(2, '0')}</b><small>MONTH<br/>NO.</small></span></div>
      </div>
      <div className="calendar-week-summary"><div className="calendar-week-heading"><span>THE WEEK, SO FAR</span><small>{weekDates[0].toLocaleDateString('en', { month: 'short', day: 'numeric' })} — {weekDates[6].toLocaleDateString('en', { month: 'short', day: 'numeric' })}</small></div><div className="calendar-week-strip" aria-label="This week's diary activity">{weekDates.map(date => {
        const key = dateKey(date)
        const active = activeDateSet.has(key)
        const future = date > today
        return <button type="button" key={key} className={`calendar-week-day ${active ? 'is-active' : ''} ${sameDay(date, today) ? 'is-today' : ''} ${sameDay(date, selectedDate) ? 'is-selected' : ''} ${future ? 'is-future' : ''}`} aria-label={`${new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}${active ? ', diary entry' : ', no diary entry'}`} aria-pressed={sameDay(date, selectedDate)} disabled={future} onClick={() => selectDate(date)}><span>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)}</span><b>{date.getDate()}</b><i className="calendar-week-activity" aria-hidden="true"/></button>
      })}</div></div>
      <div className="calendar-milestone"><span className="calendar-milestone-icon"><CalendarDays size={16}/></span><span className="calendar-milestone-copy"><small>NEXT MILESTONE</small><b>{bestStreak >= nextMilestone ? `${bestStreak}-day personal best` : `${nextMilestone}-day writing streak`}</b><span>{bestStreak >= nextMilestone ? 'Your longest run so far.' : `${Math.max(0, nextMilestone - bestStreak)} more ${nextMilestone - bestStreak === 1 ? 'day' : 'days'} to go · best is ${bestStreak} ${bestStreak === 1 ? 'day' : 'days'}`}</span></span><span className="calendar-milestone-progress" aria-label={`${Math.min(100, Math.round(bestStreak / nextMilestone * 100))}% complete`}><i style={{ width: `${Math.min(100, Math.round(bestStreak / nextMilestone * 100))}%` }}/></span></div>
    </div>
    <div className="calendar-layout">
      <div className="calendar-grid-panel">
        <div className="calendar-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">{dates.map(date => {
          const key = dateKey(date)
          const count = activityByDate.get(key) ?? 0
          const isToday = sameDay(date, now)
          const isSelected = sameDay(date, selectedDate)
          const inMonth = date.getMonth() === viewMonth.getMonth()
          const isFuture = date > today
          const joinsPrevious = activeDateSet.has(dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)))
          const joinsNext = activeDateSet.has(dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)))
          return <button type="button" key={key} className={`calendar-date ${inMonth ? '' : 'outside-month'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${isFuture ? 'is-future' : ''} ${count ? 'has-streak' : ''} ${count && joinsPrevious ? 'streak-joins-previous' : ''} ${count && joinsNext ? 'streak-joins-next' : ''}`} disabled={isFuture} onClick={() => selectDate(date)} aria-label={`${new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(date)}${isFuture ? ', future date' : count ? `, ${count} ${count === 1 ? 'diary entry' : 'diary entries'}` : ', no diary entry'}`} aria-pressed={isSelected}>
            {count > 0 && <span className="calendar-streak-bridge" aria-hidden="true"/>}<span className="calendar-day-number">{date.getDate()}</span><span className="calendar-dots" aria-hidden="true">{count > 0 && <i className="calendar-dot streak"/>}</span>
          </button>
        })}</div>
        <div className="calendar-legend"><span><i className="calendar-dot streak"/> Diary entry</span><span><i className="calendar-today-key"/> Today</span><span><i className="calendar-selected-key"/> Selected day</span></div>
      </div>
      <aside className="calendar-day-panel calendar-streak-panel" aria-live="polite">
        <div className="calendar-day-heading"><div><span className="calendar-panel-label"><CalendarDays size={13}/> DAYBOOK · {selectedDate.toLocaleDateString('en', { month: 'short' }).toUpperCase()} {String(selectedDate.getDate()).padStart(2, '0')}</span><h3>{selectedLabel(selectedDate)}</h3><p>{selectedCount ? `${selectedCount} ${selectedCount === 1 ? 'entry' : 'entries'} in your daybook` : 'A page still waiting for a moment'}</p></div><span className={`calendar-day-count ${selectedCount ? 'has-entries' : ''}`}>{String(selectedCount).padStart(2, '0')}</span></div>
        {selectedEntries.length ? <div className="calendar-selected-entries">{selectedEntries.map((entry, index) => <article className="calendar-selected-entry" key={entry.id}><div className="calendar-entry-topline"><span>FIELD NOTE {String(index + 1).padStart(2, '0')}</span>{entry.createdAt && <time>{new Date(entry.createdAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</time>}</div><h4>{entry.title || 'Untitled reflection'}</h4><p>{entry.content.length > 190 ? `${entry.content.slice(0, 190).trimEnd()}…` : entry.content}</p><div className="calendar-entry-tags">{entry.mood && <span>{entry.mood}</span>}{entry.energy && <span>{entry.energy} energy</span>}{entry.topics.slice(0, 2).map(topic => <span key={topic}>{topic}</span>)}</div></article>)}</div> : <div className="calendar-day-empty"><span className="calendar-empty-mark"><Feather size={16}/></span><b>No entry this day</b><p>The quiet spaces count too. Pick another date to revisit a moment.</p></div>}
        <div className="calendar-streak-note"><span>A NOTE ON YOUR RHYTHM</span><p>{currentStreak ? `You’ve written ${currentStreak} ${currentStreak === 1 ? 'day' : 'days'} in a row. Keep making space for yourself.` : 'Small moments add up. Your writing days will gather here over time.'}</p></div>
      </aside>
    </div>
  </section>
}
