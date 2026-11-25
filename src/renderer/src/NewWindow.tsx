// The floating bubbles' + (and a voice prompt for a new session): the new-workspace page alone, in a window of its own
// over every app (main's newWsWin, ?window=new), so Laki's own window and the app you're in stay where they are. The
// workspace made, or Esc: it closes; the app's sidebar shows the new one. Its Ask Laki AI: the AI page, compact, in one
// too (aiWin, ?window=ai). A tab floated out of the app (a tab's right click › Float): its terminal alone, live, in a
// window over every app (tabWin, ?window=tab&tab=<id>); its ✕ puts it back in the app.
import { type KeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react'
import { type ActionFile, aiOn, veiled, type View, type WorkspaceView } from '../../shared/types'
import { api, bridge, daemonBase, openExternal, reportView } from './api'
import { setSecretHint } from './secretHint'
import { AiPage } from './Ai'
import { Glyph } from './Glyph'
import { type Img, type Inserts, PromptInput, VoiceBar, withImages } from './PromptInput'
import { LAST_NEW, type LastNew, NewWorkspace } from './panels'
import { DeviceTab, FilePreview, SidePanel } from './SidePanel'
import type { Changes, Commits, Edit, FileContent, FileList, FilesRoot, PanelApi, PanelTab, PRFiles, Thread } from './SidePanel'
import type { Annotations, TurnKept } from '../../shared/types'
import { InfoTab } from './Info'
import { SideChat } from './SideChat'
import { useToasts } from './AppParts'
import { usePanelGuest } from './panelWin'
import { applySuggestions } from './text'
import { FONT_SIZE, termLook } from './settingsBase'
import { Term } from './Term'
import { setSendKey } from '../../shared/keys'
import { applyTheme, LESS_CLEAR, macApp, type Paint, paintKey, paintOf, transparent, userCss } from './themes'
import { ask, AskHost, askText, Icon, IconButton, keep, load, Tips, Toasts, useMenu } from './ui'
import { handOff } from './tell'
import { cloudVoice, voiceStart } from './voice'
import { Glyph as ExtGlyph, imagesVia, insertMenus, inWs, WidgetPanel } from './Widgets'
import type { WidgetApi } from './Widgets'
import { placesOf } from '../../shared/types'
import { whenOk } from '../../shared/widgetSchema'
import { hiddenNames, useWinTitle, veiledWs } from './winTitle'
const PANEL_NAME: Record<string, string> = { info: 'Info', files: 'Files', changes: 'Changes', commits: 'Commits', review: 'Review', preview: 'Preview', device: 'Simulator', side: 'Side panel' }

// no glass, no see-through sidebar: the window has no blur behind it
const paint = (p: Paint) => applyTheme(p, true)
// only in those windows: main.tsx imports this module in the app's too
const which = new URLSearchParams(location.search).get('window')
if (which === 'new' || which === 'ai' || which === 'tab' || which === 'sim' || which === 'quick' || which === 'panel') {
  const last = load<string | Paint>('laki.theme', '') // the app's, until the daemon's settings arrive
  paint(typeof last === 'string' ? { theme: last } : last)
  if (which === 'new') document.documentElement.classList.add('new-window') // compact: styles.css' .new-window rules
  if (which === 'quick') document.documentElement.classList.add('quick-window') // the quick bar's: .quick-* rules
  // main gives these two macOS's popover material (panelWin) but under Reduce transparency: a tint over it
  if ((which === 'quick' || which === 'new') && macApp() && !matchMedia(LESS_CLEAR).matches) document.documentElement.classList.add('panel-glass')
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
  setSecretHint(view?.settings.secretHint) // a pasted secret's line (secretHint.tsx)
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
  useWinTitle(t && !veiledWs(view, ws) ? `${t.name}${ws ? ` — ${ws.name || ws.id}` : ''}` : 'Laki', hiddenNames(view)) // "<tab> — <workspace>"; Recording mode: a private one's, Laki
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
  useEffect(() => void bridge?.onNewPrompt?.((p, _project, add) => setText(x => (add && x.trim() ? `${x.trim()}\n\n${p}` : p))), []) // another New task with words: into the box; a drop on the menu bar's item (add): after what's there
  useEffect(
    () =>
      void bridge?.onTell?.(t => {
        // the drawing replaces the picture it was drawn on; a new picture goes after the ones already there
        setImages(x => (y => ((tellAt.current = y.length), y))(t.edited ? x.filter((_, i) => i !== tellAt.current) : x))
        setShot(s => ({ n: (s?.n ?? 0) + 1, png: t.png, ...((t.edited || t.quiet) && { quiet: true }) })) // PromptInput: as if pasted, then the mic (not again for a drawing, nor for a picture dropped on the menu bar's item: Q12's quiet)
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
      await api.callAny(c.method, c.params) // a name it was handed
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
        saveFile={(data, name) => api.call<string>('fileSave', { data, name })}
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

// the side panel in a window of its own (main's panelOpen, ?window=panel; panelWin.ts): the workspace the app window
// shows, with the facts it says. Changes, Files, Review, Preview, Simulator, Side chat and Info work here; a file opens
// in its preview here; comments go to the workspace's agent. What only the app does (a PR's merge, close or approve, Fix,
// a check's log, the PR switches, rename, attach, going to a workspace) goes to the app window, which comes forward.
// Its tab is its own (laki.panelWinTab); Back in Laki (or closing it) puts the panel back there. Its extensions' panel
// tabs draw here (their full view, page, Laki commands and laki:// links: the app window's); the Preview's pick and
// screenshot go to the agent tab the app window shows (says.active), else the workspace's first.
// ponytail: an extension's dialog (say's modal) shows only its toast here
const PANEL_TAB = 'laki.panelWinTab'
export function PanelWindow() {
  const view = useView()
  const [tab, setTab] = useState<PanelTab>(() => load<PanelTab>(PANEL_TAB, 'changes'))
  const pick = (t: PanelTab) => (setTab(t), keep(PANEL_TAB, t))
  const { says, ask: appDo } = usePanelGuest(pick)
  const [root, setRoot] = useState<FilesRoot>('ws')
  const [shown, setShown] = useState<{ path: string; line?: number; storage?: boolean; n: number; edit?: Edit } | null>(null)
  const [menu, openMenu] = useMenu()
  const { notes, setNotes, toast, done, fail } = useToasts()
  const w = says?.ws ? view?.workspaces.find(x => x.id === says.ws && !x.archived) : undefined
  useWinTitle(`${PANEL_NAME[tab] ?? (String(tab).startsWith('ext:') ? 'Extension' : 'Side panel')}${w && !veiledWs(view, w) ? ` — ${w.name || w.id}` : ''}`, hiddenNames(view)) // "<its tab> — <workspace>"
  useEffect(() => setShown(null), [says?.ws])
  if (!view) return null
  const head = (
    <div className="tab-win-head">
      <b>{w ? w.name || w.id : 'Side panel'}</b>
      <span className="grow" />
      <IconButton icon="popIn" title="Back in Laki" onClick={() => window.close()} />
    </div>
  )
  if (!w || !says?.info) return <div className="tab-window panel-window">{head}<div className="muted pad">{says ? 'No workspace open in Laki’s window.' : 'Waiting for Laki’s window…'}</div></div>
  const ws = w.id
  const agentTabs = view.tabs.filter(t => t.workspace === ws && t.kind === 'agent' && t.status !== 'exited').sort((a, b) => Number(b.id === says.active) - Number(a.id === says.active)) // the app window's on screen first
  const preview = (path: string, line?: number, storage?: boolean) => setShown(s => ({ path, line, storage, n: (s?.n ?? 0) + 1 }))
  const revertOk = (file: string, part?: string, uncommitted?: boolean) => ask(part ? `Revert ${part} in ${file.split('/').pop()}?` : `Revert ${file.split('/').pop()}?`, { text: `Back to how it is ${uncommitted ? 'in the last commit' : `on ${w.base ?? 'the base'}`}. Nothing is committed; Undo is in the toast.${agentTabs.some(t => t.status === 'running') ? ' Its agent is working here: it may write it again.' : ''}`, ok: 'Revert', danger: true })
  const redo = (id: string, then?: () => void) => api.call('hunkRedo', { ws, id }).then(() => (then?.(), done('Back as it was')), fail)
  const fileMenu = (e: ReactMouseEvent, path: string, storage?: boolean) =>
    openMenu(e, [
      { label: 'Preview', icon: 'eye', run: () => preview(path, undefined, storage) },
      { label: storage ? 'Open' : 'Open in editor', icon: 'file', run: () => void api.call('openIn', { ws, app: storage ? 'default' : 'editor', file: path, storage }).catch(fail) },
      { label: 'Show in Finder', icon: 'folder', run: () => void api.call('openIn', { ws, app: 'finder', file: path, storage }).catch(fail) },
      { label: 'Copy path', icon: 'copy', run: () => void navigator.clipboard.writeText(path).then(() => done('Copied')) },
    ])
  const papi: PanelApi = {
    files: () => api.call<FileList>('files', { ws }),
    ...(w.annotAt && { annots: () => api.call<Annotations>('widgetAnnotations', { ws }), annotAt: w.annotAt }),
    newFile: (path, dir) => api.call<{ path: string }>('fileNew', { ws, path, dir }).then(r => r.path),
    openFile: file => void api.call('openIn', { ws, app: 'editor', file }).catch(fail),
    preview: (path, line) => preview(path, line),
    changes: uncommitted => api.call<Changes>('diff', { ws, uncommitted }),
    prChanges: () => api.call<Changes>('prDiff', { ws }),
    sinceChanges: () => api.call<Changes>('diff', { ws, since: true }),
    commitChanges: sha => api.call<Changes>('diff', { ws, since: sha }),
    turnChanges: n => api.call<Changes>('turnDiff', { ws, ...(n !== undefined && { n }) }),
    turns: () => api.call<TurnKept[]>('turnList', { ws }),
    ...(w.kind === 'worktree' && { bases: () => api.call('baseBranches', { ws }), setBase: (base: string) => api.call('wsBase', { ws, base }) }),
    commits: () => api.call<Commits>('commits', { ws }),
    commitDiff: sha => api.call<Changes>('commitDiff', { ws, sha }),
    prFiles: () => api.call<PRFiles>('prFiles', { ws }),
    setViewed: (path, viewed, id) => api.call('prViewed', { ws, path, viewed, id }),
    read: (path, base, uncommitted) => api.call<FileContent>('fileRead', { ws, path, base, uncommitted }),
    prFile: path => api.call<FileContent>('prFile', { ws, path }),
    agents: agentTabs.map(t => ({ id: t.id, name: t.name })),
    threads: () => api.call<Thread[]>('prThreads', { ws }),
    apply: async (path, edits, then) => {
      const was = (await api.call<FileContent>('fileRead', { ws, path })).text
      if (was === undefined) return toast(`${path} isn't text`)
      let text: string
      try {
        text = applySuggestions(was, edits)
      } catch (e) {
        return toast(`${path.split('/').pop()}: ${(e as Error).message}: nothing applied`)
      }
      await api.call('fileWrite', { ws, path, text, was })
      then?.()
      done(`Applied ${edits.length === 1 ? 'the suggestion' : `${edits.length} suggestions`}`, () => void api.call('fileWrite', { ws, path, text: was, was: text }).then(() => (then?.(), done('Back as it was')), fail))
    },
    comment: c => api.call('prComment', { ws, ...c }).then(() => toast(`Commented on PR #${w.pr?.number}`)),
    toAgent: (text, _line, to) => api.call('send', { target: to ?? ws, text, whenIdle: true, steer: true }).then(() => toast(`Sent to ${(to && view.tabs.find(t => t.id === to)?.name) || 'the agent'}`)),
    saveImage: data => api.call<string>('imageSave', { data, ext: 'png' }),
    toPrompt: text => api.call('send', { target: agentTabs[0]?.id ?? ws, text, enter: false }),
    sourceGuess: words => api.call<string[]>('sourceGuess', { ws, words }).catch(() => []),
    sim: p => api.call('sim', p),
    menu: (e, path) => fileMenu(e, path),
    look: bridge?.quickLook && !w.host ? (path, storage) => (r => r && bridge!.quickLook!(`${r}/${path}`))(storage ? w.storage : w.path) : undefined,
    drag: bridge?.dragOut && !w.host ? (path, storage) => (r => r && bridge!.dragOut!(`${r}/${path}`, r))(storage ? w.storage : w.path) : undefined,
    web: (path, at, line) => void api.call<{ url: string }>('fileWeb', { ws, path, at, line }).then(r => openExternal(r.url), fail),
    undoHunk: async (path, hunk, lines, then, uncommitted) => {
      if (!(await revertOk(path, lines ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : 'this hunk', uncommitted))) return false
      const { id } = await api.call<{ id: string }>('hunkUndo', { ws, path, hunk, lines, uncommitted })
      then?.()
      done(`Reverted ${lines ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : '1 hunk'} in ${path.split('/').pop()}`, () => void redo(id, then))
      return true
    },
    undoFile: async (path, then, uncommitted) => {
      if (!(await revertOk(path, undefined, uncommitted))) return false
      const { id } = await api.call<{ id: string }>('fileUndo', { ws, path, uncommitted })
      then?.()
      done(`Reverted ${path.split('/').pop()}`, () => void redo(id, then))
      return true
    },
    redo: id => redo(id),
    artifacts: w.storage
      ? {
          files: () => api.call<{ path: string }[]>('artifactList', { ws }).then(l => ({ files: l.map(f => f.path), changed: {} })),
          preview: path => preview(path, undefined, true),
          open: path => void api.call('openIn', { ws, app: 'default', file: path, storage: true }).catch(fail),
          menu: (e, path) => fileMenu(e, path, true),
        }
      : undefined,
  }
  const side = agentTabs[0]
  // the workspace's extensions with a panel tab (as the app window's: Chrome.tsx ownWidgets), their calls the daemon's,
  // what only App does asked of it
  const extApi: WidgetApi = {
    store: (id, op, key, value, at) => api.call('widgetStore', { id, op, key, value, ws: at }),
    render: (id, full, sample, cells, at, turn) => api.call<string | null>('widgetRender', { id, full, ...(sample && { sample }), ...(cells && { cells }), ws: at, ...(turn && { turn }) }),
    run: (id, at) => api.call('widgetRun', { id, ws: at }),
    open: url => (/^laki:\/\//i.test(url) ? appDo({ op: 'link', url }) : openExternal(url)),
    copy: text => void navigator.clipboard.writeText(text).then(() => done('Copied')),
    full: (id, at) => appDo({ op: 'ext', id, ws: at ?? ws }),
    close: () => {},
    action: (id, action, arg, label, at) =>
      api.call<{ ok: boolean; error?: string; fail?: { hint?: string }; open?: string; send?: string; toast?: string }>('widgetAction', { id, action, arg, ws: at }).then(
        r => (!r.ok ? (toast(`${label || action} failed: ${r.fail?.hint ?? r.error}`), false as const) : (r.open && extApi.open(r.open), r.send && void api.call('send', { target: agentTabs[0]?.id ?? ws, text: r.send, whenIdle: true }), r.toast && done(r.toast), undefined)),
        e => (toast(`${label || action} failed: ${(e as Error).message}`), false as const),
      ),
    say: (_id, s) => void (s.toast && done(s.toast)),
    do: (x, cmd, label) => appDo({ op: 'extDo', id: x.id, cmd, label }),
    settings: (id, key) => appDo({ op: 'ext', id: id ?? '', page: true, key }),
  }
  const whenHere = { projectName: view.projects.find(p => p.id === w.project)?.name, agents: view.tabs.filter(t => t.workspace === ws && t.kind === 'agent').map(t => t.status) }
  const ext = (view.widgets ?? [])
    .map(x => inWs(x, ws))
    .filter(x => x.on && placesOf(x).includes('panel') && (!x.project || x.project === w.project) && !x.hidden && whenOk(x.when, w, whenHere))
    .map(x => ({ id: `ext:${x.id}` as const, label: x.name, icon: <ExtGlyph w={x} size={14} />, body: <WidgetPanel w={x} api={extApi} /> }))
  return (
    <div className="tab-window panel-window">
      {shown ? (
        <FilePreview
          key={shown.n}
          path={shown.path}
          line={shown.line}
          load={() => api.call<FileContent>('fileRead', { ws, path: shown.path, storage: shown.storage, media: true })}
          db={q => api.call('dbRead', { ws, path: shown.path, storage: shown.storage, ...q })}
          onOpen={() => void api.call('openIn', { ws, app: shown.storage ? 'default' : 'editor', file: shown.path, storage: shown.storage }).catch(fail)}
          onReveal={() => void api.call('openIn', { ws, app: 'finder', file: shown.path, storage: shown.storage }).catch(fail)}
          openLabel={shown.storage ? 'Open' : undefined}
          readOnly={shown.storage}
          onClose={() => setShown(null)}
          edit={shown.edit}
          onEdit={edit => setShown(s => s && { ...s, edit })}
          save={(text, was, force) => api.call('fileWrite', { ws, path: shown.path, text, was, force })}
        />
      ) : (
        <SidePanel
          w={says.info}
          git={says.git !== false}
          tab={tab}
          onTab={pick}
          api={papi}
          sim={says.sim}
          turn={says.turn}
          width={0}
          onWidth={() => {}}
          onClose={() => window.close()}
          float={{ out: true, go: () => window.close() }}
          onOpen={openExternal}
          onToggle={(k, v) => appDo({ op: 'auto', ws, k, v })}
          onFix={what => appDo({ op: 'fix', ws, what })}
          onLog={check => appDo({ op: 'log', ws, check })}
          onAct={(act, method) => appDo({ op: 'act', ws, act, method })}
          root={w.storage ? root : 'ws'}
          onRoot={setRoot}
          side={side && <SideChat key={side.id} tab={side} onSent={done} />}
          ext={ext}
          info={
            <InfoTab
              w={says.info}
              onOpen={openExternal}
              onToggle={(k, v) => appDo({ op: 'auto', ws, k, v })}
              onFix={what => appDo({ op: 'fix', ws, what })}
              onLog={check => appDo({ op: 'log', ws, check })}
              onAct={(act, method) => appDo({ op: 'act', ws, act, method })}
              onRename={() => appDo({ op: 'rename', ws })}
              onAttach={!w.pr && w.branch && !w.term ? () => appDo({ op: 'attach', ws }) : undefined}
              onCopy={text => void navigator.clipboard.writeText(text).then(() => done('Copied'))}
              onWs={id => appDo({ op: 'go', ws: id })}
              onTab={(to, t) => appDo({ op: 'go', ws: to, tab: t })}
              onSees={agent => appDo({ op: 'sees', agent, project: w.project })}
              tabName={id => view.tabs.find(t => t.id === id)?.name ?? id}
            />
          }
        />
      )}
      {menu}
      <AskHost />
      <Toasts toasts={notes} drop={id => setNotes(l => (id === undefined ? [] : l.filter(x => x.id !== id)))} Busy={<Glyph s="running" />} />
      <Tips />
    </div>
  )
}
