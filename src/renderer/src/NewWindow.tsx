// The floating bubbles' + (and a voice prompt for a new session): the new-workspace page alone, in a window of its own
// over every app (main's newWsWin, ?window=new), so Laki's own window and the app you're in stay where they are. The
// workspace made, or Esc: it closes; the app's sidebar shows the new one. Its Ask Laki AI: the AI page, compact, in one
// too (aiWin, ?window=ai). A tab floated out of the app (a tab's right click › Float): its terminal alone, live, in a
// window over every app (tabWin, ?window=tab&tab=<id>); its ✕ puts it back in the app.
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
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
import { handOff } from './tell'
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
  const [ask, setAsk] = useState(() => (q => ({ n: 0, prompt: q.get('prompt') ?? undefined, project: q.get('project') ?? undefined }))(new URLSearchParams(location.search))) // another voice prompt: the page anew with it; project: Q5's new task in it
  useEffect(() => void bridge?.onNewPrompt?.((prompt, project) => setAsk(a => ({ n: a.n + 1, prompt, project }))), [])
  // the window as tall as the page: the head, the form and the body's padding, again as the form changes
  const ready = !!view
  useEffect(() => {
    const form = document.querySelector<HTMLElement>('.new-ws')
    const body = form?.parentElement
    if (!form || !body || !bridge?.fitNew) return
    const fit = () => {
      const pad = getComputedStyle(body)
      const rows = Math.max(form.offsetHeight, form.scrollHeight) // nw-top's negative margin, a wrapped row: all of it, never a scrollbar
      bridge!.fitNew!(Math.ceil((document.querySelector<HTMLElement>('.settings-head')?.offsetHeight ?? 0) + parseFloat(pad.paddingTop) + rows + parseFloat(pad.paddingBottom)) + 1)
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
        initial={ask.prompt ? { prompt: ask.prompt, ...(ask.project && view.projects.some(p => p.id === ask.project) && { project: ask.project }) } : undefined}
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
// new-workspace page with the text, its project, agent and template pickers. Q7, show and tell (main's tellShot): it
// opens with a screenshot in it and the mic on (cloud voice, or macOS dictation when it's on; neither: the box to type
// in); ⏎ sends both (tell.ts handOff), E (in an empty box, or ⌘E) draws on it first (the editor, back here), Esc drops both
type Target = { kind: 'new'; project: string; label: string } | { kind: 'send'; tab: string; label: string } | { kind: 'ai'; label: string }
// a target by what it is, not where it is in the list: one picked stays picked as the list changes
const keyOf = (t: Target) => (t.kind === 'send' ? `send:${t.tab}` : t.kind)
function targetsOf(view: View, keep?: string): Target[] {
  const last = load<LastNew>(LAST_NEW, {})
  const projects = view.projects.filter(p => !p.kind && !p.archived)
  const proj = projects.find(p => p.id === last.project) ?? projects[0]
  const live = new Set(view.workspaces.filter(w => !w.archived).map(w => w.id))
  return [
    ...(proj ? [{ kind: 'new' as const, project: proj.id, label: `New workspace in ${proj.name}` }] : []),
    ...view.tabs
      .filter(t => t.kind === 'agent' && live.has(t.workspace) && (t.status === 'waiting' || t.status === 'idle' || keep === `send:${t.id}`)) // the one picked stays while it works (Send queues for it)
      .map(t => ({ kind: 'send' as const, tab: t.id, label: `${t.name} · ${(w => w?.name || w?.id || '')(view.workspaces.find(w => w.id === t.workspace))}` })),
    ...(aiOn(view.settings) ? [{ kind: 'ai' as const, label: 'Laki AI' }] : []),
  ]
}
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
export function QuickWindow() {
  const view = useView()
  const [text, setText] = useState(new URLSearchParams(location.search).get('prompt') ?? '')
  const [images, setImages] = useState<Img[]>([])
  const [pick, setPick] = useState<string>() // keyOf the picked target (none: the first)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shot, setShot] = useState<{ n: number; png: string; quiet?: boolean }>()
  const tellAt = useRef(-1) // Q7: where its picture is among the images (PromptInput adds it last), for the drawing that replaces it
  const [tell, setTell] = useState<{ png: string; mic: string; dictation: boolean }>() // Q7: its picture now, Laki's Microphone access, macOS dictation on
  useEffect(() => void bridge?.onNewPrompt?.(p => setText(p)), []) // another New task with words: into the box
  useEffect(
    () =>
      void bridge?.onTell?.(t => {
        // the drawing replaces the picture it was drawn on; a new picture goes after the ones already there
        setImages(x => (y => ((tellAt.current = y.length), y))(t.edited ? x.filter((_, i) => i !== tellAt.current) : x))
        setShot(s => ({ n: (s?.n ?? 0) + 1, png: t.png, ...(t.edited && { quiet: true }) })) // PromptInput: as if pasted, then the mic (not again for a drawing)
        if (t.note) setText(x => [x.trim(), t.note!.trim()].filter(Boolean).join('\n'))
        setTell(x => ({ png: t.png, mic: t.mic ?? x?.mic ?? 'granted', dictation: t.dictation ?? x?.dictation ?? false }))
        setErr(!t.edited && cloudVoice() && t.mic === 'denied' ? 'mic' : '')
        // macOS dictation once the bar has the keyboard (cloud voice: PromptInput starts it with the picture)
        if (t.edited || !t.dictation || cloudVoice()) return
        const go = () => (document.querySelector<HTMLTextAreaElement>('.quick-bar textarea')?.focus(), setTimeout(() => bridge?.dictate?.(), 150))
        if (document.hasFocus()) setTimeout(go, 50)
        else window.addEventListener('focus', go, { once: true })
      }),
    [],
  )
  useEffect(() => void (document.title = 'New task — Laki'), [])
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.quick-bar')
    if (!el || !bridge?.quickHeight) return
    const o = new ResizeObserver(() => bridge!.quickHeight!(Math.ceil(el.offsetHeight)))
    o.observe(el)
    return () => o.disconnect()
  }, [!!view])
  if (!view) return null
  const targets = targetsOf(view, pick)
  const at = Math.max(0, targets.findIndex(x => keyOf(x) === pick)) // gone (its workspace archived): the first
  const t = targets[at]
  const turn = (d: number) => targets.length && setPick(keyOf(targets[(at + d + targets.length) % targets.length]))
  // "@word " at the start: the target whose name has it, the word taken out
  const change = (v: string) => {
    const m = /^@(\S+)\s/.exec(v)
    const i = m ? targets.findIndex(x => squash(x.label).includes(squash(m[1]))) : -1
    if (i >= 0) return setPick(keyOf(targets[i])), setText(v.slice(m![0].length))
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
      const c = handOff(t, text, images.map(i => i.path), load<LastNew>(LAST_NEW, {}))
      await api.call(c.method, c.params)
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
    // Q7: E draws on the picture first (an empty box: what you'd say isn't typed yet; ⌘E any time)
    if (tell && e.key.toLowerCase() === 'e' && !e.altKey && !e.ctrlKey && !e.shiftKey && (e.metaKey || !text.trim())) return e.preventDefault(), bridge?.quickAnnotate?.(tell.png)
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
        placeholder={tell ? (cloudVoice() || tell.dictation ? 'Say what to do with it… (or type)' : 'Type what to do with it…') : t?.kind === 'send' ? 'Tell the agent…' : t?.kind === 'ai' ? 'Ask Laki AI…' : 'What should the agent do?'}
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
      {tell && !err && <p className="muted small quick-tell">⏎ sends the picture and the words · E draws on it first · Esc drops both</p>}
      {err === 'mic' ? (
        <p className="field-err" role="alert">
          Microphone is off for Laki: type instead, or turn Laki on in{' '}
          <button type="button" className="link" onClick={() => bridge?.privacyPane?.('microphone')}>
            System Settings › Privacy &amp; Security › Microphone
          </button>
        </p>
      ) : (
        err && (
          <p className="field-err" role="alert">
            {err}
          </p>
        )
      )}
      <AskHost />
      <VoiceBar />
      <Tips />
    </div>
  )
}
