const MODEL_ID = 'Xenova/whisper-tiny.en'
const TARGET_SAMPLE_RATE = 16_000

type AsrOptions = { chunk_length_s: number; stride_length_s: number }
type AsrPipeline = (audio: Float32Array, options: AsrOptions) => Promise<string>
type ModelProgress = { status?: string; progress?: number; file?: string; name?: string }
type ProgressHandler = (message: string) => void

let pipelinePromise: Promise<AsrPipeline> | null = null

function progressMessage(progress: ModelProgress) {
  if (typeof progress.progress === 'number') return `Downloading local Whisper model: ${Math.round(progress.progress)}%`
  if (progress.status === 'initiate') return `Preparing ${progress.file ?? progress.name ?? 'local Whisper model'}...`
  return 'Preparing local Whisper model...'
}

async function createPipeline(onProgress: ProgressHandler): Promise<AsrPipeline> {
  const { pipeline } = await import('@huggingface/transformers')
  const progress_callback = (progress: ModelProgress) => onProgress(progressMessage(progress))

  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const webgpuPipeline = await pipeline('automatic-speech-recognition', MODEL_ID, {
        device: 'webgpu',
        dtype: 'fp16',
        progress_callback,
      })
      return async (audio, options) => {
        const result = await webgpuPipeline(audio, options)
        return Array.isArray(result) ? result.map(part => part.text).join(' ') : result.text
      }
    } catch {
      onProgress('WebGPU is unavailable; preparing the CPU Whisper model...')
    }
  }

  const cpuPipeline = await pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback,
  })
  return async (audio, options) => {
    const result = await cpuPipeline(audio, options)
    return Array.isArray(result) ? result.map(part => part.text).join(' ') : result.text
  }
}

function getPipeline(onProgress: ProgressHandler) {
  if (!pipelinePromise) {
    pipelinePromise = createPipeline(onProgress)
    pipelinePromise.catch(() => { pipelinePromise = null })
  }
  return pipelinePromise
}

export async function resamplePcm(audio: Float32Array, sampleRate: number) {
  if (sampleRate === TARGET_SAMPLE_RATE) return audio
  const outputLength = Math.max(1, Math.round(audio.length * TARGET_SAMPLE_RATE / sampleRate))

  if (typeof OfflineAudioContext !== 'undefined') {
    const context = new OfflineAudioContext(1, outputLength, TARGET_SAMPLE_RATE)
    const buffer = context.createBuffer(1, audio.length, sampleRate)
    buffer.getChannelData(0).set(audio)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start()
    return (await context.startRendering()).getChannelData(0)
  }

  const ratio = sampleRate / TARGET_SAMPLE_RATE
  const output = new Float32Array(outputLength)
  for (let index = 0; index < output.length; index++) {
    const position = index * ratio
    const left = Math.floor(position)
    const fraction = position - left
    output[index] = (audio[left] ?? 0) * (1 - fraction) + (audio[left + 1] ?? 0) * fraction
  }
  return output
}

export async function preloadWhisper(onProgress: ProgressHandler) {
  await getPipeline(onProgress)
}

export async function transcribePcm(audio: Float32Array, sampleRate: number, onProgress: ProgressHandler) {
  const [transcriber, resampled] = await Promise.all([getPipeline(onProgress), resamplePcm(audio, sampleRate)])
  return transcriber(resampled, {
    chunk_length_s: 30,
    stride_length_s: 5,
  })
}