import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Flame } from 'lucide-react'
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
  const activityByDate = useMemo(() => {
    const activity = new Map<string, number>()
    diary.forEach(entry => {
      const date = diaryDate(entry.date)
      if (!date) return
      const key = dateKey(date)
      activity.set(key, (activity.get(key) ?? 0) + 1)
    })
    return activity
  }, [diary])
  const activityDates = useMemo(() => [...activityByDate.keys()].sort(), [activityByDate])
  const activeDateSet = useMemo(() => new Set(activityDates), [activityDates])
  const currentStreak = streakEndingAt(activeDateSet, activeDateSet.has(dateKey(now)) ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const bestStreak = longestStreak(activityDates)
  const selectedCount = activityByDate.get(dateKey(selectedDate)) ?? 0
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const viewingCurrentMonth = viewMonth.getFullYear() === today.getFullYear() && viewMonth.getMonth() === today.getMonth()
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

  return <section className="calendar-section" aria-labelledby="calendar-title">
    <div className="calendar-heading">
      <div><div className="section-caption"><span>YOUR DIARY RHYTHM</span><span className="caption-rule"/></div><h2 id="calendar-title">Writing streaks</h2><p>See the days you made a little space for your thoughts.</p></div>
      <div className="calendar-month-controls"><button className="calendar-today" onClick={goToday}>Today</button><button className="calendar-nav" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft size={17}/></button><strong>{monthLabel(viewMonth)}</strong><button className="calendar-nav" aria-label="Next month" onClick={() => moveMonth(1)} disabled={viewingCurrentMonth} aria-disabled={viewingCurrentMonth}><ChevronRight size={17}/></button></div>
    </div>
    <div className="calendar-streak-summary">
      <div className="calendar-streak-topline"><span className="calendar-streak-icon"><Flame size={16}/></span><span><small>CURRENT STREAK</small><b>{currentStreak} {currentStreak === 1 ? 'day' : 'days'}</b></span><span className="calendar-active-total">{activityDates.length} writing {activityDates.length === 1 ? 'day' : 'days'}</span></div>
      <div className="calendar-week-strip" aria-label="This week's diary activity">{weekDates.map(date => {
        const key = dateKey(date)
        const active = activeDateSet.has(key)
        const future = date > today
        return <div key={key} className={`calendar-week-day ${active ? 'is-active' : ''} ${sameDay(date, today) ? 'is-today' : ''} ${future ? 'is-future' : ''}`} aria-label={`${new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}${active ? ', diary entry' : ''}`}><Flame size={17} strokeWidth={1.7}/><span>{new Intl.DateTimeFormat('en', { weekday: 'narrow' }).format(date)}</span></div>
      })}</div>
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
          return <button key={key} className={`calendar-date ${inMonth ? '' : 'outside-month'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${isFuture ? 'is-future' : ''} ${count ? 'has-streak' : ''} ${count && joinsPrevious ? 'streak-joins-previous' : ''} ${count && joinsNext ? 'streak-joins-next' : ''}`} disabled={isFuture} onClick={() => { setSelectedDate(date); if (!inMonth) setViewMonth(new Date(date.getFullYear(), date.getMonth(), 1)) }} aria-label={`${new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(date)}${isFuture ? ', future date' : count ? `, ${count} ${count === 1 ? 'diary entry' : 'diary entries'}` : ', no diary entry'}`} aria-pressed={isSelected}>
            {count > 0 && <span className="calendar-streak-bridge" aria-hidden="true"/>}<span className="calendar-day-number">{date.getDate()}</span><span className="calendar-dots" aria-hidden="true">{count > 0 && <i className="calendar-dot streak"/>}</span>
          </button>
        })}</div>
        <div className="calendar-legend"><span><i className="calendar-dot streak"/> Diary entry</span><span><i className="calendar-today-key"/> Today</span><span><i className="calendar-selected-key"/> Selected day</span></div>
      </div>
      <aside className="calendar-day-panel calendar-streak-panel" aria-live="polite">
        <div className="calendar-day-heading"><div><span className="calendar-panel-label"><CalendarDays size={13}/> STREAK HISTORY</span><h3>{selectedLabel(selectedDate)}</h3><p>{selectedCount ? `${selectedCount} ${selectedCount === 1 ? 'diary entry' : 'diary entries'} recorded` : 'No diary entry recorded'}</p></div></div>
        <div className={`calendar-streak-day ${selectedCount ? 'is-active' : ''}`}><span className="calendar-streak-day-icon"><Flame size={19}/></span><div><b>{selectedCount ? 'You showed up for yourself.' : 'A quiet day.'}</b><p>{selectedCount ? 'This date is part of your diary history.' : 'Your streak view will mark the days you write.'}</p></div></div>
        <div className="calendar-streak-note"><span>YOUR RHYTHM</span><p>{currentStreak ? `You’ve written ${currentStreak} days in a row. Keep making space for yourself.` : 'Small moments add up. Your writing days will gather here over time.'}</p></div>
      </aside>
    </div>
  </section>
}
