import { apiClient } from './apiClient'

export interface ClinicalReportSource {
  id: string
  date: string
  title: string
  excerpt: string
}

export interface ClinicalReportObservation {
  title: string
  description: string
  sources: ClinicalReportSource[]
}

export interface ClinicalReportComment {
  text: string
  sources: ClinicalReportSource[]
}

export interface ClinicalReport {
  generated_at: string
  entry_count: number
  analyzed_entry_count: number
  analysis_sample_count: number
  first_entry_date: string | null
  last_entry_date: string | null
  writing_days: number
  mood_counts: Record<string, number>
  mood_score_days?: { date: string; average_score: number; entry_count: number }[]
  energy_counts: Record<string, number>
  top_tags: { tag: string; count: number }[]
  writing_days_by_weekday: Record<string, number>
  observations: ClinicalReportObservation[]
  behavior_patterns?: ClinicalReportObservation[]
  personality_details?: ClinicalReportObservation[]
  behavioral_shifts?: ClinicalReportObservation[]
  overall_comment?: ClinicalReportComment
}

export const clinicalReportService = {
  getReport() {
    return apiClient.get<ClinicalReport>('/api/insights/clinical-report')
  },
}
