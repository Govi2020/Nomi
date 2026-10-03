import { useEffect, useRef, useState } from 'react'
import { AudioLines, Mic, MicOff, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { preloadWhisper, transcribePcm } from '../../services/localTranscriptionService'
import { streamTalk, type TalkMessage } from '../../services/talkService'
import './TalkToMePage.css'

type Phase = 'idle' | 'loading' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'error'
type Turn = TalkMessage & { id: number; complete?: boolean; memoryUsed?: boolean; interrupted?: boolean }

const SILENCE_MS = 900
const MAX_TURN_MS = 35_000
const SPEECH_THRESHOLD = 0.018
const PREROLL_MS = 420
const INTERIM_WINDOW_SECONDS = 2.2
const INTERIM_STRIDE_SECONDS = 1.6
const INTERIM_OVERLAP_SECONDS = 1.2

function concatenateFrames(frames: Float32Array[]) {
  const audio = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0))
  let offset = 0
  for (const frame of frames) {
    audio.set(frame, offset)
    offset += frame.length
  }
  return audio
}

function extractSentences(buffer: string) {
  const sentences: string[] = []
  let remaining = buffer
  let match = remaining.match(/^(.+?[.!?…])(?:\s+|$)/s)
  while (match) {
    sentences.push(match[1].trim())
    remaining = remaining.slice(match[0].length)
    match = remaining.match(/^(.+?[.!?…])(?:\s+|$)/s)
  }
  if (remaining.length > 220) {
    const split = remaining.lastIndexOf(' ', 200)
    if (split > 60) {
      sentences.push(remaining.slice(0, split).trim())
      remaining = remaining.slice(split + 1)
    }
  }
  return { sentences, remaining }
}

function mergeTranscript(current: string, next: string) {
  const existing = current.trim().split(/\s+/).filter(Boolean)
  const incoming = next.trim().split(/\s+/).filter(Boolean)
  const normalize = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  for (let length = Math.min(existing.length, incoming.length, 18); length > 0; length--) {
    const left = existing.slice(-length).map(normalize)
    const right = incoming.slice(0, length).map(normalize)
    if (left.every((word, index) => word && word === right[index])) {
      const addition = incoming.slice(length).join(' ')
      return addition ? `${current}${current && !/[\s\n]$/.test(current) ? ' ' : ''}${addition}` : current
    }
  }
  const addition = incoming.join(' ')
  return addition ? `${current}${current && !/[\s\n]$/.test(current) ? ' ' : ''}${addition}` : current
}

