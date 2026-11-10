// The floating bubbles' + (and a voice prompt for a new session): the new-workspace page alone, in a window of its own
// over every app (main's newWsWin, ?window=new), so Laki's own window and the app you're in stay where they are. The
// workspace made, or Esc: it closes; the app's sidebar shows the new one. Its Ask Laki AI: the AI page, compact, in one
// too (aiWin, ?window=ai). A tab floated out of the app (a tab's right click › Float): its terminal alone, live, in a
// window over every app (tabWin, ?window=tab&tab=<id>); its ✕ puts it back in the app.
import { type KeyboardEvent, useEffect, useState } from 'react'
import { type ActionFile, aiOn, veiled, type View, type WorkspaceView } from '../../shared/types'
import { api, bridge, daemonBase, openExternal, reportView } from './api'
import { AiPage } from './Ai'
import { Glyph } from './Glyph'
import { type Img, type Inserts, PromptInput, VoiceBar, withImages } from './PromptInput'
import { LAST_NEW, type LastNew, NewWorkspace } from './panels'
import { DeviceTab } from './SidePanel'
import { FONT_SIZE, termLook } from './settingsBase'
import { Term } from './Term'
import { setSendKey } from '../../shared/keys'
import { applyTheme, type Paint, paintKey, paintOf, transparent, userCss } from './themes'
import { ask, AskHost, askText, Icon, IconButton, load, Tips } from './ui'
import { cloudVoice, voiceStart } from './voice'
import { imagesVia, insertMenus } from './Widgets'

// no glass, no see-through sidebar: the window has no blur behind it
const paint = (p: Paint) => applyTheme(p, true)
// only in those windows: main.tsx imports this module in the app's too
const which = new URLSearchParams(location.search).get('window')
if (which === 'new' || which === 'ai' || which === 'tab' || which === 'sim' || which === 'quick') {
  const last = load<string | Paint>('laki.theme', '') // the app's, until the daemon's settings arrive
  paint(typeof last === 'string' ? { theme: last } : last)
  if (which === 'new') document.documentElement.classList.add('new-window') // compact: styles.css' .new-window rules
  if (which === 'quick') document.documentElement.classList.add('quick-window') // the quick bar's: .quick-* rules
}

// the state, and the theme as it changes; an extension's or Laki AI's https pictures through the daemon's /img, as the
// app's window has them (none without its key: dropped)
let base: string | null = null
void daemonBase().then(b => (base = b), () => {})
function useView() {
  const [view, setView] = useState<View | null>(null)
  useEffect(() => {
    const off = api.on(m => m.ev === 'state' && setView(veiled(m.view))) // Recording mode: a private one's floated tab closes
    api.connect()
    return off
  }, [])
  imagesVia(view?.imgKey && base !== null ? u => `${base}/img?k=${view.imgKey}&u=${encodeURIComponent(u)}` : undefined)
  const theme = JSON.stringify(paintOf(view?.settings))
  useEffect(() => void (view && paint(paintOf(view.settings))), [theme])
  userCss(view?.settings.customCss) // Appearance › Custom CSS, as the app's window
  setSendKey(view?.settings.sendKey) // Settings › Keys › Send with
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

// the box's Insert menu in these windows, as the app's (App's extInserts): no workspace here, so the global ones' and,
// with a project picked, its repo's. Its confirm and ask, then the action; its insert and files into the box, its link
// opened; a failure is the box's error
const windowInserts = (view: View, project?: string): Inserts =>
  insertMenus(view.widgets, undefined, project).map(({ w, m }) => ({
    label: m.title,
    sub: w.name,
    run: async () => {
      if (m.confirm && !(await ask(m.confirm, { text: `${w.name} · ${m.title}`, ok: m.title }))) return
      const arg = m.ask ? await askText(m.ask, { text: `${w.name} · ${m.title}`, ok: m.title }) : ''
      if (arg === null) return
      const r = await api.call<{ ok: boolean; error?: string; insert?: string; open?: string; files?: ActionFile[] }>('widgetAction', { id: w.id, action: m.action, arg, ctx: {} })
      if (!r.ok) throw new Error(`${m.title} failed: ${r.error}`)
      if (r.open) openExternal(r.open)
      return r.insert !== undefined || r.files?.length ? { text: r.insert ?? '', files: r.files } : undefined
    },
  }))

export function AiWindow() {
  const view = useView()
  const [shot, setShot] = useState<{ n: number; png: string }>() // Screenshot to Laki AI's picture, the newest: to the box, the mic on
  useEffect(() => void bridge?.onAiShot?.(png => setShot(s => ({ n: (s?.n ?? 0) + 1, png }))), [])
  if (!view) return null
  return (
    <>
      <AiPage compact settings={view.settings.ai ?? {}} workspaces={view.workspaces.filter(w => !w.archived).map(w => ({ id: w.id, name: w.name || w.id }))} onClose={() => window.close()} shot={shot} inserts={windowInserts(view)} />
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
        inserts={project => windowInserts(view, project)}
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
        <div className="toast err" role="alert">
          {err}
        </div>
      )}
      <AskHost />
      <VoiceBar />
      <Tips />
    </>
  )
}

