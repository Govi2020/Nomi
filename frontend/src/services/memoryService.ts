import type { DiaryEntry, Memory, TimelineEvent } from '../types'
import { apiClient } from './apiClient'

const memories: Memory[] = [
  { id: 'm1', content: 'Started building the AI journaling companion for the hackathon. The idea finally feels like something I can make real.', date: 'Oct 1 · 10:42 AM', topics: ['Hackathon', 'AI', 'Development'], project: 'Memory', people: ['Arun'], source: { kind: 'Voice recording', date: 'Oct 1', id: 'r1' }, importance: 0.86, confidence: 0.94 },
  { id: 'm2', content: 'Arun helped untangle the onboarding flow over coffee. It felt good to make the hard parts smaller together.', date: 'Sep 30 · 4:18 PM', topics: ['Friendship', 'Ideas'], project: 'Memory', people: ['Arun'], source: { kind: 'Diary entry', date: 'Sep 30', id: 'd1' }, importance: 0.75, confidence: 0.91 },
  { id: 'm3', content: 'A slow walk after class made the whole week feel a little less crowded.', date: 'Sep 28 · 6:05 PM', topics: ['College', 'Rest'], people: ['Rahul'], source: { kind: 'Voice recording', date: 'Sep 28', id: 'r2' }, importance: 0.62, confidence: 0.89 },
  { id: 'm4', content: 'I was frustrated by the prototype, then realized the problem was trying to solve every feature at once.', date: 'Sep 27 · 8:30 PM', topics: ['Hackathon', 'Frustration', 'Progress'], project: 'Memory', source: { kind: 'Diary entry', date: 'Sep 27', id: 'd2' }, importance: 0.81, confidence: 0.93 },
  { id: 'm5', content: 'Had a surprisingly good lunch with the team. We left with one clear next step instead of ten.', date: 'Sep 23 · 1:15 PM', topics: ['Friends', 'College'], people: ['Arun', 'Maya'], source: { kind: 'Voice recording', date: 'Sep 23', id: 'r3' }, importance: 0.58, confidence: 0.88 },
]
const diary: DiaryEntry[] = [
  { id: 'd1', date: 'Tuesday, September 30, 2026', title: 'A difficult but productive day', content: 'The day started with that familiar feeling of having too many tabs open—in my head and on my laptop. Arun and I sat down with coffee and talked through the onboarding flow. Instead of making the whole thing feel easier, he helped me see which part actually mattered today.\n\nBy late afternoon, the prototype had a shape. I still have a long list of things I want to add, but for the first time this week the list felt like possibility instead of pressure. I want to remember how much lighter the work gets when I let someone else look at it with me.', mood: 'Hopeful', energy: 'Steady', topics: ['Hackathon', 'Friendship', 'Progress'], people: ['Arun'], memoryIds: ['m2'] },
  { id: 'd2', date: 'Sunday, September 27, 2026', title: 'When the list got too long', content: 'I felt frustrated looking at everything the project could become. I was trying to make every idea part of the first version. Taking a step back helped me see that one small, well-made flow could be enough to begin.', mood: 'Reflective', energy: 'Low', topics: ['Hackathon', 'Frustration'], people: [], memoryIds: ['m4'] },
  { id: 'd3', date: 'Wednesday, September 23, 2026', title: 'Lunch without an agenda', content: 'A good lunch with the team, and a rare afternoon where the next step felt obvious. We laughed more than we planned, which might have been the useful part.', mood: 'Light', energy: 'Good', topics: ['Friends', 'College'], people: ['Arun', 'Maya'], memoryIds: ['m5'] },
]
const timeline: TimelineEvent[] = [
  { id: 't1', date: 'OCT 1', title: 'A project starts to feel real', summary: 'Began shaping the AI journaling companion.', recordings: 1, memories: 2, people: ['Arun'], project: 'Memory' },
  { id: 't2', date: 'SEP 30', title: 'The onboarding conversation', summary: 'Coffee with Arun made the next step clearer.', recordings: 2, memories: 3, people: ['Arun'], project: 'Memory' },
  { id: 't3', date: 'SEP 28', title: 'A slower walk home', summary: 'A quiet moment after a full week at college.', recordings: 1, memories: 2, people: ['Rahul'], project: 'College' },
  { id: 't4', date: 'SEP 27', title: 'Choosing what matters first', summary: 'Noticed the project had become too many things at once.', recordings: 1, memories: 2, people: [], project: 'Memory' },
  { id: 't5', date: 'SEP 23', title: 'Lunch with the team', summary: 'A shared meal turned into one clear next step.', recordings: 1, memories: 2, people: ['Arun', 'Maya'], project: 'College' },
]
const delay = (ms = 220) => new Promise(resolve => setTimeout(resolve, ms))

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
  async getDiary() { await delay(); return diary },
  async getDiaryEntry(id: string) { await delay(); return diary.find(item => item.id === id) ?? diary[0] },
  async getTimeline() { await delay(); return timeline },
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
    diary.unshift(entry)
    memories.unshift({ id: `m${Date.now()}`, content: transcript, date: 'Just now', topics: [], source: { kind: 'Voice recording', date: 'Today', id: entry.id }, importance: .8, confidence: .9 })
    return entry
  },
}
