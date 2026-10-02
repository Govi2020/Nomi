import { apiClient } from './apiClient'
import { resamplePcm } from './localTranscriptionService'

const SAMPLE_RATE = 16_000
type ProgressHandler = (message: string) => void

function encodePcmWav(samples: Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export const talkTranscriptionService = {
  async prepare(onProgress: ProgressHandler) {
    onProgress('Preparing Parakeet TDT on the configured backend. The first use downloads the model there.')
    await apiClient.post<{ ready: boolean; model: string }>('/api/talk/transcription/prepare', {})
  },

  async transcribe(audio: Float32Array, sampleRate: number, onProgress: ProgressHandler) {
    onProgress('Recognizing your words with Parakeet TDT on the configured backend...')
    const samples = await resamplePcm(audio, sampleRate)
    const wav = encodePcmWav(samples)
    const result = await apiClient.postFile<{ text: string }>('/api/talk/transcription', wav, 'talk-audio.wav')
    return result.text
  },
}
