import { apiClient } from './apiClient'

export type ReviewPeriod = 'month' | 'year'

export interface TimelineReviewHighlight {
  id: string
  date: string
  title: string
  summary: string
}

export interface TimelineReview {
  period: ReviewPeriod
  period_label: string
  entry_count: number
  summary: string
  themes: string[]
  highlights: TimelineReviewHighlight[]
}

export const timelineService = {
  getReview(period: ReviewPeriod, on: string) {
    const params = new URLSearchParams({ period, on })
    return apiClient.get<TimelineReview>(`/api/timeline/review?${params}`, AbortSignal.timeout(180_000))
  },
}
