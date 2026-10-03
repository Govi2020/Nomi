import { preloadWhisper, transcribePcm } from './localTranscriptionService'

type ProgressHandler = (message: string) => void

export const talkTranscriptionService = {
  prepare(onProgress: ProgressHandler) {
    onProgress('Preparing local Whisper in this browser. The model downloads on first use.')
    return preloadWhisper(onProgress)
  },

  async transcribe(audio: Float32Array, sampleRate: number, onProgress: ProgressHandler) {
    onProgress('Recognizing your words locally...')
    return transcribePcm(audio, sampleRate, onProgress)
  },
}
