import { useEffect, useState } from 'react'

type WordRevealProps = {
  text: string
  intervalMs?: number
}

/** Reveals a complete response a word at a time while keeping its original text. */
export function WordReveal({ text, intervalMs = 38 }: WordRevealProps) {
  const words = text.match(/\S+\s*/g) ?? []
  const [visibleWords, setVisibleWords] = useState(0)

  useEffect(() => {
    if (visibleWords >= words.length) return

    const timeout = window.setTimeout(() => {
      setVisibleWords(current => Math.min(current + 1, words.length))
    }, intervalMs)

    return () => window.clearTimeout(timeout)
  }, [intervalMs, visibleWords, words.length])

  return <>{words.slice(0, visibleWords).join('')}</>
}
