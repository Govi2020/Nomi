export type AudioFrame = { start: number; audio: Float32Array }

export function sanitizeTranscribedText(value: string) {
  const cleaned = value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''

  const strippedNoise = cleaned
    .replace(/\(\s*(?:speaks|talks|says|voice|audio)\s+(?:in\s+)?(?:foreign|other|different|non[- ]english)\s+(?:language|tongue)\s*\)/gi, ' ')
    .replace(/\[\s*(?:speaks|talks|says|voice|audio)\s+(?:in\s+)?(?:foreign|other|different|non[- ]english)\s+(?:language|tongue)\s*\]/gi, ' ')
    .replace(/(?:\.\s*){4,}/g, ' ')
    .replace(/(?:[!?.,;:~_-]\s*){4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!strippedNoise) return ''
  if (/^(?:[.?!,:;~_\-\s]+)$/u.test(strippedNoise)) return ''

  const alpha = strippedNoise.replace(/[^A-Za-z]/g, '')
  if (!alpha || alpha.length < 2) return ''

  return strippedNoise
}

export function mergeOverlappingTranscript(current: string, next: string) {
  const existingWords = current.trim().split(/\s+/).filter(Boolean)
  const nextWords = next.trim().split(/\s+/).filter(Boolean)
  const normalize = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  const maxOverlap = Math.min(existingWords.length, nextWords.length, 20)
  let overlap = 0
  for (let length = maxOverlap; length > 0; length--) {
    const existingTail = existingWords.slice(-length).map(normalize)
    const nextHead = nextWords.slice(0, length).map(normalize)
    if (existingTail.every((word, index) => word && word === nextHead[index])) {
      overlap = length
      break
    }
  }
  const addition = nextWords.slice(overlap).join(' ')
  return addition ? `${current}${current && !/[\s\n]$/.test(current) ? ' ' : ''}${addition}` : current
}