// Q1: the quick bar (main's quickWin, ?window=quick): one line from any app, to where its chip says: a new workspace in
// the project you last made one in (the new-workspace page's last picks), an agent that waits or is idle (send), or
// Laki AI. Tab (⇧Tab) or "@word " at the start changes the chip; ⏎ sends and closes it (the app you were in has the
// keyboard again); Esc closes; a failed send keeps the text. The mic and a screenshot (⌘⇧M, ⌘⇧S); More: the whole
// new-workspace page with the text, its project, agent and template pickers
type Target = { kind: 'new'; project: string; label: string } | { kind: 'send'; tab: string; label: string } | { kind: 'ai'; label: string }
function targetsOf(view: View): Target[] {
  const last = load<LastNew>(LAST_NEW, {})
  const projects = view.projects.filter(p => !p.kind && !p.archived)
  const proj = projects.find(p => p.id === last.project) ?? projects[0]
  const live = new Set(view.workspaces.filter(w => !w.archived).map(w => w.id))
  return [
    ...(proj ? [{ kind: 'new' as const, project: proj.id, label: `New workspace in ${proj.name}` }] : []),
    ...view.tabs
      .filter(t => t.kind === 'agent' && live.has(t.workspace) && (t.status === 'waiting' || t.status === 'idle'))
      .map(t => ({ kind: 'send' as const, tab: t.id, label: `${t.name} · ${(w => w?.name || w?.id || '')(view.workspaces.find(w => w.id === t.workspace))}` })),
    ...(aiOn(view.settings) ? [{ kind: 'ai' as const, label: 'Laki AI' }] : []),
  ]
}
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
export function QuickWindow() {
  const view = useView()
  const [text, setText] = useState(new URLSearchParams(location.search).get('prompt') ?? '')
  const [images, setImages] = useState<Img[]>([])
  const [pick, setPick] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shot, setShot] = useState<{ n: number; png: string }>()
  useEffect(() => void bridge?.onNewPrompt?.(p => setText(p)), []) // another New task with words: into the box
  useEffect(() => void (document.title = 'New task — Laki'), [])
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.quick-bar')
    if (!el || !bridge?.quickHeight) return
    const o = new ResizeObserver(() => bridge!.quickHeight!(Math.ceil(el.offsetHeight)))
    o.observe(el)
    return () => o.disconnect()
  }, [!!view])
  if (!view) return null
  const targets = targetsOf(view)
  const at = Math.min(pick, Math.max(0, targets.length - 1))
  const t = targets[at]
  const turn = (d: number) => targets.length && setPick((at + d + targets.length) % targets.length)
  // "@word " at the start: the target whose name has it, the word taken out
  const change = (v: string) => {
    const m = /^@(\S+)\s/.exec(v)
    const i = m ? targets.findIndex(x => squash(x.label).includes(squash(m[1]))) : -1
    if (i >= 0) return setPick(i), setText(v.slice(m![0].length))
    setText(v)
  }
  const mic = () => {
    const box = document.querySelector<HTMLTextAreaElement>('.quick-bar textarea')
    box?.focus()
    if (cloudVoice()) void voiceStart()
    else setTimeout(() => bridge?.dictate?.(), 150) // macOS dictation types where the cursor is: once the box has it
  }
  const snap = () => void bridge?.quickShot?.().then(png => png && setShot(s => ({ n: (s?.n ?? 0) + 1, png })))
  const send = async () => {
    const body = withImages(text, images).trim()
    if (!t || !body || busy || saving) return
    setBusy(true)
    setErr('')
    try {
      if (t.kind === 'new') {
        const last = load<LastNew>(LAST_NEW, {})
        const same = last.project === t.project
        await api.call('wsNew', { project: t.project, prompt: body, place: same && last.place ? last.place : 'top', ...(same && { preset: last.preset, cmd: last.cmd, local: last.local, model: last.model, effort: last.effort, perm: last.perm, fast: last.fast, sandbox: last.sandbox }) })
      } else if (t.kind === 'send') await api.call('send', { target: t.tab, text: body, whenIdle: true, agent: true })
      else await api.call('aiAsk', { text, images: images.map(i => i.path), queue: true })
      window.close()
    } catch (e) {
      setErr((e as Error).message) // the text stays
      setBusy(false)
    }
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return e.preventDefault(), window.close()
    if (e.key === 'Tab' && (e.target as HTMLElement).tagName === 'TEXTAREA') return e.preventDefault(), turn(e.shiftKey ? -1 : 1)
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'm') return e.preventDefault(), mic()
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 's') return e.preventDefault(), snap()
  }
  return (
    <div className="quick-bar" onKeyDownCapture={keys}>
      <div className="quick-head">
        <button type="button" className="quick-chip" onClick={() => turn(1)} title="Where it goes: Tab (⇧Tab) or @name changes it" disabled={targets.length < 2}>
          <Icon name={t?.kind === 'ai' ? 'ai' : t?.kind === 'send' ? 'send' : 'plus'} size={13} />
          {t?.label ?? 'Open a folder first (⌘O in Laki)'}
        </button>
        <span className="grow" />
        {t?.kind === 'new' && (
          <button type="button" className="quick-more" onClick={() => bridge?.quickMore?.(withImages(text, images))} title="The whole new-workspace page: project, agent, template">
            More…
          </button>
        )}
      </div>
      <PromptInput
        value={text}
        onChange={change}
        images={images}
        onImages={setImages}
        save={(data, ext) => api.call<string>('imageSave', { data, ext })}
        onBusy={setSaving}
        onSubmit={send}
        enter
        rows={1}
        shot={shot}
        placeholder={t?.kind === 'send' ? 'Tell the agent…' : t?.kind === 'ai' ? 'Ask Laki AI…' : 'What should the agent do?'}
        tools={
          <>
            <IconButton icon="mic" title="Speak (⌘⇧M)" onClick={mic} />
            {bridge?.quickShot && <IconButton icon="camera" title="A screenshot of a part of the screen (⌘⇧S)" onClick={snap} />}
          </>
        }
        send={
          <button type="button" className="primary" disabled={!t || busy || saving || !(text.trim() || images.length)} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send ⏎'}
          </button>
        }
      />
      {err && (
        <p className="field-err" role="alert">
          {err}
        </p>
      )}
      <AskHost />
      <VoiceBar />
      <Tips />
    </div>
  )
}
