import type { DiaryEntry, Memory } from '../types'
import { apiClient } from './apiClient'

const memories: Memory[] = [
  { id: 'm1', content: 'Started building the AI journaling companion for the hackathon. The idea finally feels like something I can make real.', date: 'Oct 1 · 10:42 AM', topics: ['Hackathon', 'AI', 'Development'], project: 'Memory', people: ['Arun'], source: { kind: 'Voice recording', date: 'Oct 1', id: 'r1' }, importance: 0.86, confidence: 0.94 },
  { id: 'm2', content: 'Arun helped untangle the onboarding flow over coffee. It felt good to make the hard parts smaller together.', date: 'Sep 30 · 4:18 PM', topics: ['Friendship', 'Ideas'], project: 'Memory', people: ['Arun'], source: { kind: 'Diary entry', date: 'Sep 30', id: 'd1' }, importance: 0.75, confidence: 0.91 },
  { id: 'm3', content: 'A slow walk after class made the whole week feel a little less crowded.', date: 'Sep 28 · 6:05 PM', topics: ['College', 'Rest'], people: ['Rahul'], source: { kind: 'Voice recording', date: 'Sep 28', id: 'r2' }, importance: 0.62, confidence: 0.89 },
  { id: 'm4', content: 'I was frustrated by the prototype, then realized the problem was trying to solve every feature at once.', date: 'Sep 27 · 8:30 PM', topics: ['Hackathon', 'Frustration', 'Progress'], project: 'Memory', source: { kind: 'Diary entry', date: 'Sep 27', id: 'd2' }, importance: 0.81, confidence: 0.93 },
  { id: 'm5', content: 'Had a surprisingly good lunch with the team. We left with one clear next step instead of ten.', date: 'Sep 23 · 1:15 PM', topics: ['Friends', 'College'], people: ['Arun', 'Maya'], source: { kind: 'Voice recording', date: 'Sep 23', id: 'r3' }, importance: 0.58, confidence: 0.88 },
]
const delay = (ms = 220) => new Promise(resolve => setTimeout(resolve, ms))

interface ApiDiaryEntry {
  id: number
  created_at: string
  title: string | null
  text: string
  mood: string | null
  tags: string[]
  entities: { name: string }[]
}

const draftEntryIds = new Map<string, string>()
let diarySaveQueue: Promise<void> = Promise.resolve()

function fromApiDiaryEntry(entry: ApiDiaryEntry): DiaryEntry {
  const createdAt = new Date(entry.created_at)
  return {
    id: String(entry.id),
    date: new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(createdAt),
    createdAt: entry.created_at,
    title: entry.title ?? '',
    content: entry.text,
    mood: entry.mood ?? 'Thoughtful',
    energy: 'Steady',
    topics: entry.tags,
    people: entry.entities.map(entity => entity.name),
    memoryIds: [],
  }
}

function saveDiaryEntryApi(entry: DiaryEntry, source = 'text') {
  const save = diarySaveQueue.then(async () => {
    const draftId = entry.id
    const entryId = /^\d+$/.test(draftId) ? draftId : draftEntryIds.get(draftId)
    let saved: ApiDiaryEntry
    if (entryId) {
      saved = await apiClient.put<ApiDiaryEntry>(`/api/entries/${entryId}`, { text: entry.content, title: entry.title })
    } else {
      const response = await apiClient.post<{ entry: ApiDiaryEntry }>('/api/entries', {
        text: entry.content,
        title: entry.title,
        source,
      })
      saved = response.entry
      draftEntryIds.set(draftId, String(saved.id))
    }
    return fromApiDiaryEntry(saved)
  })
  diarySaveQueue = save.then(() => undefined, () => undefined)
  return save
}

async function audioToWav(blob: Blob) {
  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const samples = new Float32Array(audio.length)
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const channelData = audio.getChannelData(channel)
      for (let index = 0; index < audio.length; index++) samples[index] += channelData[index] / audio.numberOfChannels
    }

    const wav = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(wav)
    const writeText = (offset: number, text: string) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
    writeText(0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeText(8, 'WAVE')
    writeText(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, audio.sampleRate, true)
    view.setUint32(28, audio.sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeText(36, 'data')
    view.setUint32(40, samples.length * 2, true)
    for (let index = 0; index < samples.length; index++) {
      const sample = Math.max(-1, Math.min(1, samples[index]))
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    }
    return new Blob([wav], { type: 'audio/wav' })
  } finally {
    await context.close()
  }
}

async function transcribeAudio(blob: Blob) {
  const wav = await audioToWav(blob)
  const result = await apiClient.postFile<{ text?: string }>('/api/transcribe', wav, 'dictation.wav')
  return result.text?.trim() ?? ''
}

export const memoryService = {
  async getMemories() { await delay(); return memories },
  async getMemory(id: string) { await delay(); return memories.find(item => item.id === id) ?? memories[0] },
  async getDiary() {
    const entries = await apiClient.get<ApiDiaryEntry[]>('/api/entries')
    return entries.map(fromApiDiaryEntry)
  },
  async getDiaryEntry(id: string) {
    return fromApiDiaryEntry(await apiClient.get<ApiDiaryEntry>(`/api/entries/${id}`))
  },
  async saveDiaryEntry(entry: DiaryEntry) {
    return saveDiaryEntryApi(entry)
  },
  async transcribeAudio(blob: Blob) {
    return transcribeAudio(blob)
  },
  async saveRecording(blob: Blob, fallbackText = '') {
    let transcript = fallbackText.trim()
    try {
      transcript = await transcribeAudio(blob) || transcript
    } catch (error) {
      if (!transcript) throw error
    }
    if (!transcript) throw new Error('No speech was detected. Check the Whisper backend configuration and try again.')

    const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())
    const entry: DiaryEntry = { id: `d${Date.now()}`, date, title: 'Voice recording', content: transcript, mood: 'Thoughtful', energy: 'Steady', topics: [], people: [], memoryIds: [] }
    const saved = await saveDiaryEntryApi(entry, 'audio')
    memories.unshift({ id: `m${Date.now()}`, content: transcript, date: 'Just now', topics: [], source: { kind: 'Voice recording', date: 'Today', id: saved.id }, importance: .8, confidence: .9 })
    return saved
  },
}