export function TalkToMePage() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('Your voice stays on this device.')
  const [liveDraft, setLiveDraft] = useState('')
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [modelReady, setModelReady] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const muteRef = useRef<GainNode | null>(null)
  const sampleRateRef = useRef(16_000)
  const phaseRef = useRef<Phase>('idle')
  const listeningRef = useRef(false)
  const utteranceRef = useRef<Float32Array[]>([])
  const preRollRef = useRef<Float32Array[]>([])
  const utteranceSamplesRef = useRef(0)
  const lastSpeechAtRef = useRef(0)
  const utteranceStartedAtRef = useRef(0)
  const interimLastEndRef = useRef(0)
  const interimNextAtRef = useRef(0)
  const interimTextRef = useRef('')
  const interimTaskRef = useRef<Promise<void> | null>(null)
  const speechFramesRef = useRef(0)
  const finalizingRef = useRef(false)
  const turnsRef = useRef<Turn[]>([])
  const nextIdRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const assistantIdRef = useRef<number | null>(null)
  const responseIdRef = useRef(0)
  const responseDoneRef = useRef(false)
  const speechQueueRef = useRef<string[]>([])
  const speechPendingRef = useRef('')
  const speakingRef = useRef(false)
  const voiceEnabledRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const updatePhase = (next: Phase, nextStatus?: string) => {
    phaseRef.current = next
    setPhase(next)
    if (nextStatus) setStatus(nextStatus)
  }

  useEffect(() => {
    let active = true
    updatePhase('loading', 'Loading Whisper Tiny on this device...')
    void preloadWhisper(message => {
      if (active) setStatus(message)
    }).then(() => {
      if (!active) return
      setModelReady(true)
      if (phaseRef.current === 'loading') updatePhase('idle', 'Whisper is ready on this device. Talk whenever you like.')
    }).catch(error => {
      if (active) setStatus(error instanceof Error ? `Local speech model unavailable: ${error.message}` : 'Local speech model unavailable.')
    })
    return () => {
      active = false
      listeningRef.current = false
      controllerRef.current?.abort()
      window.speechSynthesis?.cancel()
      processorRef.current?.disconnect()
      sourceRef.current?.disconnect()
      muteRef.current?.disconnect()
      streamRef.current?.getTracks().forEach(track => track.stop())
      void contextRef.current?.close()
    }
  }, [])

  useEffect(() => {
    turnsRef.current = turns
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const setTurnText = (id: number, content: string, changes: Partial<Turn> = {}) => {
    const next = turnsRef.current.map(turn => turn.id === id ? { ...turn, content, ...changes } : turn)
    turnsRef.current = next
    setTurns(next)
  }

  const listenForBargeIn = () => {
    if (!voiceEnabledRef.current || !window.speechSynthesis) return
    responseIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    window.speechSynthesis.cancel()
    speechQueueRef.current = []
    speechPendingRef.current = ''
    speakingRef.current = false
    const partialId = assistantIdRef.current
    if (partialId !== null) {
      const partial = turnsRef.current.find(turn => turn.id === partialId)
      if (partial && !partial.content.trim()) {
        const next = turnsRef.current.filter(turn => turn.id !== partialId)
        turnsRef.current = next
        setTurns(next)
      } else if (partial) {
        setTurnText(partialId, partial.content, { interrupted: true })
      }
    }
    responseDoneRef.current = true
    assistantIdRef.current = null
    updatePhase('recording', 'I’m listening. Go ahead.')
  }

  const speakNext = (responseId: number) => {
    if (responseId !== responseIdRef.current || speakingRef.current) return
    const text = speechQueueRef.current.shift()
    if (!text) {
      if (responseDoneRef.current) {
        preRollRef.current = []
        updatePhase('listening', 'I’m here. Take your time.')
      }
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = 0.96
    const voices = window.speechSynthesis.getVoices()
    utterance.voice = voices.find(voice => voice.lang.toLowerCase().startsWith('en') && /natural|aria|jenny|guy|zira/i.test(voice.name))
      ?? voices.find(voice => voice.lang.toLowerCase().startsWith('en'))
      ?? null
    utterance.onstart = () => {
      if (responseId !== responseIdRef.current) return
      speakingRef.current = true
      updatePhase('speaking', 'I’m with you. You can interrupt me any time.')
    }
    utterance.onend = () => {
      if (responseId !== responseIdRef.current) return
      speakingRef.current = false
      speakNext(responseId)
    }
    utterance.onerror = () => {
      if (responseId !== responseIdRef.current) return
      speakingRef.current = false
      speakNext(responseId)
    }
    speakingRef.current = true
    updatePhase('speaking', 'I’m with you. You can interrupt me any time.')
    window.speechSynthesis.speak(utterance)
  }

  const enqueueSpeech = (text: string, responseId: number) => {
    if (!voiceEnabledRef.current || !('speechSynthesis' in window)) return
    speechPendingRef.current += text
    const parsed = extractSentences(speechPendingRef.current)
    speechPendingRef.current = parsed.remaining
    speechQueueRef.current.push(...parsed.sentences)
    speakNext(responseId)
  }

  const respondToTurn = async (userText: string) => {
    const userTurn: Turn = { id: ++nextIdRef.current, role: 'user', content: userText, complete: true }
    const assistantTurn: Turn = { id: ++nextIdRef.current, role: 'assistant', content: '' }
    const priorTurns = turnsRef.current.filter(turn => turn.complete).slice(-10)
    const nextTurns = [...priorTurns, userTurn, assistantTurn]
    turnsRef.current = nextTurns
    setTurns(nextTurns)
    assistantIdRef.current = assistantTurn.id
    const responseId = ++responseIdRef.current
    responseDoneRef.current = false
    speechQueueRef.current = []
    speechPendingRef.current = ''
    const controller = new AbortController()
    controllerRef.current = controller
    updatePhase('thinking', 'Thinking with you...')

    try {
      await streamTalk(
        nextTurns.filter(turn => turn.complete || turn.id === userTurn.id).map(({ role, content }) => ({ role, content })),
        event => {
          if (responseId !== responseIdRef.current) return
          if (event.type === 'meta') {
            if (event.memory_used && assistantIdRef.current !== null) {
              const current = turnsRef.current.find(turn => turn.id === assistantIdRef.current)
              if (current) setTurnText(current.id, current.content, { memoryUsed: true })
            }
          } else if (event.type === 'token') {
            const current = turnsRef.current.find(turn => turn.id === assistantTurn.id)
            if (!current) return
            setTurnText(assistantTurn.id, current.content + event.text)
            enqueueSpeech(event.text, responseId)
          } else if (event.type === 'done') {
            const current = turnsRef.current.find(turn => turn.id === assistantTurn.id)
            if (current) setTurnText(assistantTurn.id, current.content, { complete: true })
            if (speechPendingRef.current.trim()) {
              speechQueueRef.current.push(speechPendingRef.current.trim())
              speechPendingRef.current = ''
              speakNext(responseId)
            }
            responseDoneRef.current = true
            if (!speakingRef.current && !speechQueueRef.current.length) {
              preRollRef.current = []
              updatePhase('listening', 'I’m here. Take your time.')
            }
          } else if (event.type === 'error') {
            const current = turnsRef.current.find(turn => turn.id === assistantTurn.id)
            if (current) setTurnText(assistantTurn.id, current.content || 'I’m having trouble reaching my local model just now.', { complete: true })
            responseDoneRef.current = true
            updatePhase('error', event.message)
          }
        },
        controller.signal,
      )
    } catch (error) {
      if (controller.signal.aborted) return
      const current = turnsRef.current.find(turn => turn.id === assistantTurn.id)
      if (current) setTurnText(assistantTurn.id, current.content || 'I’m having trouble reaching my local model just now.', { complete: true })
      responseDoneRef.current = true
      updatePhase('error', error instanceof Error ? error.message : 'I couldn’t connect just now.')
    }
  }

  const processInterimSpeech = () => {
    if (interimTaskRef.current || finalizingRef.current || phaseRef.current !== 'recording') return
    const end = utteranceSamplesRef.current
    if (end < interimNextAtRef.current) return
    const start = Math.max(0, interimLastEndRef.current - Math.round(sampleRateRef.current * INTERIM_OVERLAP_SECONDS))
    const audio = concatenateFrames(utteranceRef.current).slice(start, end)
    if (audio.length < sampleRateRef.current) return

    setStatus('Recognizing your words...')
    const task = transcribePcm(audio, sampleRateRef.current, message => setStatus(message)).then(transcript => {
      if (!transcript.trim()) return
      const merged = mergeTranscript(interimTextRef.current, transcript)
      interimTextRef.current = merged
      interimLastEndRef.current = end
      interimNextAtRef.current = end + Math.round(sampleRateRef.current * INTERIM_STRIDE_SECONDS)
      setLiveDraft(merged)
    }).catch(error => {
      interimLastEndRef.current = end
      interimNextAtRef.current = end + Math.round(sampleRateRef.current * INTERIM_STRIDE_SECONDS)
      setStatus(error instanceof Error ? `Local speech recognition is catching up: ${error.message}` : 'Local speech recognition is catching up.')
    }).finally(() => {
      interimTaskRef.current = null
      if (phaseRef.current === 'recording' && !finalizingRef.current) {
        setStatus('Keep talking. Your words are appearing below.')
        processInterimSpeech()
      }
    })
    interimTaskRef.current = task
  }

  const finishUtterance = async () => {
    if (finalizingRef.current || !utteranceSamplesRef.current) return
    finalizingRef.current = true
    updatePhase('transcribing', 'Making out what you said...')
    try {
      if (interimTaskRef.current) await interimTaskRef.current
      const audio = concatenateFrames(utteranceRef.current)
      let text = ''
      try {
        text = await transcribePcm(audio, sampleRateRef.current, message => setStatus(message))
      } catch (error) {
        if (!interimTextRef.current) throw error
      }
      const finalText = text.trim() || interimTextRef.current.trim()
      utteranceRef.current = []
      utteranceSamplesRef.current = 0
      interimLastEndRef.current = 0
      interimNextAtRef.current = 0
      interimTextRef.current = ''
      setLiveDraft('')
      if (finalText) await respondToTurn(finalText)
      else updatePhase('listening', 'I didn’t catch that. Try again when you’re ready.')
    } catch (error) {
      updatePhase('error', error instanceof Error ? error.message : 'I couldn’t transcribe that just now.')
    } finally {
      finalizingRef.current = false
    }
  }

  const onAudioFrame = (frame: Float32Array) => {
    if (!listeningRef.current) return
    const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, frame.length))
    const now = performance.now()
    const phase = phaseRef.current
    const preroll = preRollRef.current
    preroll.push(frame)
    const prerollLimit = Math.ceil(sampleRateRef.current * PREROLL_MS / frame.length)
    if (preroll.length > prerollLimit) preroll.splice(0, preroll.length - prerollLimit)

    if ((phase === 'speaking' || phase === 'thinking') && rms > SPEECH_THRESHOLD) {
      speechFramesRef.current += 1
      if (speechFramesRef.current >= 3) {
        speechFramesRef.current = 0
        utteranceRef.current = [...preroll]
        utteranceSamplesRef.current = utteranceRef.current.reduce((total, item) => total + item.length, 0)
        interimLastEndRef.current = 0
        interimNextAtRef.current = Math.round(sampleRateRef.current * INTERIM_WINDOW_SECONDS)
        interimTextRef.current = ''
        setLiveDraft('')
        lastSpeechAtRef.current = now
        utteranceStartedAtRef.current = now
        listenForBargeIn()
      }
      return
    }

    if (phase === 'listening') {
      if (rms > SPEECH_THRESHOLD) {
        utteranceRef.current = [...preroll]
        utteranceSamplesRef.current = utteranceRef.current.reduce((total, item) => total + item.length, 0)
        interimLastEndRef.current = 0
        interimNextAtRef.current = Math.round(sampleRateRef.current * INTERIM_WINDOW_SECONDS)
        interimTextRef.current = ''
        setLiveDraft('')
        lastSpeechAtRef.current = now
        utteranceStartedAtRef.current = now
        speechFramesRef.current = 0
        updatePhase('recording', 'I’m listening...')
      }
      return
    }

    if (phase !== 'recording') return
    utteranceRef.current.push(frame)
    utteranceSamplesRef.current += frame.length
    if (rms > SPEECH_THRESHOLD) lastSpeechAtRef.current = now
    if (utteranceSamplesRef.current >= interimNextAtRef.current) processInterimSpeech()
    if (now - lastSpeechAtRef.current > SILENCE_MS || now - utteranceStartedAtRef.current > MAX_TURN_MS) {
      void finishUtterance()
    }
  }

  const startListening = async () => {
    if (listeningRef.current) return
    setStatus('Allow microphone access to start talking.')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (error) {
      updatePhase('error', error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser to talk.'
        : 'I couldn’t access your microphone. Check the browser’s site settings.')
      return
    }

    try {
      const context = new AudioContext()
      await context.resume()
      const source = context.createMediaStreamSource(stream)
      const mute = context.createGain()
      mute.gain.value = 0
      streamRef.current = stream
      contextRef.current = context
      sourceRef.current = source
      muteRef.current = mute
      sampleRateRef.current = context.sampleRate
      preRollRef.current = []

      const onFrame = (frame: Float32Array) => onAudioFrame(frame)
      if (context.audioWorklet) {
        const code = `class TalkCapture extends AudioWorkletProcessor { constructor(){super();this.parts=[];this.length=0;} process(inputs,outputs){const input=inputs[0]?.[0];const output=outputs[0]?.[0];if(input){const copy=input.slice();this.parts.push(copy);this.length+=copy.length;if(this.length>=4096){const block=new Float32Array(this.length);let at=0;for(const part of this.parts){block.set(part,at);at+=part.length;}this.parts=[];this.length=0;this.port.postMessage(block,[block.buffer]);}}if(output)output.fill(0);return true;} } registerProcessor('talk-capture',TalkCapture);`
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
        try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
        const processor = new AudioWorkletNode(context, 'talk-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
        processor.port.onmessage = event => onFrame(event.data as Float32Array)
        processorRef.current = processor
        source.connect(processor)
        processor.connect(mute)
      } else {
        const processor = context.createScriptProcessor(4096, 1, 1)
        processor.onaudioprocess = event => {
          onFrame(event.inputBuffer.getChannelData(0).slice())
          event.outputBuffer.getChannelData(0).fill(0)
        }
        processorRef.current = processor
        source.connect(processor)
        processor.connect(mute)
      }
      mute.connect(context.destination)
      listeningRef.current = true
      updatePhase('listening', modelReady ? 'I’m here. Take your time.' : 'Loading local speech model...')
    } catch (error) {
      stream.getTracks().forEach(track => track.stop())
      updatePhase('error', error instanceof Error ? error.message : 'Could not start the microphone.')
    }
  }

  const stopListening = () => {
    listeningRef.current = false
    responseIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    window.speechSynthesis?.cancel()
    speechQueueRef.current = []
    speechPendingRef.current = ''
    speakingRef.current = false
    responseDoneRef.current = true
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    muteRef.current?.disconnect()
    streamRef.current?.getTracks().forEach(track => track.stop())
    void contextRef.current?.close()
    processorRef.current = null
    sourceRef.current = null
    muteRef.current = null
    streamRef.current = null
    contextRef.current = null
    utteranceRef.current = []
    utteranceSamplesRef.current = 0
    updatePhase('idle', modelReady ? 'Your voice stays on this device.' : 'Local Whisper is still loading.')
  }

  const clearConversation = () => {
    stopListening()
    turnsRef.current = []
    setTurns([])
    assistantIdRef.current = null
  }

  const toggleVoice = () => {
    const next = !voiceEnabledRef.current
    voiceEnabledRef.current = next
    setVoiceEnabled(next)
    if (!next) {
      window.speechSynthesis?.cancel()
      speechQueueRef.current = []
      speechPendingRef.current = ''
      speakingRef.current = false
      if (phaseRef.current === 'speaking') updatePhase('thinking', 'I’ll keep listening.')
    }
  }

  const statusLabel = phase === 'loading' ? 'Preparing your private voice space'
    : phase === 'listening' ? 'Listening'
      : phase === 'recording' ? 'I’m listening'
        : phase === 'transcribing' ? 'Listening back'
          : phase === 'thinking' ? 'Thinking'
            : phase === 'speaking' ? 'Talking'
              : phase === 'error' ? 'A pause'
                : 'Ready when you are'

  return <section className="page-content talk-page">
    <header className="talk-heading"><div className="eyebrow">A QUIETER KIND OF CONVERSATION</div><h1>Talk to Me</h1><p>You can start anywhere. I’m listening.</p></header>
    <div className={`talk-presence ${phase === 'speaking' || phase === 'recording' ? 'is-active' : ''} ${phase === 'thinking' || phase === 'transcribing' ? 'is-working' : ''}`} aria-live="polite">
      <AudioLines size={24} strokeWidth={1.5} />
      <span>{statusLabel}</span>
    </div>
    <div className={`talk-status phase-${phase}`} role="status"><span className="talk-status-dot" /><p>{status}</p></div>
    <div className="talk-controls">
      <div className="talk-mic-control">
        <button className={`talk-mic ${listeningRef.current ? 'is-listening' : ''}`} onClick={() => listeningRef.current ? stopListening() : void startListening()} aria-label={listeningRef.current ? 'End conversation' : 'Start talking'} title={listeningRef.current ? 'End conversation' : 'Start talking'}>
          {listeningRef.current ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <span>{listeningRef.current ? 'End conversation' : 'Start talking'}</span>
      </div>
      <div className="talk-secondary-controls">
        <button className="talk-icon-button" onClick={toggleVoice} aria-label={voiceEnabled ? 'Mute voice replies' : 'Enable voice replies'} title={voiceEnabled ? 'Mute voice replies' : 'Enable voice replies'}>
          {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <button className="talk-icon-button" onClick={clearConversation} aria-label="Clear conversation" title="Clear conversation"><RotateCcw size={17} /></button>
      </div>
    </div>
    <div className="talk-privacy"><span className="talk-privacy-dot" /><span>Speech is transcribed on this device. Your recent conversation stays in this tab.</span></div>
    <div className="talk-transcript" ref={scrollRef} aria-live="polite" aria-label="Conversation">
      {turns.map(turn => <article className={`talk-turn ${turn.role === 'assistant' ? 'assistant-turn' : 'user-turn'}`} key={turn.id}>
        <span className="talk-turn-label">{turn.role === 'assistant' ? 'MEMORY' : 'YOU'}{turn.memoryUsed && <small>REMEMBERED</small>}{turn.interrupted && <small>INTERRUPTED</small>}</span>
        <p>{turn.content || (turn.role === 'assistant' ? '…' : '')}</p>
      </article>)}
      {liveDraft && <article className="talk-turn user-turn live-draft-turn"><span className="talk-turn-label">YOU <small>LIVE</small></span><p>{liveDraft}</p></article>}
      {!turns.length && <div className="talk-empty"><span className="eyebrow">NO SCRIPT NEEDED</span><p>How has today been?</p></div>}
    </div>
  </section>
}