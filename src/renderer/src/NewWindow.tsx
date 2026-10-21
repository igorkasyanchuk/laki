// The floating bubbles' + (and a voice prompt for a new session): the new-workspace page alone, in a window of its own
// over every app (main's newWsWin, ?window=new), so Laki's own window and the app you're in stay where they are. The
// workspace made, or Esc: it closes; the app's sidebar shows the new one. Its Ask Laki AI: the AI page, compact, in one
// too (aiWin, ?window=ai). A tab floated out of the app (a tab's right click › Float): its terminal alone, live, in a
// window over every app (tabWin, ?window=tab&tab=<id>); its ✕ puts it back in the app.
import { useEffect, useState } from 'react'
import type { View, WorkspaceView } from '../../shared/types'
import { api, bridge, reportView } from './api'
import { AiPage } from './Ai'
import { Glyph } from './Glyph'
import { VoiceBar } from './PromptInput'
import { NewWorkspace } from './panels'
import { DeviceTab } from './SidePanel'
import { FONT_SIZE, termLook } from './Settings'
import { Term } from './Term'
import { applyTheme, type Paint, paintKey, paintOf, transparent } from './themes'
import { AskHost, IconButton, load, Tips } from './ui'

// no glass, no see-through sidebar: the window has no blur behind it
const paint = (p: Paint) => applyTheme({ ...p, glass: false, sideClear: 0 })
// only in those windows: main.tsx imports this module in the app's too
const which = new URLSearchParams(location.search).get('window')
if (which === 'new' || which === 'ai' || which === 'tab' || which === 'sim') {
  const last = load<string | Paint>('laki.theme', '') // the app's, until the daemon's settings arrive
  paint(typeof last === 'string' ? { theme: last } : last)
  if (which === 'new') document.documentElement.classList.add('new-window') // compact: styles.css' .new-window rules
}

// the state, and the theme as it changes
function useView() {
  const [view, setView] = useState<View | null>(null)
  useEffect(() => {
    const off = api.on(m => m.ev === 'state' && setView(m.view))
    api.connect()
    return off
  }, [])
  const theme = JSON.stringify(paintOf(view?.settings))
  useEffect(() => void (view && paint(paintOf(view.settings))), [theme])
  return view
}

export function TabWindow() {
  const view = useView()
  const id = new URLSearchParams(location.search).get('tab')
  const t = view?.tabs.find(x => x.id === id)
  const ws = t && view?.workspaces.find(w => w.id === t.workspace)
  useEffect(() => void (view && !t && window.close()), [view, t]) // closed in the app (or gone): the window goes too
  // on screen here: no ● while you look. No tab: the app's pane keeps the keyboard's
  useEffect(() => (id ? reportView(() => ({ tab: null, tabs: [id] })) : undefined), [id])
  useEffect(() => void (t && (document.title = `${t.name}${ws ? ` · ${ws.name || ws.id}` : ''} — Laki`)), [t?.name, ws?.name])
  if (!view || !t) return null
  const s = view.settings
  const zoom = Number(load<Record<string, unknown> | null>('laki.zoom', {})?.[t.id]) || 0 // the tab's ⌘± in the app (App's sizeOf)
  return (
    <div className="tab-window">
      <div className="tab-win-head">
        <Glyph s={t.status} />
        <b>{t.name}</b>
        {ws && <span className="muted">{ws.name || ws.id}</span>}
        <span className="grow" />
        <IconButton icon="popIn" title="Back in Laki" onClick={() => window.close()} />
      </div>
      <div className="tab-win-body">
        <Term key={transparent() ? 'clear' : 'solid'} tab={t.id} fontSize={Math.min(32, Math.max(8, (s.fontSize ?? FONT_SIZE) + zoom))} onFile={p => void bridge?.openPath?.(p)} fontFamily={s.fontFamily} copyOnSelect={s.copyOnSelect !== false} editKeys={s.editKeys !== false} theme={paintKey(paintOf(s))} look={termLook(s)} />
      </div>
    </div>
  )
}

