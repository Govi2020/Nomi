import { Home } from '../icons'
import type { Page } from '../../types'

export function NavButton({ item, active, onClick }: { item: { label: Page; icon: typeof Home }; active: boolean; onClick: () => void }) { const Icon = item.icon; return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick} aria-label={item.label} aria-current={active ? 'page' : undefined} title={item.label}><Icon size={17} strokeWidth={1.7} /><span className="nav-button-label">{item.label}</span>{item.label === 'Tasks' && <span className="nav-count">2</span>}</button> }
