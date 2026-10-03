const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const DEFAULT_VOICE = 'af_bella'
type ProgressHandler = (message: string) => void

type KokoroModel = import('kokoro-js').KokoroTTS
let modelPromise: Promise<KokoroModel> | null = null

function getModel(onProgress: ProgressHandler) {
  if (!modelPromise) {
    modelPromise = import('kokoro-js').then(({ KokoroTTS }) => KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: progress => {
        if (progress.status === 'progress') {
          onProgress(`Downloading Kokoro voice model: ${Math.round(progress.progress)}%`)
        } else if (progress.status === 'initiate') {
          onProgress(`Preparing Kokoro voice model: ${progress.file}`)
        } else if (progress.status === 'ready') {
          onProgress('Kokoro voice model is ready.')
        }
      },
    }))
    modelPromise.catch(() => { modelPromise = null })
  }
  return modelPromise
}

export async function preloadKokoro(onProgress: ProgressHandler) {
  await getModel(onProgress)
}

export async function generateKokoroSpeech(text: string, speed: number, onProgress: ProgressHandler) {
  onProgress('Preparing a spoken reply with Kokoro...')
  const model = await getModel(onProgress)
  const audio = await model.generate(text, { voice: DEFAULT_VOICE, speed })
  return audio.toBlob()
}
