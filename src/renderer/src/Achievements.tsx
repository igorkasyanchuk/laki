// Achievements' page (the status bar's trophy, ⌘K, Settings › Achievements, laki://achievements): the list by group,
// each with what to do and Show me (App's achGo), unlocked ones dated; a card's ✕ hides it, Hidden shows those again
import { type CSSProperties, useState } from 'react'
import type { AchievementsKept } from '../../shared/types'
import { ACH_GROUPS, ACHIEVEMENTS } from '../../shared/achievements'
import { Icon, IconButton, Page } from './ui'

export type AchApi = { go: (go: string) => void; hide: (id: string, hidden: boolean) => void; off: (off: boolean) => void } // a link opens the page while they're off: Turn on

const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', ...(new Date(ms).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) })

export function AchievementsPage({ kept, api, onClose }: { kept: AchievementsKept; api: AchApi; onClose: () => void }) {
  const [hiddenWant, setHiddenToo] = useState(false)
  const got = kept.got ?? {}
  const hidden = kept.hidden ?? []
  const hiddenToo = hiddenWant && hidden.length > 0 // the last one shown again: back to the list
  const shown = ACHIEVEMENTS.filter(a => !hidden.includes(a.id))
  const n = shown.filter(a => got[a.id]).length
  const list = hiddenToo ? ACHIEVEMENTS.filter(a => hidden.includes(a.id)) : shown
  return (
    <Page
      title="Achievements"
      head={
        <>
          <b>Achievements</b>
          <span className="muted small">
            {n} of {shown.length}
          </span>
        </>
      }
      tools={
        <>
          {hidden.length > 0 && <IconButton icon="eye" title={hiddenToo ? 'Back to the list' : `Show the ${hidden.length} you hid`} label={hiddenToo ? 'Back' : `Hidden (${hidden.length})`} on={hiddenToo} onClick={() => setHiddenToo(h => !h)} />}
          {kept.off ? (
            <IconButton icon="power" title="Turn achievements on: the trophy, and unlocks as you do them" label="Turn on" onClick={() => api.off(false)} />
          ) : (
            <IconButton icon="power" title="Turn achievements off: no trophy, no unlocks (Settings › Achievements turns them back on)" label="Turn off" onClick={() => api.off(true)} />
          )}
        </>
      }
      onClose={onClose}
    >
      <div className="ach">
        {hiddenToo ? (
          <p className="muted">The ones you hid: they don't count and don't unlock. Show brings one back.</p>
        ) : (
          <>
            <p className="muted">One thing to do each, a quick tour of Laki. They unlock as you do them; ✕ hides one you don't need.</p>
            <div className="ob-bar" style={{ '--p': `${(n / Math.max(shown.length, 1)) * 100}%` } as CSSProperties} />
          </>
        )}
        {ACH_GROUPS.map(g => {
          const of = list.filter(a => a.group === g)
          if (!of.length) return null
          const m = of.filter(a => got[a.id]).length
          return (
            <section key={g} className="ach-group">
              <h3>
                {g}
                {!hiddenToo && (
                  <>
                    <span className="muted">
                      {m} of {of.length}
                    </span>
                    <span className="ob-mini" style={{ '--p': `${(m / of.length) * 100}%` } as CSSProperties} />
                  </>
                )}
              </h3>
              <div className="ach-grid">
                {of.map(a => (
                  <div key={a.id} className={`ach-card ${got[a.id] ? 'got' : ''}`} data-ach={a.id}>
                    <span className="ach-badge">
                      <Icon name={got[a.id] ? 'trophy' : a.icon} size={16} />
                    </span>
                    <div className="ach-what">
                      <b>{a.title}</b>
                      <span className="muted small">{a.how}</span>
                      {got[a.id] ? (
                        <span className="ach-when small">
                          <Icon name="check" size={11} /> Unlocked {day(got[a.id])}
                        </span>
                      ) : (
                        !hiddenToo && a.go && (
                          <button className="ach-go" onClick={() => api.go(a.go!)}>
                            Show me
                          </button>
                        )
                      )}
                    </div>
                    {hiddenToo ? (
                      <button className="ach-show" onClick={() => api.hide(a.id, false)}>
                        Show
                      </button>
                    ) : (
                      <IconButton icon="x" className="ach-hide" title="Hide this one: it won't count or unlock" onClick={() => api.hide(a.id, true)} />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </Page>
  )
}
