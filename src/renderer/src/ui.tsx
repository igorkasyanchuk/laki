// Small shared UI: line icons (16px, currentColor), icon buttons, and a popup menu.
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'

const paths = {
  plus: 'M8 3v10M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  diff: 'M8 2.5v5M5.5 5h5M5.5 12h5',
  run: 'M5 3l8 5-8 5z',
  ship: 'M8 10.5V2.5M4.5 6L8 2.5 11.5 6M3 13.5h10',
  fork: 'M5.8 3a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM12.8 3a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM9.3 13a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM4.5 4.3v1.2a2 2 0 002 2h3a2 2 0 002-2V4.3M8 7.5v4.2',
  archive: 'M2.5 3h11v3h-11zM3.5 6v7h9V6M6.5 9h3',
  restore: 'M3 8a5 5 0 105-5H5.5M5.5 1L3 3.2l2.5 2.3',
  trash: 'M2.5 4.5h11M6.5 4.5V2.5h3v2M4 4.5l.7 9h6.6l.7-9',
  search: 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.5 10.5L14 14',
  settings: 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3',
  folder: 'M2 4.5h4l1.5 1.5H14v7H2z',
  folderPlus: 'M2 4.5h4l1.5 1.5H14v7H2zM8 8v3.5M6.25 9.75h3.5',
  splitRight: 'M2.5 2.5h11v11h-11zM8 2.5v11',
  splitDown: 'M2.5 2.5h11v11h-11zM2.5 8h11',
  terminal: 'M2.5 2.5h11v11h-11zM5 6l2 2-2 2M8.5 10.5h2.5',
  agent: 'M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z',
  link: 'M9.5 2.5h4v4M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4',
  pr: 'M5.8 3a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM5.8 13a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM12.8 13a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM4.5 4.3v7.4M11.5 11.7V7.5a2 2 0 00-2-2H7M8.5 4L7 5.5 8.5 7',
}
export type IconName = keyof typeof paths

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 2.4 : 1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name]} />
    </svg>
  )
}

export function IconButton({ icon, title, onClick, on, className = '' }: { icon: IconName; title: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; on?: boolean; className?: string }) {
  return (
    <button className={`ib ${on ? 'on' : ''} ${className}`} title={title} aria-label={title} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

// null is a separator, { head } a section title
export type MenuItem = { label: string; icon?: IconName; hint?: string; danger?: boolean; run: () => void } | { head: string } | null

function Menu({ anchor, items, align, onClose }: { anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right'; onClose: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [onClose])
  const pos = align === 'left' ? { left: anchor.left } : { right: window.innerWidth - anchor.right }
  return (
    <div className="menu-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="menu" role="menu" style={{ top: anchor.bottom + 4, ...pos }}>
        {items.map((it, i) =>
          !it ? (
            <div key={i} className="menu-sep" />
          ) : 'head' in it ? (
            <div key={i} className="menu-head">
              {it.head}
            </div>
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                onClose()
                it.run()
              }}
            >
              <span className="menu-icon">{it.icon && <Icon name={it.icon} />}</span>
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

// [the open menu (render it somewhere), open(event, items, align)]
export function useMenu(): [ReactNode, (e: MouseEvent, items: MenuItem[], align?: 'left' | 'right') => void] {
  const [m, setM] = useState<{ anchor: DOMRect; items: MenuItem[]; align: 'left' | 'right' } | null>(null)
  const open = (e: MouseEvent, items: MenuItem[], align: 'left' | 'right' = 'left') => {
    e.stopPropagation()
    setM({ anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), items, align })
  }
  return [m && <Menu {...m} onClose={() => setM(null)} />, open]
}
