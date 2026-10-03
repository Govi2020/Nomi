export interface TalkMessage {
  role: 'user' | 'assistant'
  content: string
}

export type TalkEvent =
  | { type: 'meta'; memory_used: boolean; sources: { id: string; date: string; title: string }[] }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export async function streamTalk(
  messages: TalkMessage[],
  onEvent: (event: TalkEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch('/api/talk/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
    signal,
  })
  if (!response.ok) {
    let message = `Conversation failed (${response.status})`
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Retain the HTTP status if the response isn't JSON.
    }
    throw new Error(message)
  }
  if (!response.body) throw new Error('Streaming responses are not supported in this browser.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consume = (block: string) => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
    if (!data) return
    try { onEvent(JSON.parse(data) as TalkEvent) } catch { /* Ignore malformed stream events. */ }
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      consume(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) consume(buffer)
}