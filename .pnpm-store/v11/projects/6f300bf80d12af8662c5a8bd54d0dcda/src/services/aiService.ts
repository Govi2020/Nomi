import type { AIResponse } from '../types'
import { apiClient } from './apiClient'

export type WritingFeedbackAction = 'dig_deeper' | 'get_perspective'
export type AskMode = 'Recall' | 'Reflect' | 'Plan' | 'Search' | 'General'
export type AskTurn = { question: string; answer: string; mode: AskMode; sources: AIResponse['sources']; error?: boolean }

export interface AskChat {
  id: string
  title: string
  updated_at: string
  last_message: string | null
}

export interface StoredAskTurn {
  id: number
  question: string
  answer: string
  mode: AskMode
  sources: { id: number | string; date: string }[]
  created_at: string
}

export interface AskConversation {
  chat: Omit<AskChat, 'last_message'>
  turns: StoredAskTurn[]
}

export const aiService = {
  async getWritingFeedback(action: WritingFeedbackAction, entry: { title: string; content: string }): Promise<string> {
    const result = await apiClient.post<{ feedback: string }>('/api/ai/feedback', { action, ...entry })
    if (typeof result.feedback !== 'string' || !result.feedback.trim()) throw new Error('The feedback response was empty.')
    return result.feedback
  },
  getChats() {
    return apiClient.get<AskChat[]>('/api/ask/chats')
  },
  createChat(turns: AskTurn[] = []) {
    return apiClient.post<AskChat>('/api/ask/chats', {
      turns: turns.filter(turn => !turn.error).map(({ question, answer, mode, sources }) => ({
        question,
        answer,
        mode,
        sources: sources.map(({ id, date }) => ({ id, date })),
      })),
    })
  },
  getConversation(id: string) {
    return apiClient.get<AskConversation>(`/api/ask/chats/${id}`)
  },
  async ask(question: string, mode: AskMode, history: AskTurn[], conversationId?: string): Promise<AIResponse> {
    const result = await apiClient.post<{ answer: string; sources: { id: number | string; date: string }[] }>('/api/chat', {
      question,
      mode,
      conversation_id: conversationId,
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
