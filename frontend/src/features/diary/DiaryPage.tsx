import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArtificialIntelligence, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Code as Code2, Compass, Feather, List, Mic, MicOff, Paperclip, Add as Plus, RotateCcw, Search, Sparkles, Underline, Cancel as X } from '../../components/icons'
import type { DiaryEntry } from '../../types'
import { aiService } from '../../services/aiService'
import { preloadWhisper, transcribePcm } from '../../services/localTranscriptionService'
import { type AudioFrame, mergeOverlappingTranscript, sanitizeTranscribedText } from './transcript'
import { PageHeading } from '../../components/PageHeading'
import { energyOptions, moodOptions } from '../../services/userPreferences'

function NotebookPreferenceSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <details className="notebook-preference-select">
    <summary aria-label={`${label}: ${value}. Choose ${label.toLowerCase()}`}>
      <span>{value}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </summary>
    <div className="notebook-preference-options" role="radiogroup" aria-label={`${label} options`}>
      {options.map(option => <label key={option} className={value === option ? 'is-selected' : ''}>
        <input type="radio" name={id} value={option} checked={value === option} onChange={() => onChange(option)} />
        <span>{option}</span>
        {value === option && <Check size={14} aria-hidden="true" />}
      </label>)}
    </div>
  </details>
}

function entryDisplayTitle(entry: DiaryEntry) {
  if (entry.title.trim()) return entry.title
  const firstLine = entry.content.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/, 1)[0] ?? ''
  const words = firstLine.split(' ').filter(Boolean)
  const title = words.slice(0, 9).join(' ').replace(/[,:;.!?]+$/, '')
  if (!title) return 'A moment from your diary'
  return `${title[0].toUpperCase()}${title.slice(1)}${words.length > 9 ? '…' : ''}`
}

