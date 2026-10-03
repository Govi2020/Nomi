import { ArtificialIntelligence, AudioLines, Bookmark, ChevronDown, ChevronRight, Feather, LockKeyhole, MessageSquare, Add as Plus } from '../../components/icons'
import { WordReveal } from '../../components/WordReveal'
import type { AskChat, AskMode, AskTurn } from '../../services/aiService'
import type { Source } from '../../types'

const modes: AskMode[] = ['Recall', 'Reflect', 'Plan', 'Search', 'General']
const prompts = ['What was I working on last Tuesday?', 'Why was I frustrated this week?', 'How have my priorities changed?']

type Props = {
  query: string
  setQuery: (value: string) => void
  onAsk: (value?: string) => void
  turns: AskTurn[]
  chats: AskChat[]
  selectedChatId: string | null
  chatsLoading: boolean
  chatError: string
  onSelectChat: (id: string) => void
  onNewChat: () => void
  asking: boolean
  mode: AskMode
  setMode: (value: AskMode) => void
  contextOpen: boolean
  setContextOpen: (value: boolean) => void
  onOpenSource: (source: Source) => void
}

export function AskPage({ query, setQuery, onAsk, turns, chats, selectedChatId, chatsLoading, chatError, onSelectChat, onNewChat, asking, mode, setMode, contextOpen, setContextOpen, onOpenSource }: Props) {
  return <section className="ask-page page-content">
    <div className="ask-heading"><div className="eyebrow">A QUESTION FOR YOUR PAST</div><h1>Ask about <em>your life.</em></h1><p>Your conversations are saved, so you can return to a question whenever you like.</p></div>
    {chatError && <p className="ask-chat-error" role="alert">{chatError}</p>}
    <div className="ask-chat-layout">
      <aside className="ask-chat-sidebar" aria-label="Ask AI conversations">
        <button className="ask-new-chat" onClick={onNewChat} disabled={asking || chatsLoading}><Plus size={16} /> New chat</button>
        <div className="ask-chat-list">
          {chats.map(chat => <button className={`ask-chat-item ${chat.id === selectedChatId ? 'is-active' : ''}`} onClick={() => onSelectChat(chat.id)} key={chat.id} disabled={asking || chatsLoading} aria-current={chat.id === selectedChatId ? 'page' : undefined}>
            <MessageSquare size={15} /><span><b>{chat.title}</b><small>{chat.last_message || 'New chat'}</small></span>
          </button>)}
          {!chats.length && !chatsLoading && <p className="ask-chat-list-empty">Your chats will appear here.</p>}
        </div>
      </aside>
      <div className="ask-chat-main">
        <div className="ask-modes" aria-label="Answer mode">{modes.map(item => <button className={mode === item ? 'selected' : ''} onClick={() => setMode(item)} key={item}>{item}</button>)}</div>
        <div className="ask-composer">
          <textarea value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onAsk() } }} placeholder="Ask about your life..." disabled={chatsLoading || !selectedChatId} />
          <div className="ask-composer-bottom"><span><LockKeyhole size={12} /> Answers draw from what you’ve saved</span><button onClick={() => onAsk()} disabled={asking || chatsLoading || !selectedChatId}>{asking ? 'Thinking…' : <>Ask Memory <ChevronRight size={15} /></>}</button></div>
        </div>
        {turns.length === 0 && !asking && !chatsLoading && <div className="suggestions"><div className="section-caption"><span>QUESTIONS TO GET YOU STARTED</span></div>{prompts.map(item => <button onClick={() => onAsk(item)} key={item}><span>{item}</span><ChevronRight size={15} /></button>)}</div>}
        {chatsLoading && <div className="ask-empty-state">Loading your conversation…</div>}
        <div className="ask-conversation" aria-live="polite">
          {turns.map((turn, index) => <article className="answer-block" key={`${turn.question}-${index}`}>
            <div className="answer-meta"><span className="answer-mark"><ArtificialIntelligence size={15} /></span><span>{turn.mode === 'General' ? 'A THOUGHTFUL ANSWER' : 'MEMORY FOUND A THREAD'}</span><span className="answer-mode">{turn.mode}</span></div>
            <div className="ask-user-question"><b>You asked</b><p>{turn.question}</p></div>
            {turn.error ? <div className="inline-error">I couldn’t reach your assistant just now. Your question is still here; try asking again.</div> : turn.answer ? <p className="answer-copy"><WordReveal text={turn.answer} /></p> : asking && index === turns.length - 1 ? <div className="answer-loading"><span className="loading-orb"><ArtificialIntelligence size={20} /></span><p>Looking back through your memories...</p></div> : null}
            {turn.answer && turn.sources.length > 0 && <div className="sources-block"><div className="section-caption"><span>SOURCES</span><span className="soft-note">{turn.sources.length} {turn.sources.length === 1 ? 'moment' : 'moments'} helped shape this answer</span></div><div className="source-cards">{turn.sources.map(source => <button onClick={() => onOpenSource(source)} key={`${source.id}${source.kind}`}><span className="source-type-icon">{source.kind === 'Diary entry' ? <Feather size={15} /> : source.kind === 'Memory' ? <Bookmark size={15} /> : <AudioLines size={15} />}</span><span><b>{source.kind}</b><small>{source.kind === 'Diary entry' ? `[E${source.id}] · ` : ''}{source.date}</small></span><ChevronRight size={14} /></button>)}</div></div>}
            {turn.answer && <><button className="context-toggle" onClick={() => setContextOpen(!contextOpen)}>{contextOpen ? 'Hide retrieval context' : 'View retrieval context'} <ChevronDown size={14} /></button>{contextOpen && <div className="context-flow"><div><b>Your question</b><small>{turn.question}</small></div><i>↓</i><div><b>{turn.mode === 'Search' ? 'Matching journal entries' : 'Relevant memories'}</b><small>Sources and conversation context shaped this answer</small></div><i>↓</i><div><b>Personal memory assistant</b><small>Answer shaped in {turn.mode.toLowerCase()} mode</small></div></div>}</>}
          </article>)}
        </div>
      </div>
    </div>
  </section>
}
