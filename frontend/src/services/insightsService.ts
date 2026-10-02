import { apiClient } from './apiClient'

export interface InsightSource {
  id: string
  date: string
  title: string
}

export interface JournalInsight {
  title: string
  summary: string
  period: string
  sources: InsightSource[]
}

export interface JournalInsights {
  entry_count: number
  insights: JournalInsight[]
}

export const insightsService = {
  getJournalInsights() {
    return apiClient.get<JournalInsights>('/api/insights')
  },
}