export function DiaryPage({ diary, selected, onSelect, onSave, loadError, defaultMood, defaultEnergy, spellCheck, editorTextSize, onDelete }: { diary: DiaryEntry[]; selected: DiaryEntry | null; onSelect: (entry: DiaryEntry | null) => void; onSave: (entry: DiaryEntry) => Promise<DiaryEntry>; loadError: string; defaultMood: string; defaultEnergy: string; spellCheck: boolean; editorTextSize: number; onDelete: (entry: DiaryEntry) => Promise<void> }) {
  const [search, setSearch] = useState('')
  const [attachment, setAttachment] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [saveError, setSaveError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [feedbackError, setFeedbackError] = useState('')
  const [feedbackAction, setFeedbackAction] = useState<'dig_deeper' | 'get_perspective' | null>(null)
  const [feedbackKind, setFeedbackKind] = useState<'dig_deeper' | 'get_perspective' | null>(null)
  const [inlineDigDeeper, setInlineDigDeeper] = useState(false)
  const [inlinePrompt, setInlinePrompt] = useState('')
  const feedbackRequestRef = useRef(0)
  const saveRequestRef = useRef(0)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const selectedEntryRef = useRef(selected)
  selectedEntryRef.current = selected
  const dictationStreamRef = useRef<MediaStream | null>(null)
  const dictationContextRef = useRef<AudioContext | null>(null)
  const dictationSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const dictationProcessorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const dictationMuteRef = useRef<GainNode | null>(null)
  const dictationFramesRef = useRef<AudioFrame[]>([])
  const dictationSamplesRef = useRef(0)
  const dictationSampleRateRef = useRef(16_000)
  const dictationTranscribedUntilRef = useRef(0)
  const dictationTranscriptRef = useRef('')
  const dictationInferenceRef = useRef(false)
  const dictationModelReadyRef = useRef(false)
  const dictationStopRequestedRef = useRef(false)
  const dictationTimerRef = useRef<number | null>(null)
  const dictationActiveRef = useRef(false)
  const lastDictationInsertionRef = useRef<{ entryId: string; start: number; text: string } | null>(null)
  const [dictating, setDictating] = useState(false)
  const [dictationMessage, setDictationMessage] = useState('')
  const [canUndoDictation, setCanUndoDictation] = useState(false)

  const persistEntry = (entry: DiaryEntry) => {
    const requestId = ++saveRequestRef.current
    setSaveState('saving')
    setSaveError('')
    void onSave(entry).then(saved => {
      if (requestId !== saveRequestRef.current) return
      selectedEntryRef.current = saved
      onSelect(saved)
      setSaveState('saved')
    }).catch(error => {
      if (requestId !== saveRequestRef.current) return
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : 'Check the backend connection and try again.')
    })
  }

  const commitDictationDraft = () => {
    const current = selectedEntryRef.current
    if (!current || current.id !== 'new' || (!current.title.trim() && !current.content.trim())) return
    const saved = { ...current, id: `d${Date.now()}` }
    selectedEntryRef.current = saved
    onSelect(saved)
    persistEntry(saved)
  }

  const appendDictationText = (text: string) => {
    const current = selectedEntryRef.current
    const addition = sanitizeTranscribedText(text)
    if (!current || !addition) return
    const separator = current.content && !/[\s\n]$/.test(current.content) ? ' ' : ''
    const insertion = `${separator}${addition}`
    const updated = { ...current, content: `${current.content}${insertion}` }
    if (updated.id === 'new') updated.id = `d${Date.now()}`
    lastDictationInsertionRef.current = { entryId: updated.id, start: current.content.length, text: insertion }
    setCanUndoDictation(true)
    feedbackRequestRef.current += 1
    setInlinePrompt('')
    selectedEntryRef.current = updated
    onSelect(updated)
    persistEntry(updated)
    requestAnimationFrame(() => {
      if (document.activeElement !== editorRef.current) return
      const cursor = updated.content.length
      editorRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  const collectAudio = (start: number, end: number) => {
    const output = new Float32Array(end - start)
    for (const frame of dictationFramesRef.current) {
      const frameEnd = frame.start + frame.audio.length
      const copyStart = Math.max(start, frame.start)
      const copyEnd = Math.min(end, frameEnd)
      if (copyStart >= copyEnd) continue
      output.set(frame.audio.subarray(copyStart - frame.start, copyEnd - frame.start), copyStart - start)
    }
    return output
  }

  const releaseDictationAudio = () => {
    dictationProcessorRef.current?.disconnect()
    dictationSourceRef.current?.disconnect()
    dictationMuteRef.current?.disconnect()
    dictationStreamRef.current?.getTracks().forEach(track => track.stop())
    void dictationContextRef.current?.close()
    dictationProcessorRef.current = null
    dictationSourceRef.current = null
    dictationMuteRef.current = null
    dictationStreamRef.current = null
    dictationContextRef.current = null
  }

  const processAvailableAudio = async (final = false) => {
    if (!dictationModelReadyRef.current || dictationInferenceRef.current) return
    const sampleRate = dictationSampleRateRef.current
    const end = dictationSamplesRef.current
    const previousEnd = dictationTranscribedUntilRef.current
    if (end <= previousEnd) {
      if (final) {
        releaseDictationAudio()
        setDictationMessage(dictationTranscriptRef.current ? 'Dictation stopped.' : 'No speech captured.')
      }
      return
    }
    if (!final && end - previousEnd < sampleRate * 6) return

    const overlapSamples = sampleRate * 2
    const start = previousEnd ? Math.max(0, previousEnd - overlapSamples) : 0
    const audio = collectAudio(start, end)
    if (audio.length < sampleRate * 0.5) {
      if (final) {
        releaseDictationAudio()
        setDictationMessage(dictationTranscriptRef.current ? 'Dictation stopped.' : 'No speech captured.')
      }
      return
    }

    dictationInferenceRef.current = true
    setDictationMessage(final ? 'Transcribing the final words locally...' : 'Transcribing speech locally...')
    try {
      const transcript = sanitizeTranscribedText(await transcribePcm(audio, sampleRate, setDictationMessage))
      if (transcript) {
        const merged = mergeOverlappingTranscript(dictationTranscriptRef.current, transcript)
        const addition = sanitizeTranscribedText(merged.slice(dictationTranscriptRef.current.length).trim())
        dictationTranscriptRef.current = sanitizeTranscribedText(merged) || ''
        appendDictationText(addition)
      }
      dictationTranscribedUntilRef.current = end
      const keepFrom = Math.max(0, end - overlapSamples)
      dictationFramesRef.current = dictationFramesRef.current.filter(frame => frame.start + frame.audio.length > keepFrom)
    } catch (error) {
      dictationTranscribedUntilRef.current = end
      setDictationMessage(error instanceof Error ? `Local Whisper failed: ${error.message}` : 'Local Whisper could not transcribe this audio.')
    } finally {
      dictationInferenceRef.current = false
      if (dictationStopRequestedRef.current) {
        if (dictationSamplesRef.current > dictationTranscribedUntilRef.current) void processAvailableAudio(true)
        else {
          releaseDictationAudio()
          setDictationMessage(dictationTranscriptRef.current ? 'Dictation stopped.' : 'No speech captured.')
        }
      } else if (dictationActiveRef.current) {
        setDictationMessage('Listening. New words appear as Whisper recognizes them.')
      }
    }
  }

  const stopDictation = () => {
    dictationActiveRef.current = false
    dictationStopRequestedRef.current = true
    if (dictationTimerRef.current !== null) window.clearInterval(dictationTimerRef.current)
    dictationTimerRef.current = null
    setDictating(false)
    setDictationMessage('Finishing local transcription...')
    releaseDictationAudio()
    commitDictationDraft()
    void processAvailableAudio(true)
  }
  const startDictation = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setDictationMessage('Audio recording is not supported in this browser.')
      return
    }
    const current = selectedEntryRef.current
    if (!current || !editorRef.current) return
    setDictationMessage('Waiting for microphone access...')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      setDictationMessage(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Allow microphone access in your browser to dictate.'
        : 'Could not access the microphone. Check your browser settings and try again.')
      return
    }

    dictationStreamRef.current = stream
    dictationFramesRef.current = []
    dictationSamplesRef.current = 0
    dictationTranscribedUntilRef.current = 0
    dictationTranscriptRef.current = ''
    dictationModelReadyRef.current = false
    dictationStopRequestedRef.current = false
    dictationInferenceRef.current = false

    let context: AudioContext
    try {
      context = new AudioContext()
      await context.resume()
    } catch {
      stream.getTracks().forEach(track => track.stop())
      dictationStreamRef.current = null
      setDictationMessage('Could not start audio processing in this browser.')
      return
    }
    dictationContextRef.current = context
    dictationSampleRateRef.current = context.sampleRate
    const source = context.createMediaStreamSource(stream)
    const mute = context.createGain()
    mute.gain.value = 0
    dictationSourceRef.current = source
    dictationMuteRef.current = mute

    const addAudio = (audio: Float32Array) => {
      if (!audio.length || dictationStopRequestedRef.current) return
      dictationFramesRef.current.push({ start: dictationSamplesRef.current, audio })
      dictationSamplesRef.current += audio.length
    }

    try {
      if (context.audioWorklet) {
        const workletCode = `class WhisperPcmCapture extends AudioWorkletProcessor { process(inputs, outputs) { const input = inputs[0]?.[0]; const output = outputs[0]?.[0]; if (input) { const copy = input.slice(); this.port.postMessage(copy, [copy.buffer]); } if (output) output.fill(0); return true; } } registerProcessor('whisper-pcm-capture', WhisperPcmCapture);`
        const workletUrl = URL.createObjectURL(new Blob([workletCode], { type: 'text/javascript' }))
        try {
          await context.audioWorklet.addModule(workletUrl)
        } finally {
          URL.revokeObjectURL(workletUrl)
        }
        const processor = new AudioWorkletNode(context, 'whisper-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
        processor.port.onmessage = event => addAudio(event.data as Float32Array)
        dictationProcessorRef.current = processor
        source.connect(processor)
        processor.connect(mute)
      } else {
        const processor = context.createScriptProcessor(4096, 1, 1)
        processor.onaudioprocess = event => {
          addAudio(event.inputBuffer.getChannelData(0).slice())
          event.outputBuffer.getChannelData(0).fill(0)
        }
        dictationProcessorRef.current = processor
        source.connect(processor)
        processor.connect(mute)
      }
      mute.connect(context.destination)
    } catch (error) {
      releaseDictationAudio()
      setDictationMessage(error instanceof Error ? `Could not initialize audio capture: ${error.message}` : 'Could not initialize audio capture.')
      return
    }

    dictationActiveRef.current = true
    setDictating(true)
    setDictationMessage('Loading Whisper Tiny locally. You can start speaking now.')
    dictationTimerRef.current = window.setInterval(() => { void processAvailableAudio(false) }, 1000)
    void preloadWhisper(setDictationMessage).then(() => {
      dictationModelReadyRef.current = true
      setDictationMessage(dictationStopRequestedRef.current ? 'Transcribing the final words locally...' : 'Whisper is ready. Listening locally.')
      void processAvailableAudio(dictationStopRequestedRef.current)
    }).catch(error => {
      dictationActiveRef.current = false
      setDictating(false)
      dictationStopRequestedRef.current = true
      if (dictationTimerRef.current !== null) window.clearInterval(dictationTimerRef.current)
      dictationTimerRef.current = null
      releaseDictationAudio()
      setDictationMessage(error instanceof Error ? `Could not load local Whisper: ${error.message}` : 'Could not load local Whisper.')
    })
  }
  useEffect(() => () => {
    dictationActiveRef.current = false
    dictationStopRequestedRef.current = true
    if (dictationTimerRef.current !== null) window.clearInterval(dictationTimerRef.current)
    releaseDictationAudio()
  }, [])
  useEffect(() => {
    if (!selected && dictationActiveRef.current) stopDictation()
  }, [selected])
  const createEntry = () => {
    saveRequestRef.current += 1
    setSaveState('saved')
    setSaveError('')
    feedbackRequestRef.current += 1
    setFeedback('')
    setFeedbackError('')
    setFeedbackAction(null)
    setFeedbackKind(null)
    const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())
    onSelect({ id: 'new', date, title: '', content: '', mood: defaultMood, energy: defaultEnergy, topics: [], people: [], memoryIds: [] })
    setAttachment('')
  }
  const updateEntry = (changes: Partial<DiaryEntry>) => {
    const current = selectedEntryRef.current
    if (!current) return
    feedbackRequestRef.current += 1
    setFeedback('')
    setFeedbackError('')
    setFeedbackAction(null)
    setFeedbackKind(null)
    setInlinePrompt('')
    const updated = { ...current, ...changes }
    if (updated.id === 'new' && (updated.title.trim() || updated.content.trim())) updated.id = `d${Date.now()}`
    selectedEntryRef.current = updated
    onSelect(updated)
    if (updated.id !== 'new') persistEntry(updated)
  }
  const addFormatting = (before: string, after = before) => {
    const editor = editorRef.current
    if (!editor || !selected) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const value = selected.content
    const selectedText = value.slice(start, end)
    const insertion = `${before}${selectedText || 'text'}${after}`
    const content = `${value.slice(0, start)}${insertion}${value.slice(end)}`
    updateEntry({ content })
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(start + before.length, start + before.length + (selectedText || 'text').length) })
  }

  const handleInlineDigDeeper = async () => {
    const editor = editorRef.current
    if (!editor || !selected) return

    const cursor = editor.selectionStart
    const beforeCursor = selected.content.slice(0, cursor)
    const sentenceStart = beforeCursor.slice(0, -1).lastIndexOf('.') + 1
    const phrase = beforeCursor.slice(sentenceStart).trim()
    const requestId = ++feedbackRequestRef.current
    setFeedbackKind('dig_deeper')
    setFeedback('')
    setFeedbackError('')
    setInlinePrompt('')
    setFeedbackAction(null)

    if (!phrase.trim()) {
      setFeedbackError('Place the cursor in a sentence or highlight the text you want to explore.')
      return
    }

    setFeedbackAction('dig_deeper')
    try {
      const response = await aiService.getWritingFeedback('dig_deeper', { title: selected.title, content: phrase })
      if (requestId !== feedbackRequestRef.current || !inlineDigDeeper) return
      setInlinePrompt(response.trim())
    } catch (error) {
      if (requestId === feedbackRequestRef.current) {
        setFeedbackError(error instanceof Error ? error.message : 'AI reflection is unavailable right now.')
      }
    } finally {
      if (requestId === feedbackRequestRef.current) setFeedbackAction(null)
    }
  }

  const toggleInlineDigDeeper = () => {
    if (inlineDigDeeper) {
      feedbackRequestRef.current += 1
      setInlineDigDeeper(false)
      setInlinePrompt('')
      setFeedback('')
      setFeedbackError('')
      setFeedbackAction(null)
      setFeedbackKind(null)
      return
    }
    setInlineDigDeeper(true)
    setInlinePrompt('')
    setFeedback('')
    setFeedbackError('')
    setFeedbackAction(null)
    setFeedbackKind(null)
  }
  const undoLastDictation = () => {
    const insertion = lastDictationInsertionRef.current
    const current = selectedEntryRef.current
    if (!insertion || !current || current.id !== insertion.entryId) return
    const end = insertion.start + insertion.text.length
    if (current.content.slice(insertion.start, end) !== insertion.text) {
      setDictationMessage('The latest dictated text changed, so it could not be undone safely.')
      return
    }
    const updated = { ...current, content: `${current.content.slice(0, insertion.start)}${current.content.slice(end)}` }
    lastDictationInsertionRef.current = null
    setCanUndoDictation(false)
    setDictationMessage('Last dictated text undone.')
    selectedEntryRef.current = updated
    onSelect(updated)
    persistEntry(updated)
    requestAnimationFrame(() => {
      if (document.activeElement !== editorRef.current) return
      editorRef.current?.setSelectionRange(insertion.start, insertion.start)
    })
  }
  const insertList = () => {
    const editor = editorRef.current
    if (!editor || !selected) return
    const start = editor.selectionStart
    const content = `${selected.content.slice(0, start)}\n• ${selected.content.slice(start)}`
    updateEntry({ content })
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(start + 3, start + 3) })
  }
  const requestFeedback = async (action: 'dig_deeper' | 'get_perspective', context?: { before: string; after: string; cursor: number }) => {
    if (!selected?.content.trim()) {
      setFeedbackError('Write a little about this moment first.')
      setFeedback('')
      return
    }
    const requestId = ++feedbackRequestRef.current
    setFeedbackAction(action)
    setFeedbackKind(action)
    setFeedbackError('')
    setFeedback('')
    try {
      const content = context ? `${context.before}${context.after}`.trim() || selected.content : selected.content
      const response = await aiService.getWritingFeedback(action, { title: selected.title, content })
      if (feedbackRequestRef.current !== requestId) return
      if (context && response && action === 'dig_deeper') {
        const insertion = response.trim()
        const before = context.before || ''
        const after = context.after || ''
        const nextText = `${before}${insertion}${after}`
        const updated = { ...selected, content: nextText }
        selectedEntryRef.current = updated
        onSelect(updated)
        persistEntry(updated)
        return
      }
      setFeedback(response)
    } catch (error) {
      if (feedbackRequestRef.current === requestId) setFeedbackError(error instanceof Error ? error.message : 'AI feedback is unavailable right now. Check the backend connection and try again.')
    } finally {
      if (feedbackRequestRef.current === requestId) setFeedbackAction(null)
    }
  }

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDeleteEntry = async (event: MouseEvent<HTMLButtonElement>, entry: DiaryEntry) => {
    event.stopPropagation()
    if (!window.confirm(`Delete "${entryDisplayTitle(entry)}"?`)) return
    setDeletingId(entry.id)
    try {
      await onDelete(entry)
      onSelect(null)
      setAttachment('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not delete this entry.')
    } finally {
      setDeletingId(null)
    }
  }

  const filteredDiary = diary.filter(entry => `${entry.title} ${entry.content} ${entry.date}`.toLowerCase().includes(search.toLowerCase()))

  if (selected) return <> <section className="page-content diary-notebook">
    <button className="back-link diary-back-link" onClick={() => { saveRequestRef.current += 1; if (dictationActiveRef.current) stopDictation(); onSelect(null) }}><ChevronLeft size={15} /> All diary entries</button>
    <div className="notebook-heading"><div className="eyebrow">{selected.date.toUpperCase()}</div><input aria-label="Entry title" value={selected.title} onChange={event => updateEntry({ title: event.target.value })} placeholder="A day taking shape" maxLength={100} /><span className="notebook-save-state">{selected.id === 'new' ? 'DRAFT' : saveState === 'saving' ? 'SAVING…' : saveState === 'error' ? 'NOT SAVED' : 'SAVED IN YOUR DIARY'}</span></div>
    <div className="notebook-entry-preferences">
      <div className="notebook-preference-field"><span>Feeling</span><NotebookPreferenceSelect id="notebook-mood" label="Feeling" value={selected.mood || defaultMood} options={moodOptions} onChange={mood => updateEntry({ mood })} /></div>
      <div className="notebook-preference-field"><span>Energy</span><NotebookPreferenceSelect id="notebook-energy" label="Energy" value={selected.energy || defaultEnergy} options={energyOptions} onChange={energy => updateEntry({ energy })} /></div>
    </div>
    <fieldset className="notebook-mood-score">
      <legend>How was your mood? <span>0–10 · optional</span></legend>
      <div role="group" aria-label="Mood score from 0 to 10">
        {Array.from({ length: 11 }, (_, score) => <button type="button" key={score} aria-pressed={selected.moodScore === score} aria-label={`Mood score ${score} out of 10`} onClick={() => updateEntry({ moodScore: score })}>{score}</button>)}
      </div>
      <small>{selected.moodScore == null ? 'Not rated' : `Recorded score: ${selected.moodScore} / 10`}</small>
      {selected.moodScore != null && <button type="button" className="notebook-mood-clear" onClick={() => updateEntry({ moodScore: null })}>Clear rating</button>}
    </fieldset>
    <div className="notebook-writing"><textarea ref={editorRef} aria-label="Diary entry" value={selected.content} onChange={event => updateEntry({ content: event.target.value })} placeholder="Start writing your thoughts…" spellCheck={spellCheck} style={{ fontSize: `${editorTextSize}px`, lineHeight: '48px' }} onKeyUp={event => { if (inlineDigDeeper && event.key === '.' && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) void handleInlineDigDeeper() }} /></div>
    {inlineDigDeeper && (inlinePrompt || feedbackError || feedbackAction === 'dig_deeper') && <div className="diary-inline-prompt" role="status" aria-live="polite"><div className="diary-inline-prompt-head"><Brain size={14} /> <span>{feedbackAction === 'dig_deeper' ? 'Thinking…' : 'Dig deeper'}</span></div>{inlinePrompt && <p>{inlinePrompt}</p>}{feedbackError && <p className="diary-ai-feedback-error" role="alert">{feedbackError}</p>}<button type="button" onClick={() => { setInlineDigDeeper(false); setInlinePrompt(''); setFeedbackError(''); setFeedbackKind(null); feedbackRequestRef.current += 1 }}>Close</button></div>}
    {saveError && <p className="diary-save-error" role="alert">Could not save this entry: {saveError}</p>}
    {dictationMessage && <span className="notebook-sr-status" role="status">{dictationMessage}</span>}
    {attachment && <div className="notebook-attachment"><Paperclip size={13} />{attachment}<button onClick={() => setAttachment('')} aria-label="Remove attachment"><X size={13} /></button></div>}

  </section>
      {feedbackKind !== 'dig_deeper' && (feedback || feedbackError || feedbackAction) && <aside className="diary-ai-feedback" aria-live="polite"><div className="diary-ai-feedback-heading"><ArtificialIntelligence size={15} /><span>{feedbackAction ? 'Thinking about your entry…' : feedbackError ? 'A moment for reflection' : 'A different perspective'}</span></div>{feedback && <p>{feedback}</p>}{feedbackError && <p className="diary-ai-feedback-error" role="alert">{feedbackError}</p>}</aside>}

    <div className="notebook-toolbar" role="toolbar" aria-label="Diary writing tools">
      <div className="notebook-ai-actions" role="group" aria-label="AI reflection tools"><button type="button" className={inlineDigDeeper ? 'is-active' : ''} onClick={() => { void toggleInlineDigDeeper() }} title="Toggle inline dig deeper" aria-pressed={inlineDigDeeper}><Brain size={16} /><span>{inlineDigDeeper ? 'Inline on' : 'Dig deeper'}</span></button><button type="button" onClick={() => requestFeedback('get_perspective')} disabled={feedbackAction !== null} title="Get perspective"><Compass size={16} /><span>{feedbackAction === 'get_perspective' ? 'Thinking…' : 'Get perspective'}</span></button></div>
      <span className="notebook-tool-divider" aria-hidden="true" /><div className="notebook-tool-group" role="group" aria-label="Notebook editing tools"><button type="button" title="Underline" aria-label="Underline selection" onClick={() => addFormatting('<u>', '</u>')}><Underline size={17} /></button><button type="button" title="Bulleted list" aria-label="Insert bulleted list" onClick={insertList}><List size={18} /></button><button type="button" title="Code" aria-label="Wrap in code marks" onClick={() => addFormatting('`')}><Code2 size={17} /></button><button type="button" title="Undo latest voice transcription" aria-label="Undo latest voice transcription" disabled={!canUndoDictation || lastDictationInsertionRef.current?.entryId !== selected.id} onClick={undoLastDictation}><RotateCcw size={17} /></button></div>
      <span className="notebook-tool-spacer" /><label className="notebook-attach" title="Attach a file" aria-label="Attach a file"><Paperclip size={16} /><span>Attach</span><input type="file" onChange={event => setAttachment(event.target.files?.[0]?.name ?? '')} /></label><span className="notebook-tool-divider notebook-attach-divider" aria-hidden="true" /><button type="button" className={`notebook-mic ${dictating ? 'is-listening' : ''}`} title={dictating ? 'Stop live dictation' : 'Start live dictation'} aria-label={dictating ? 'Stop live dictation — microphone on' : 'Start live dictation — microphone off'} aria-pressed={dictating} onClick={() => dictating ? stopDictation() : startDictation()}>{dictating ? <Mic size={17} /> : <MicOff size={17} />}<span className="notebook-mic-label" aria-hidden="true">{dictating ? 'Listening' : 'Mic off'}</span></button>
    </div>
  </>

  return <section className="page-content diary-library">
    <PageHeading eyebrow="YOUR OWN WORDS, HELD GENTLY" title="Your diary" subtitle="A space for your thoughts, plans, and everything in between." />
    <button className="diary-new-entry" onClick={createEntry}><Plus size={19} /><span>New entry</span><ChevronRight size={16} /></button>
    <label className="diary-search"><Search size={15} /><input aria-label="Search entries" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search entries" /><span>{filteredDiary.length} entries</span></label>
    {loadError && <p className="diary-load-error" role="alert">Could not load diary entries: {loadError}</p>}
    {filteredDiary.length ? <div className="diary-library-list">{filteredDiary.map((entry, index) => <div className="diary-library-row" key={entry.id} onClick={() => { saveRequestRef.current += 1; setSaveState('saved'); setSaveError(''); onSelect(entry); setAttachment('') }}>
      <button type="button" className="diary-library-entry" aria-label={`Open ${entryDisplayTitle(entry)}`}>
        <span className="diary-library-icon"><Feather size={16} /></span><span className="diary-library-copy"><span className="diary-library-meta">{entry.date}{entry.mood ? ` · ${entry.mood}` : ''}</span><b>{entryDisplayTitle(entry)}</b><small>{entry.content.slice(0, 150)}{entry.content.length > 150 ? '…' : ''}</small></span><ChevronRight size={16} className="diary-library-arrow" />
      </button>
      <button type="button" className="diary-library-delete" aria-label={`Delete ${entryDisplayTitle(entry)}`} disabled={deletingId === entry.id} onClick={event => void handleDeleteEntry(event, entry)}>
        {deletingId === entry.id ? 'Deleting…' : 'Delete'}
      </button>
    </div>)}</div> : loadError ? null : <div className="diary-library-empty"><div className="note-mark">“</div><h3>{search ? 'No entries found.' : 'Your diary is waiting.'}</h3><p>{search ? 'Try a different search.' : 'Start with one small moment from today.'}</p></div>}
    <aside className="diary-library-note"><span>✳</span>These are your moments, in your own words.</aside>
  </section>
}
