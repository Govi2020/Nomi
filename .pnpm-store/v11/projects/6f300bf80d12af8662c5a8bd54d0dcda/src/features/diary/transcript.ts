export type AudioFrame = { start: number; audio: Float32Array }

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
