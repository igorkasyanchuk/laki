// Bird view (experimental, settings.birdView; the eye beside Help, ⌘K): every live session at once, grouped by
// workspace, each a card with its screen as it is now (the daemon's `screen`, polled while the page is open). A click
// opens that tab.
import { useEffect, useState } from 'react'
import type { TabView, View } from '../../shared/types'
import { Glyph, rollup } from './Glyph'
import { Icon, Page } from './ui'

export type BirdApi = {
  screen: (tab: string) => Promise<string>
  open: (ws: string, tab: string) => void
  needs: (t: TabView) => boolean // App's needsYou: the Dock count's rule
}

const SHOW = [
  ['all', 'All'],
  ['working', 'Working'],
  ['needs', 'Needs you'],
] as const
type Show = (typeof SHOW)[number][0]
const LINES = 40
const EVERY = 2500 // ms between screens
// ponytail: one `screen` call per card every EVERY; batch them in one method if someone runs hundreds of tabs

export function BirdPage({ view, api, onClose }: { view: View; api: BirdApi; onClose: () => void }) {
  const [show, setShow] = useState<Show>('all')
  const [screens, setScreens] = useState<Record<string, string>>({})
  const browsers = new Set(view.projects.filter(p => p.kind === 'browsers').map(p => p.id)) // a page, no session
  const project = (id: string) => view.projects.find(p => p.id === id)?.name ?? ''
  const live = view.tabs.filter(t => t.status !== 'exited')
  const test = (s: Show, t: TabView) => (s === 'needs' ? api.needs(t) : s === 'working' ? t.status === 'running' : true) // a shell runs while a command does
  const groups = view.projects
    .filter(p => !browsers.has(p.id))
    .flatMap(p => view.workspaces.filter(w => w.project === p.id && !w.archived)) // the sidebar's project order
    .map(w => ({ w, tabs: live.filter(t => t.workspace === w.id) }))
    .filter(g => g.tabs.length)
  const shown = groups.map(g => ({ ...g, tabs: g.tabs.filter(t => test(show, t)) })).filter(g => g.tabs.length)
  const ids = shown.flatMap(g => g.tabs.map(t => t.id)).join(' ')

  useEffect(() => {
    if (!ids) return
    let gone = false
    const asked = new Set<string>() // a slow daemon: no second call for a tab before the first answers
    const read = () => {
      if (document.hidden) return
      for (const id of ids.split(' ')) {
        if (asked.has(id)) continue
        asked.add(id)
        api
          .screen(id)
          .then(
            s => !gone && setScreens(m => (m[id] === s ? m : { ...m, [id]: s })),
            () => {}, // a tab closed meanwhile
          )
          .finally(() => asked.delete(id))
      }
    }
    read()
    const t = setInterval(read, EVERY)
    document.addEventListener('visibilitychange', read) // back in sight: now, not at the next tick
    return () => ((gone = true), clearInterval(t), document.removeEventListener('visibilitychange', read))
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const count = (s: Show) => groups.reduce((n, g) => n + g.tabs.filter(t => test(s, t)).length, 0)
  return (
    <Page
      title="Bird view"
      onClose={onClose}
      wide
      tools={
        <div className="bird-show" role="tablist">
          {SHOW.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
              {label} <span className="muted">{count(k)}</span>
            </button>
          ))}
        </div>
      }
    >
      {!shown.length && <p className="muted bird-none">{groups.length ? 'Nothing here right now.' : 'No live sessions.'}</p>}
      {shown.map(({ w, tabs }) => (
        <section key={w.id} className="bird-ws">
          <h3>
            <Glyph s={w.setup ? 'setup' : rollup(tabs)} />
            <span className="bird-ws-name">{w.name || w.id}</span>
            <span className="muted">{project(w.project)}</span>
          </h3>
          <div className="bird-cards">
            {tabs.map(t => {
              const needs = api.needs(t)
              const text = (screens[t.id] ?? '').replace(/\s+$/, '')
              return (
                <button key={t.id} type="button" className={`bird-card${needs ? ' needs' : ''}${t.asleep ? ' asleep' : ''}`} onClick={() => api.open(w.id, t.id)} aria-label={`${t.name}, ${w.name || w.id}${needs ? ', needs you' : ''}`} data-tip={t.asleep ? 'Asleep: a click wakes it' : undefined}>
                  <div className="bird-card-head">
                    <Icon name={t.kind === 'agent' ? 'agent' : 'terminal'} size={14} />
                    <span className="bird-card-name">{t.name}</span>
                    {needs ? <span className="bird-dot" aria-label="needs you" /> : <Glyph s={rollup([t])} />}
                  </div>
                  <div className="bird-screen">
                    <pre>{text.split('\n').slice(-LINES).join('\n')}</pre>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </Page>
  )
}
