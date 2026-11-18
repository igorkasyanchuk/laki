// Customize toolbar (the tab bar's right click, View › Customize Toolbar…, laki://toolbar, Settings › Appearance): the
// buttons with a box each and a handle (drag; ⌥↑ ⌥↓ on its box move it, Space ticks it), the bar as it will be, Restore
// defaults. Each change is saved at once (settings.toolbar, toolbarSeen), so the real bar follows too. ⋯ and Run aren't
// listed: always there
import { useState } from 'react'
import type { AppCtx } from './appCtx'
import { Modal } from './panels'
import { Icon } from './ui'
import { capsulesOf, TOOLBAR_GROUPS, TOOLBAR_ITEMS, toolbarOf, type ToolbarItem } from './toolbar'
import { toolbarHere } from './TabBar'

export function ToolbarSheet({ app, onClose }: { app: AppCtx; onClose: () => void }) {
  const { call, settings } = app
  const items: ToolbarItem[] = [...TOOLBAR_ITEMS, ...toolbarHere(app).filter(x => x.group === 'ext')]
  const now = toolbarOf(settings.toolbar, items, settings.toolbarSeen)
  const [order, setOrder] = useState(() => [...now.shown, ...now.menu])
  const [on, setOn] = useState(() => new Set(now.shown))
  const [drag, setDrag] = useState<string | null>(null)
  const save = (o: string[], s: Set<string>) => (setOrder(o), setOn(s), void call('settingsSet', { toolbar: o.filter(id => s.has(id)), toolbarSeen: items.map(x => x.id) }).catch(() => {}))
  const move = (id: string, by: number) => {
    const i = order.indexOf(id)
    const j = Math.max(0, Math.min(order.length - 1, i + by))
    if (i === j) return
    const o = [...order]
    o.splice(j, 0, ...o.splice(i, 1))
    save(o, on)
  }
  const byId = (id: string) => items.find(x => x.id === id)
  // as the bar draws them: Terminal | Reader on its own, the rest with no capsule of one, the extensions' last
  const ids = (g: string) => order.filter(id => on.has(id) && byId(id)?.group === g)
  const shown = [...(on.has('reader') ? [['reader']] : []), ...capsulesOf(TOOLBAR_GROUPS.filter(g => g.id !== 'ext').map(g => ({ ...g, ids: ids(g.id).filter(id => id !== 'reader') }))).map(c => c.ids), ...(ids('ext').length ? [ids('ext')] : [])]
  return (
    <Modal title="Customize toolbar" onClose={onClose}>
      <div className="tb-sheet">
        <div className="tb-preview" aria-label="The toolbar as it will be">
          {shown.map((g, n) => (
            <span key={n} className="actions capsule">
              {g.map(id => (
                <span key={id} className="ib" title={byId(id)?.title}>
                  <Icon name={byId(id)!.icon} />
                </span>
              ))}
            </span>
          ))}
          <span className="actions capsule">
            <span className="ib" title="Workspace (always there)">
              <Icon name="more" />
            </span>
            <span className="tb-run">Run</span>
          </span>
        </div>
        <ul className="tb-list" aria-label="Buttons: Space shows or hides one, ⌥↑ ⌥↓ move it">
          {order.map(id => {
            const it = byId(id)
            if (!it) return null
            return (
              <li
                key={id}
                className={drag === id ? 'dragging' : undefined}
                draggable
                onDragStart={e => (setDrag(id), e.dataTransfer.setData('text/plain', id))}
                onDragEnd={() => setDrag(null)}
                onDragOver={e => drag && drag !== id && (e.preventDefault(), move(drag, order.indexOf(id) - order.indexOf(drag)))}
              >
                <span className="tb-grip" aria-hidden="true"><Icon name="grip" size={12} /></span>
                <label>
                  <input
                    type="checkbox"
                    checked={on.has(id)}
                    onChange={e => save(order, (s => (e.target.checked ? s.add(id) : s.delete(id), s))(new Set(on)))}
                    onKeyDown={e => e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.preventDefault(), move(id, e.key === 'ArrowUp' ? -1 : 1))}
                  />
                  <Icon name={it.icon} size={13} />
                  {it.title}
                </label>
                <span className="muted small">{TOOLBAR_GROUPS.find(g => g.id === it.group)?.label}</span>
              </li>
            )
          })}
        </ul>
        <p className="muted small">A hidden button is in the ⋯ menu; ⌘K and its key still work.</p>
        <div className="row">
          <button type="button" onClick={() => (void call('settingsSet', { toolbar: null, toolbarSeen: null }).catch(() => {}), (d => (setOrder([...d.shown, ...d.menu]), setOn(new Set(d.shown))))(toolbarOf(undefined, items)))}>
            Restore defaults
          </button>
          <span className="grow" />
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
