import { Home } from 'lucide-react'
import type { Page } from '../../types'

export function NavButton({ item, active, onClick }: { item: { label: Page; icon: typeof Home }; active: boolean; onClick: () => void }) { const Icon = item.icon; return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={1.7} /><span>{item.label}</span>{item.label === 'Tasks' && <span className="nav-count">2</span>}</button> }