// a simulator floated out of the side panel (its window button): that device alone, live, in a window over every app
// (main's simWins, ?window=sim&device=<id>&ws=<workspace>: the camera's screenshot goes to that workspace's agent)
export function SimWindow() {
  const view = useView()
  const q = new URLSearchParams(location.search)
  const [device, ws] = [q.get('device') ?? '', q.get('ws') ?? '']
  useEffect(() => void (document.title = 'Simulator — Laki'), [])
  if (!view) return null
  return (
    <div className="tab-window sim-window">
      <div className="tab-win-head">
        <b>Simulator</b>
        <span className="grow" />
        <IconButton icon="x" title="Close" onClick={() => window.close()} />
      </div>
      <div className="sim-win-body">
        <DeviceTab only={device} api={{ sim: p => api.call('sim', p), ...(ws && { toPrompt: (text: string) => api.call('send', { target: view.tabs.find(t => t.workspace === ws && t.kind === 'agent' && t.status !== 'exited')?.id ?? ws, text, enter: false }) }) }} />
      </div>
      <Tips />
    </div>
  )
}

export function AiWindow() {
  const view = useView()
  const [shot, setShot] = useState<{ n: number; png: string }>() // Screenshot to Laki AI's picture, the newest: to the box, the mic on
  useEffect(() => void bridge?.onAiShot?.(png => setShot(s => ({ n: (s?.n ?? 0) + 1, png }))), [])
  if (!view) return null
  return (
    <>
      <AiPage compact settings={view.settings.ai ?? {}} workspaces={view.workspaces.filter(w => !w.archived).map(w => ({ id: w.id, name: w.name || w.id }))} onClose={() => window.close()} shot={shot} />
      <AskHost />
      <VoiceBar />
      <Tips />
    </>
  )
}

export function NewWindow() {
  const view = useView()
  const [err, setErr] = useState('')
  const [ask, setAsk] = useState({ n: 0, prompt: new URLSearchParams(location.search).get('prompt') ?? undefined }) // another voice prompt: the page anew with it
  useEffect(() => void bridge?.onNewPrompt?.(prompt => setAsk(a => ({ n: a.n + 1, prompt }))), [])
  // the window as tall as the page: the head, the form and the body's padding, again as the form changes
  const ready = !!view
  useEffect(() => {
    const form = document.querySelector<HTMLElement>('.new-ws')
    const body = form?.parentElement
    if (!form || !body || !bridge?.fitNew) return
    const fit = () => {
      const pad = getComputedStyle(body)
      bridge!.fitNew!(Math.ceil((document.querySelector<HTMLElement>('.settings-head')?.offsetHeight ?? 0) + parseFloat(pad.paddingTop) + form.offsetHeight + parseFloat(pad.paddingBottom)))
    }
    const o = new ResizeObserver(fit)
    o.observe(form)
    return () => o.disconnect()
  }, [ready, ask.n])
  if (!view) return null
  return (
    <>
      <NewWorkspace
        key={ask.n}
        view={{ ...view, projects: view.projects.filter(p => !p.kind) } /* Terminals and Browsers make theirs with + */}
        agent={view.settings.agent}
        initial={ask.prompt ? { prompt: ask.prompt } : undefined}
        onClose={() => window.close()}
        onCreate={async p => {
          setErr('')
          await (p.fan ? api.call<WorkspaceView[]>('wsFan', { ...p, presets: p.fan }) : api.call<WorkspaceView>('wsNew', p)).then(
            () => window.close(),
            e => {
              setErr((e as Error).message)
              throw e // the page keeps what was typed
            },
          )
        }}
      />
      {err && (
        <div className="toast" role="alert">
          {err}
        </div>
      )}
      <AskHost />
      <VoiceBar />
      <Tips />
    </>
  )
}
