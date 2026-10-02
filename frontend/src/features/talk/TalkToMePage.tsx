import { useEffect, useRef, useState } from 'react'
import { AudioLines, Mic, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { talkTranscriptionService } from '../../services/talkTranscriptionService'
import { streamTalk, type TalkMessage } from '../../services/talkService'
import { WordReveal } from '../../components/WordReveal'
import { selectWarmFemaleVoice } from './talkVoice'
import './TalkToMePage.css'

type Phase = 'idle' | 'loading' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'error'
type Turn = TalkMessage & { id: number; complete?: boolean; memoryUsed?: boolean; interrupted?: boolean }

const MAX_TURN_MS = 35_000
const SPEECH_THRESHOLD = 0.018
const PREROLL_MS = 420
const INTERIM_WINDOW_SECONDS = 1.8
const INTERIM_STRIDE_SECONDS = 1.4
const INTERIM_OVERLAP_SECONDS = 1.2

function concatenateFrames(frames: Float32Array[], startSample = 0, endSample?: number) {
  const totalSamples = frames.reduce((total, frame) => total + frame.length, 0)
  const start = Math.max(0, Math.min(startSample, totalSamples))
  const end = Math.max(start, Math.min(endSample ?? totalSamples, totalSamples))
  const audio = new Float32Array(end - start)
  let offset = 0
  for (const frame of frames) {
    const frameEnd = offset + frame.length
    const copyStart = Math.max(start, offset)
    const copyEnd = Math.min(end, frameEnd)
    if (copyStart < copyEnd) {
      audio.set(frame.subarray(copyStart - offset, copyEnd - offset), copyStart - start)
    }
    offset += frame.length
    if (offset >= end) break
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
  const collapseRepeatedPhrases = (value: string) => {
    const words = value.trim().split(/\s+/).filter(Boolean)
    const normalize = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

    // Speech models can repeat a phrase inside a result as well as across
    // overlapping windows. Collapse adjacent repeats of four or more words.
    for (let length = Math.min(Math.floor(words.length / 2), 32); length >= 4; length--) {
      for (let start = 0; start + length * 2 <= words.length; start++) {
        const first = words.slice(start, start + length).map(normalize)
        const second = words.slice(start + length, start + length * 2).map(normalize)
        if (first.every((word, index) => word && word === second[index])) {
          words.splice(start + length, length)
          return collapseRepeatedPhrases(words.join(' '))
        }
      }
    }
    return words.join(' ')
  }

  const cleanCurrent = collapseRepeatedPhrases(current)
  const cleanNext = collapseRepeatedPhrases(next)
  const existing = cleanCurrent.trim().split(/\s+/).filter(Boolean)
  const incoming = cleanNext.trim().split(/\s+/).filter(Boolean)
  const normalize = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  for (let length = Math.min(existing.length, incoming.length, 32); length > 0; length--) {
    const left = existing.slice(-length).map(normalize)
    const right = incoming.slice(0, length).map(normalize)
    if (left.every((word, index) => word && word === right[index])) {
      const addition = incoming.slice(length).join(' ')
      const merged = addition ? `${cleanCurrent}${cleanCurrent && !/[\s\n]$/.test(cleanCurrent) ? ' ' : ''}${addition}` : cleanCurrent
      return collapseRepeatedPhrases(merged)
    }
  }
  const addition = incoming.join(' ')
  const merged = addition ? `${cleanCurrent}${cleanCurrent && !/[\s\n]$/.test(cleanCurrent) ? ' ' : ''}${addition}` : cleanCurrent
  return collapseRepeatedPhrases(merged)
}

function isLikelySpeechEcho(recognized: string, spoken: string) {
  const normalize = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  const recognizedWords = normalize(recognized)
  const spokenWords = normalize(spoken)
  if (recognizedWords.length < 4 || spokenWords.length < 4) return false

  const phrase = recognizedWords.join(' ')
  const spokenText = spokenWords.join(' ')
  return spokenText.includes(phrase) || phrase.includes(spokenText)
}

export function TalkToMePage({ voiceReplies, speechRate, onVoiceRepliesChange }: { voiceReplies: boolean; speechRate: number; onVoiceRepliesChange: (enabled: boolean) => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('Your voice stays on this device.')
  const [liveDraft, setLiveDraft] = useState('')
  const [voiceEnabled, setVoiceEnabled] = useState(voiceReplies)
  const [modelReady, setModelReady] = useState(false)
  const [pushHeld, setPushHeld] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const muteRef = useRef<GainNode | null>(null)
  const sampleRateRef = useRef(16_000)
  const phaseRef = useRef<Phase>('idle')
  const listeningRef = useRef(false)
  const pushHeldRef = useRef(false)
  const spacePushActiveRef = useRef(false)
  const microphoneStartingRef = useRef(false)
  const pushHandlersRef = useRef({ press: () => {}, release: () => {} })
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
  const speakingTextRef = useRef('')
  const interruptedSpeechRef = useRef('')
  const voiceEnabledRef = useRef(voiceReplies)
  const speechRateRef = useRef(speechRate)
  voiceEnabledRef.current = voiceReplies
  speechRateRef.current = speechRate
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const updatePhase = (next: Phase, nextStatus?: string) => {
    phaseRef.current = next
    setPhase(next)
    if (nextStatus) setStatus(nextStatus)
  }

  useEffect(() => {
    let active = true
    const refreshVoices = () => {
      voicesRef.current = window.speechSynthesis?.getVoices() ?? []
    }
    refreshVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', refreshVoices)
    updatePhase('loading', 'Preparing Parakeet TDT on the configured backend...')
    void talkTranscriptionService.prepare(message => {
      if (active) setStatus(message)
    }).then(() => {
      if (!active) return
      setModelReady(true)
      if (phaseRef.current === 'loading') updatePhase('idle', 'Parakeet TDT is ready on the backend. Talk whenever you like.')
    }).catch(error => {
      if (active) {
        updatePhase('error', error instanceof Error
          ? `Parakeet TDT is unavailable: ${error.message}`
          : 'Parakeet TDT is unavailable.')
      }
    })
    return () => {
      active = false
      listeningRef.current = false
      controllerRef.current?.abort()
      window.speechSynthesis?.cancel()
      window.speechSynthesis?.removeEventListener('voiceschanged', refreshVoices)
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
    if (!listeningRef.current) return
    interruptedSpeechRef.current = speakingTextRef.current
    speakingTextRef.current = ''
    responseIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    window.speechSynthesis?.cancel()
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
        updateReadyPhase()
      }
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    speakingTextRef.current = text
    utterance.lang = 'en-US'
    utterance.rate = speechRateRef.current
    utterance.pitch = 1.02
    voicesRef.current = window.speechSynthesis.getVoices()
    utterance.voice = selectWarmFemaleVoice(voicesRef.current)
    utterance.onstart = () => {
      if (responseId !== responseIdRef.current) return
      speakingRef.current = true
      updatePhase('speaking', 'I’m with you. You can interrupt me any time.')
    }
    utterance.onend = () => {
      if (responseId !== responseIdRef.current) return
      speakingRef.current = false
      speakingTextRef.current = ''
      speakNext(responseId)
    }
    utterance.onerror = () => {
      if (responseId !== responseIdRef.current) return
      speakingRef.current = false
      speakingTextRef.current = ''
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
              updateReadyPhase()
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
    const audio = concatenateFrames(utteranceRef.current, start, end)
    if (audio.length < sampleRateRef.current) return

    setStatus('Recognizing your words...')
    const task = talkTranscriptionService.transcribe(audio, sampleRateRef.current, message => setStatus(message)).then(transcript => {
      if (!transcript.trim()) return
      const merged = mergeTranscript(interimTextRef.current, transcript)
      interimTextRef.current = merged
      interimLastEndRef.current = end
      interimNextAtRef.current = end + Math.round(sampleRateRef.current * INTERIM_STRIDE_SECONDS)
      setLiveDraft(merged)
    }).catch(error => {
      interimLastEndRef.current = end
      interimNextAtRef.current = end + Math.round(sampleRateRef.current * INTERIM_STRIDE_SECONDS)
      setStatus(error instanceof Error ? `Parakeet is catching up: ${error.message}` : 'Parakeet is catching up.')
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
      const totalSamples = utteranceRef.current.reduce((total, frame) => total + frame.length, 0)
      const overlapSamples = Math.round(sampleRateRef.current * INTERIM_OVERLAP_SECONDS)
      const tailStart = interimTextRef.current
        ? Math.max(0, interimLastEndRef.current - overlapSamples)
        : 0
      let tailText = ''
      if (totalSamples - tailStart >= sampleRateRef.current * 0.35) {
        const tail = concatenateFrames(utteranceRef.current, tailStart, totalSamples)
        try {
          tailText = await talkTranscriptionService.transcribe(tail, sampleRateRef.current, message => setStatus(message))
        } catch (error) {
          if (!interimTextRef.current) throw error
        }
      }
      const finalText = mergeTranscript(interimTextRef.current, tailText.trim())
      utteranceRef.current = []
      utteranceSamplesRef.current = 0
      interimLastEndRef.current = 0
      interimNextAtRef.current = 0
      interimTextRef.current = ''
      setLiveDraft('')
      const interruptedSpeech = interruptedSpeechRef.current
      interruptedSpeechRef.current = ''
      if (isLikelySpeechEcho(finalText, interruptedSpeech)) {
        updateReadyPhase()
        return
      }
      if (finalText) await respondToTurn(finalText)
      else updatePhase('idle', 'I didn’t catch that. Hold Space or press and hold the mic to try again.')
    } catch (error) {
      updatePhase('error', error instanceof Error ? error.message : 'I couldn’t transcribe that just now.')
    } finally {
      finalizingRef.current = false
    }
  }

  const updateReadyPhase = () => {
    updatePhase('idle', 'Hold Space or press and hold the mic to speak.')
  }

  const releaseAudioCapture = () => {
    listeningRef.current = false
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
  }

  const releasePushToTalk = () => {
    pushHeldRef.current = false
    setPushHeld(false)
    if (!listeningRef.current) return

    const hasSpeech = utteranceSamplesRef.current > 0
    releaseAudioCapture()
    if (hasSpeech) {
      void finishUtterance()
    } else if (phaseRef.current === 'speaking') {
      setStatus('I’m talking. Hold Space whenever you want to jump in.')
    } else if (phaseRef.current === 'thinking') {
      setStatus('I’m thinking. Hold Space if you want to add something.')
    } else {
      updateReadyPhase()
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

    const isBargeIn = phase === 'speaking'
    const speechThreshold = isBargeIn ? SPEECH_THRESHOLD * 1.8 : SPEECH_THRESHOLD
    if ((phase === 'speaking' || phase === 'thinking') && rms > speechThreshold) {
      speechFramesRef.current += 1
      if (speechFramesRef.current >= (isBargeIn ? 5 : 3)) {
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
    if (now - utteranceStartedAtRef.current > MAX_TURN_MS) releasePushToTalk()
  }

  const startListening = async () => {
    if (listeningRef.current || microphoneStartingRef.current) return
    microphoneStartingRef.current = true
    if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') {
      setStatus('Opening the mic so you can jump in...')
    } else {
      updatePhase('loading', 'Opening your microphone...')
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (error) {
      updatePhase('error', error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser to talk.'
        : 'I couldn’t access your microphone. Check the browser’s site settings.')
      microphoneStartingRef.current = false
      pushHeldRef.current = false
      setPushHeld(false)
      return
    }

    if (!pushHeldRef.current) {
      stream.getTracks().forEach(track => track.stop())
      microphoneStartingRef.current = false
      updateReadyPhase()
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
      microphoneStartingRef.current = false
      listeningRef.current = true
      if (phaseRef.current !== 'speaking' && phaseRef.current !== 'thinking') {
        updatePhase('listening', modelReady ? 'Hold Space and speak, or press and hold the mic.' : 'Loading Parakeet TDT on the backend...')
      }
      if (!pushHeldRef.current) releasePushToTalk()
    } catch (error) {
      stream.getTracks().forEach(track => track.stop())
      microphoneStartingRef.current = false
      pushHeldRef.current = false
      setPushHeld(false)
      updatePhase('error', error instanceof Error ? error.message : 'Could not start the microphone.')
    }
  }

  const pressPushToTalk = () => {
    if (pushHeldRef.current) return
    pushHeldRef.current = true
    setPushHeld(true)
    void startListening()
  }

  const stopListening = () => {
    pushHeldRef.current = false
    setPushHeld(false)
    responseIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    window.speechSynthesis?.cancel()
    speechQueueRef.current = []
    speechPendingRef.current = ''
    speakingRef.current = false
    speakingTextRef.current = ''
    interruptedSpeechRef.current = ''
    responseDoneRef.current = true
    releaseAudioCapture()
    utteranceRef.current = []
    utteranceSamplesRef.current = 0
    updatePhase('idle', modelReady ? 'Ready for your next thought.' : 'Parakeet TDT is still loading on the backend.')
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
    onVoiceRepliesChange(next)
    if (!next) {
      window.speechSynthesis?.cancel()
      speechQueueRef.current = []
      speechPendingRef.current = ''
      speakingRef.current = false
      speakingTextRef.current = ''
      if (phaseRef.current === 'speaking') {
        updatePhase(listeningRef.current ? 'listening' : 'idle', 'Voice replies are muted. I’m still here with you.')
      }

      useEffect(() => {
        setVoiceEnabled(voiceReplies)
        voiceEnabledRef.current = voiceReplies
      }, [voiceReplies])
    } else {
      setStatus('Voice replies are on.')
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

  pushHandlersRef.current = { press: pressPushToTalk, release: releasePushToTalk }

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => target instanceof HTMLElement
      && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [role="textbox"], audio, video')))
    const isOtherControl = (target: EventTarget | null) => target instanceof HTMLElement
      && Boolean(target.closest('button:not([data-push-to-talk]), a'))

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target) || isOtherControl(event.target)) return
      event.preventDefault()
      spacePushActiveRef.current = true
      pushHandlersRef.current.press()
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spacePushActiveRef.current) return
      event.preventDefault()
      spacePushActiveRef.current = false
      pushHandlersRef.current.release()
    }
    const releaseOnBlur = () => {
      spacePushActiveRef.current = false
      if (pushHeldRef.current) pushHandlersRef.current.release()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseOnBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseOnBlur)
    }
  }, [])

  return <section className="page-content talk-page">
    <header className="talk-heading"><div className="eyebrow">A QUIETER KIND OF CONVERSATION</div><h1>Talk to Me</h1><p>Hold Space or press and hold the mic. Release to send.</p></header>
      <div className={`talk-presence ${phase === 'speaking' || phase === 'recording' ? 'is-active' : ''} ${phase === 'thinking' || phase === 'transcribing' ? 'is-working' : ''}`} aria-live="polite">
      <AudioLines size={24} strokeWidth={1.5} />
      <span>{statusLabel}</span>
    </div>
    <div className={`talk-voice-state ${voiceEnabled ? 'is-enabled' : 'is-muted'} ${phase === 'speaking' ? 'is-talking' : ''}`} role="status" aria-live="polite">
      {voiceEnabled
        ? phase === 'speaking' ? 'Voice replies on · I’m talking now' : 'Voice replies on · I can speak my replies'
        : 'Voice replies muted · I’ll keep listening'}
    </div>
    <div className={`talk-status phase-${phase}`} role="status"><span className="talk-status-dot" /><p>{status}</p></div>
    <div className="talk-controls">
      <div className="talk-mic-control">
        <button
          className={`talk-mic ${pushHeld ? 'is-listening' : ''}`}
          data-push-to-talk
          onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            pushHandlersRef.current.press()
          }}
          onPointerUp={() => pushHandlersRef.current.release()}
          onPointerCancel={() => pushHandlersRef.current.release()}
          onLostPointerCapture={() => pushHandlersRef.current.release()}
          onContextMenu={event => event.preventDefault()}
          aria-pressed={pushHeld}
          aria-label={pushHeld ? 'Release to send' : 'Hold to talk'}
          title="Hold this button or Space to talk"
        >
          <Mic size={22} />
        </button>
        <span>{pushHeld ? 'Release to send' : 'Hold to talk'}</span>
      </div>
      <div className="talk-secondary-controls">
        <button className="talk-icon-button" onClick={toggleVoice} aria-pressed={voiceEnabled} aria-label={voiceEnabled ? 'Mute voice replies' : 'Enable voice replies'} title={voiceEnabled ? 'Mute voice replies' : 'Enable voice replies'}>
          {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <button className="talk-icon-button" onClick={clearConversation} aria-label="Clear conversation" title="Clear conversation"><RotateCcw size={17} /></button>
      </div>
    </div>
    <div className="talk-privacy"><span className="talk-privacy-dot" /><span>Talk audio is sent to your configured backend for Parakeet TDT transcription. The model downloads from Hugging Face there on first use.</span></div>
    <div className="talk-transcript" ref={scrollRef} aria-live="polite" aria-label="Conversation">
      {turns.map(turn => <article className={`talk-turn ${turn.role === 'assistant' ? 'assistant-turn' : 'user-turn'}`} key={turn.id}>
        <span className="talk-turn-label">{turn.role === 'assistant' ? 'MEMORY' : 'YOU'}{turn.memoryUsed && <small>REMEMBERED</small>}{turn.interrupted && <small>INTERRUPTED</small>}</span>
        <p>{turn.role === 'assistant'
          ? turn.content ? <WordReveal text={turn.content} /> : '…'
          : turn.content}</p>
      </article>)}
      {liveDraft && <article className="talk-turn user-turn live-draft-turn"><span className="talk-turn-label">YOU <small>LIVE</small></span><p>{liveDraft}</p></article>}
      {!turns.length && <div className="talk-empty"><span className="eyebrow">NO SCRIPT NEEDED</span><p>How has today been?</p></div>}
    </div>
  </section>
}
