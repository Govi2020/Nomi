export type Page = 'Home' | 'Diary' | 'Talk to Me' | 'Ask AI' | 'Timeline' | 'Insights' | 'People' | 'Tasks' | 'Settings'
export interface Source { kind: 'Voice recording' | 'Diary entry' | 'Memory'; date: string; id: string }
export interface Memory { id: string; content: string; date: string; topics: string[]; project?: string; people?: string[]; source: Source; importance: number; confidence: number }
export interface DiaryMedia { id: string; filename: string; media_type: 'image' | 'video'; content_type: string; url: string }
export interface DiaryEntry { id: string; date: string; createdAt?: string; title: string; content: string; mood: string; moodScore?: number | null; energy: string; topics: string[]; people: string[]; memoryIds: string[]; media?: DiaryMedia[] }
export interface AIResponse { answer: string; sources: Source[] }
export interface Goal { id: string; title: string; note: string; progress: number }
export interface Task { id: string; title: string; done: boolean; due: string }
