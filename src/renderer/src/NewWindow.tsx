// The floating bubbles' + (and a voice prompt for a new session): the new-workspace page alone, in a window of its own
// over every app (main's newWsWin, ?window=new), so Laki's own window and the app you're in stay where they are. The
// workspace made, or Esc: it closes; the app's sidebar shows the new one. Its Ask Laki AI: the AI page, compact, in one
// too (aiWin, ?window=ai).
import { useEffect, useState } from 'react'
import type { View, WorkspaceView } from '../../shared/types'
import { api, bridge } from './api'
import { AiPage } from './Ai'
import { NewWorkspace } from './panels'
import { applyTheme, type Paint, paintOf } from './themes'
import { AskHost, load, Tips } from './ui'

// no glass, no see-through sidebar: the window has no blur behind it
const paint = (p: Paint) => applyTheme({ ...p, glass: false, sideClear: 0 })
// only in those windows: main.tsx imports this module in the app's too
const which = new URLSearchParams(location.search).get('window')
if (which === 'new' || which === 'ai') {
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

export function AiWindow() {
  const view = useView()
  if (!view) return null
  return (
    <>
      <AiPage compact settings={view.settings.ai ?? {}} workspaces={view.workspaces.filter(w => !w.archived).map(w => ({ id: w.id, name: w.name || w.id }))} onClose={() => window.close()} />
      <AskHost />
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
      <Tips />
    </>
  )
}
