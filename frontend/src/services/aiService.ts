import type { AIResponse } from '../types'
import { apiClient } from './apiClient'

export type WritingFeedbackAction = 'dig_deeper' | 'get_perspective'
export type AskMode = 'Recall' | 'Reflect' | 'Plan' | 'Search' | 'General'
export type AskTurn = { question: string; answer: string; mode: AskMode; sources: AIResponse['sources']; error?: boolean }

export const aiService = {
  async getWritingFeedback(action: WritingFeedbackAction, entry: { title: string; content: string }): Promise<string> {
    const result = await apiClient.post<{ feedback: string }>('/api/ai/feedback', { action, ...entry })
    if (typeof result.feedback !== 'string' || !result.feedback.trim()) throw new Error('The feedback response was empty.')
    return result.feedback
  },
  async ask(question: string, mode: AskMode, history: AskTurn[]): Promise<AIResponse> {
    const result = await apiClient.post<{ answer: string; sources: { id: number | string; date: string }[] }>('/api/chat', {
      question,
      mode,
      history: history.flatMap(turn => [
        { role: 'user', content: turn.question },
        ...(turn.answer ? [{ role: 'assistant', content: turn.answer }] : []),
      ]).slice(-12),
    })
    return {
      answer: result.answer,
      sources: (result.sources ?? []).map(source => ({ kind: 'Diary entry', date: source.date, id: String(source.id) })),
    }
  },
}
