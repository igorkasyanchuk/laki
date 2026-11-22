// App's side of extensions: one's text into an agent, which ones show where, their menus' items and runs, the
// prompt's inserts, the widget API their views call (widgetApi), a UI kit's do (widgetDo), a repo's .laki.json and
// extension sheets; computed inline in App's render (r: App's values this render), as they were in App
import { type ActionFile, type Agent, aiOn, neverAsks, PERMS, type Project, type Settings, type TabView, type View, type WidgetCtx, type WidgetFail, type WidgetMenu, type WidgetView, type WorkspaceView } from '../../shared/types'
import type { Inserted, Inserts } from './PromptInput'
import { ask, askText, choose, type MenuItem, TAB_COLORS, type Toast } from './ui'
import type { UiDo } from '../../shared/widgetUi'
import { insertMenus, inWs, type WidgetApi } from './Widgets'
import type { SayModal, WidgetSay } from '../../shared/widget'
import { api, type Msg, openExternal } from './api'
import { askTool } from './AppParts'
import { extMenuItems } from './extMenu'
import { globMatch } from '../../shared/widgetSchema'
import { hasCap } from '../../shared/caps'
import { nameOf, withPaths } from './text'
import { xterms } from './Term'
import type { Call } from '../../shared/api'
import type { Dialog, Opened } from './appCtx'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { WidgetsApi } from './Settings'

export type WidgetsIn = {
  call: Call
  copy: (text: string) => Promise<void>
  dialog: Dialog
  done: (text: string, undo?: () => void) => void
  extCfg: WidgetsApi
  extN: RefObject<number>
  fail: (e: unknown) => void
  openFile: (f: Omit<Opened, 'n'>) => void
  openMenu: (e: React.MouseEvent | DOMRect, items: MenuItem[], align?: 'left' | 'right') => void
  quickNew: (kind: 'shells' | 'browsers', url?: string, front?: boolean, at?: { project: string; place?: string; }) => Promise<void>
  railColor: (key: string, c: string) => void
  railColors: Record<string, string>
  selectTab: (ref: string | { id: string; workspace: string; }) => void
  setAiFloat: Dispatch<SetStateAction<boolean>>
  setDialog: Dispatch<SetStateAction<Dialog>>
  setExtModal: Dispatch<SetStateAction<{ wid: string; ws?: string; m: SayModal; n: number; } | null>>
  setLink: Dispatch<SetStateAction<string | undefined>>
  setNote: (n: Omit<Toast, 'id' | 'at'> | null) => void
  setWsId: Dispatch<SetStateAction<string | null>>
  settings: Settings
  showNew: (id: string, ...more: string[]) => void
  tab: TabView
  termType: (cmd: string, project?: string, opened?: (tab: string, ws: string) => void) => Promise<void>
  toast: (text: string, undo?: () => void, label?: string, ok?: boolean, err?: boolean, ms?: number) => void
  toolAsk: RefObject<((m: Msg) => void) | undefined>
  view: View | null
  widgetSay: RefObject<((id: string, s: WidgetSay, ws?: string) => void) | undefined>
  ws: WorkspaceView | null
}

export function widgetsOf(r: WidgetsIn) {
  const { call, copy, dialog, done, extCfg, extN, fail, openFile, openMenu, quickNew, railColor, railColors, selectTab, setAiFloat, setDialog, setExtModal, setLink, setNote, settings, setWsId, showNew, tab, termType, toast, toolAsk, view, widgetSay, ws } = r
  const intoAgent = (wsId: string, text: string) => {
    const live = view?.tabs.filter(t => t.workspace === wsId && t.kind === 'agent' && t.status !== 'exited') ?? []
    const to = live.find(t => t.id === tab?.id) ?? live[0]
    if (!to) return Promise.reject(new Error('No agent runs here: start one (＋ in the tab bar)'))
    return api.call('send', { target: to.id, text, enter: false }).then(() => (selectTab(to.id), xterms.get(to.id)?.focus(), toast(`In ${to.name}'s prompt: say what to do with it`)))
  }
  // extensions' actions offered where you work (widget.json's show and key: WidgetMenu), of the ones on: a place's, a
  // workspace's (not a terminal's, a browser's or a host's: no extensions there), a file's by match
  const extWs = (x?: WorkspaceView | null) => (x && !x.archived && !x.host && !view?.projects.find(p => p.id === x.project)?.kind ? x : undefined)
  const extOn = (x?: WorkspaceView | null) => (view?.widgets ?? []).filter(w => w.on && (w.scope !== 'workspace' || extWs(x)) && (!w.project || w.project === x?.project)) // a repo's: its project's only
  const extMenus = (show: string, x?: WorkspaceView | null, file?: string) => extOn(x).flatMap(w => (w.menus ?? []).filter(m => m.show.includes(show) && (!file || !m.match?.length || m.match.some(g => globMatch(g, file)))).map(m => ({ w, m })))
  const keyText = (k: string) => k.replace('Ctrl+', '⌃').replace('Alt+', '⌥').replace('Shift+', '⇧').replace('Cmd+', '⌘')
  const hereCtx = (): WidgetCtx => (x => ({ ws: x?.id, tab: x && tab?.workspace === x.id ? tab.id : undefined }))(extWs(ws))
  // a run: its confirm and ask first, then widgetAction with where it was picked (ctx); insert and files (#26): into the
  // box it was picked in (into), else the workspace's agent's prompt (files as paths), else the clipboard; open: the link
  // after (laki://: the router); view: its full view after
  const extRun = async (w: WidgetView, m: WidgetMenu, ctx: WidgetCtx, into?: (t: Inserted) => void) => {
    if (m.confirm && !(await ask(m.confirm, { text: `${w.name} · ${m.title}`, ok: m.title }))) return
    const arg = m.ask ? await askText(m.ask, { text: `${w.name} · ${m.title}`, ok: m.title }) : ''
    if (arg === null) return
    setNote({ text: `${m.title}…`, busy: true })
    type R = { ok: boolean; out?: string; error?: string; insert?: string; open?: string; send?: string; files?: ActionFile[] } & WidgetSay
    const r = await api.call<R>('widgetAction', { id: w.id, action: m.action, arg, ws: w.scope === 'workspace' ? ctx.ws : undefined, ctx }).catch((e): R => ({ ok: false, error: String(e?.message ?? e) }))
    if (!r.ok) return toast(`${m.title} failed: ${r.error}`)
    setNote(null)
    const put = r.insert !== undefined || !!r.files?.length
    const text = withPaths(r.insert ?? '', (r.files ?? []).map(f => f.path))
    if (put) into ? into({ text: r.insert ?? '', files: r.files }) : ctx.ws ? await intoAgent(ctx.ws, text).catch(e => toast(String(e.message))) : copy(text)
    if (r.open) widgetApi.open(r.open)
    if (r.send) void widgetDo(inWs(w, ctx.ws), { do: 'send', prompt: r.send }, m.title) // to the workspace's agent, asked first
    if (r.toast || r.modal) widgetApi.say(w.id, r, ctx.ws)
    else if (!put && !r.open && !r.send && !m.view) done(r.out || `${m.title}: done`)
    // a file opener's: its full view as a tab beside the file's in the preview, else a dialog
    if (m.view) ctx.file && ctx.ws && w.full ? openFile({ ws: ctx.ws, path: ctx.file, ext: w.id, ...(ctx.storage && { storage: true }) }) : setDialog(w.full ? { widget: w.id, back: dialog } : { extension: w.id, back: dialog })
  }
  const extItems = (show: string, x: WorkspaceView | undefined | null, ctx: WidgetCtx, file?: string): MenuItem[] => (l => (!extWs(x) ? [] : l.length ? [null, { head: 'Extensions' }, ...l.map(({ w, m }): MenuItem => ({ label: m.title, sub: w.name, icon: 'panel', hint: m.key && keyText(m.key), run: () => void extRun(w, m, ctx) }))] : []))(extMenus(show, x, file)) // none in a terminal's, a browser's, a host's or an archived one: ctxOf refuses those
  // a box's Insert menu (the new-workspace page's, Laki AI's, Send later's): an action's text at its cursor, its files
  // with it. ctx: the workspace and tab it types for (a per-workspace one's there, a repo's of its project); project: the
  // new-workspace page's pick, before there's a workspace
  const extInserts = (ctx: WidgetCtx = {}, project?: string): Inserts => {
    const x = extWs(view?.workspaces.find(w => w.id === ctx.ws))
    const at: WidgetCtx = x ? { ws: x.id, tab: ctx.tab } : {}
    return insertMenus(view?.widgets, x?.id, x?.project ?? project).map(({ w, m }) => ({ label: m.title, sub: w.name, run: () => new Promise<Inserted | undefined>(res => void extRun(w, m, at, res).then(() => res(undefined))) }))
  }
  const openPort = (port: number) => openExternal(`http://localhost:${port}`)
  // widgets: the sidebar's grid and a widget's dialog (Widgets.tsx)
  const widgetApi: WidgetApi = {
    store: (id, op, key, value, ws) => api.call('widgetStore', { id, op, key, value, ws }),
    ...(hasCap(view, 'kit.term') && { term: (id: string, key: string, ws?: string) => api.call<{ tab: string }>('widgetTerm', { id, key, ws }) }),
    render: (id, full, sample, cells, ws, turn) => api.call<string | null>('widgetRender', { id, full, ...(sample && { sample }), ...(cells && { cells }), ws, ...(turn && { turn }) }),
    run: (id, ws) => call('widgetRun', { id, ws }),
    open: url => (/^laki:\/\//i.test(url) ? setLink(url) : openExternal(url)),
    copy: text => void copy(text),
    full: (id, at) => (at && setWsId(at), setDialog({ widget: id, back: dialog })), // at: a row mark's workspace, selected first: its instance shows
    close: () => setDialog(d => (d && typeof d === 'object' && 'widget' in d ? (d.back ?? null) : d)), // the full view's (Esc in its frame), not a page's

    action: (id, action, arg, label, ws) => {
      const what = label || action
      setNote({ text: `${what}…`, busy: true }) // something is happening, until it says what
      return api.call<{ ok: boolean; out?: string; error?: string; fail?: WidgetFail; open?: string; send?: string } & WidgetSay>('widgetAction', { id, action, arg, ws }).then(
        r => (!r.ok ? (toast(`${what} failed: ${r.fail?.hint ?? r.error}`), false as const) : (r.open && widgetApi.open(r.open), r.send && (w => w && void widgetDo(inWs(w, ws ?? null), { do: 'send', prompt: r.send! }, what))(view?.widgets?.find(x => x.id === id)), r.toast || r.modal || r.close ? (setNote(null), widgetApi.say(id, r, ws)) : r.open || r.send ? setNote(null) : done(r.out || `${what}: done`))), // #26: its link opened after it; send: to the agent, asked first
        e => (toast(`${what} failed: ${(e as Error).message}`), false as const), // false: the kit's slider, pick or box goes back
      )
    },
    // a toast; a close (true: its dialog, else the one with that id) before a dialog: one with the shown one's id is
    // drawn in its place, any other replaces it
    say: (id, s, ws) => {
      if (s.toast) done(s.toast)
      if (s.close || s.modal)
        setExtModal(x => {
          const cur = x && x.wid === id && (s.close === true || (s.close && x.m.id === s.close)) ? null : x
          if (!s.modal) return cur
          return { wid: id, ws, m: s.modal, n: cur?.wid === id && s.modal.id && cur.m.id === s.modal.id ? cur.n : ++extN.current }
        })
    },
    do: (w, c, label) => widgetDo(w, c, label),
    settings: (id, key) => setDialog(id ? { extension: id, back: dialog, ...(key && { edit: key }) } : { section: 'widgets' }),
    menu: (w, e) => openMenu(e, [{ head: w.name }, ...((e.currentTarget as Element).closest?.('.rail') ? [{ colors: TAB_COLORS, value: railColors[`widget:${w.id}`], pick: (c: string) => railColor(`widget:${w.id}`, c) }, null] : []), ...widgetApi.items!(w)]), // on the rail: its color too
    items: w => [
      ...(w.every !== undefined && w.on && w.here !== null ? [{ label: 'Fetch now', icon: 'refresh' as const, run: () => void call('widgetRun', { id: w.id, ws: w.here }) }] : []),
      { label: 'Inspect', icon: 'search' as const, sub: 'its data, runs, env and files', run: () => setDialog({ extension: w.id, back: dialog, tab: 'data' }) },
      { label: 'Logs', icon: 'file' as const, sub: w.log ? 'what it did, its runs and stderr' : 'off: Keep a log turns it on', run: () => setDialog({ extension: w.id, back: dialog, tab: 'logs' }) },
      { label: 'Edit', icon: 'settings' as const, sub: 'its place, settings and Laki AI', run: () => setDialog({ extension: w.id, back: dialog }) },
      null,
      ...extMenuItems(w, extCfg),
    ],
    log: (id, text, ws) => void api.call('widgetLog', { id, text, ws, src: 'page' }).catch(() => {}),
    fix: w => (w.fail?.cmd ? void termType(w.fail.cmd) : setDialog({ extension: w.id, back: dialog, tab: 'data' })), // R1: typed, not run; else its data and runs
  }
  widgetSay.current = widgetApi.say
  // a widget button's Laki command (the UI kit's do, a JS page's laki.do): said and asked first (a page in a browser
  // tab only opens, like a link), then done. Its workspace: a per-workspace one's, else the selected one
  const widgetDo = async (w: WidgetView, c: UiDo, label?: string) => {
    if (!w.on) return toast(`${w.name} is off: turn it on first`) // as its actions: an off one does nothing
    const by = `${w.name}${label ? ` › ${label}` : ''} asks`
    const shown = (t: string) => `“${t}”` // all of it: the dialog scrolls, and a cut could hide what runs
    const unseen = /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/ // control and direction characters: ⌃U would hide a line's start
    const bad = [c.prompt, c.command].find(t => typeof t === 'string' && (t.length > 4000 || unseen.test(t)))
    if (bad !== undefined) return toast(`${w.name}: its ${c.command === bad ? 'command' : 'prompt'} is too long or has characters the dialog can't show`)
    const here = w.here ? view?.workspaces.find(x => x.id === w.here) : ws
    const prompt = String(c.prompt ?? '').trim()
    if (c.do === 'browse') {
      const url = String(c.url ?? '').trim()
      return /^https?:\/\/\S+$/i.test(url) ? quickNew('browsers', url) : toast(`${w.name}: no http(s) page to open`)
    }
    if (c.do === 'terminal') {
      const cmd = String(c.command ?? '').trim()
      if (!cmd || /[\r\n]/.test(cmd)) return toast(`${w.name}: no command (one line) to run`)
      if (!(await ask('Run this in a new terminal?', { text: `${by}: ${shown(cmd)}`, ok: 'Run', danger: true }))) return
      const t = await call<WorkspaceView>('quickNew', { kind: 'shells' }).catch(() => null)
      if (!t) return
      showNew(t.id)
      setDialog(null)
      // ponytail: laki_shell's 1.5 s for the shell's prompt to come up
      return void setTimeout(() => void call('send', { target: `${t.id}/1`, text: cmd }).catch(() => {}), 1500)
    }
    if (!prompt) return toast(`${w.name}: no prompt to send`)
    if (c.do === 'ai') {
      if (!aiOn(settings)) return toast('Laki AI is off: Settings › AI')
      if (!(await ask('Ask Laki AI this?', { text: `${by}: ${shown(prompt)}`, ok: 'Ask' }))) return
      if (settings.ai?.float === false) setDialog('ai')
      else setAiFloat(true)
      void api.call('aiAsk', { text: prompt }).catch(fail)
      return true
    }
    if (c.do === 'send') {
      if (!here || view?.projects.find(x => x.id === here.project)?.kind) return toast(`${w.name}: select a workspace with an agent to send it to`)
      if (!(await ask(`Send this to ${here.name}’s agent?`, { text: `${by}: ${shown(prompt)}`, ok: 'Send' }))) return
      const r = await call<{ queued?: number }>('send', { target: here.id, text: prompt, whenIdle: true, agent: true }).catch(() => null)
      if (r) done(r.queued ? `Queued for ${here.name}’s agent` : `Sent to ${here.name}’s agent`)
      return !!r
    }
    if (c.do === 'new') {
      const want = String(c.project ?? '').trim().toLowerCase()
      const p = want ? view?.projects.find(x => x.id.toLowerCase() === want || x.name.toLowerCase() === want) : view?.projects.find(x => x.id === here?.project)
      if (!p || p.kind) return toast(want ? `${w.name}: no project ${c.project}` : `${w.name}: select a workspace of the project to start it in`)
      const agent = String(c.agent ?? '').trim()
      // #30: its model, effort, mode and fast mode (wsNew checks them); never an agent that doesn't ask, by the mode it
      // asks for or its profile's own
      const pr = view?.presets.find(x => x.name === (agent || settings.agent)) ?? (agent ? undefined : view?.presets.find(x => x.agent !== 'command')) // an agent named but no profile of it: that agent itself, never another's mode
      const kind = pr?.agent ?? (agent || 'claude')
      const [model, effort, perm] = [c.model, c.effort, c.perm].map(x => String(x ?? '').trim() || undefined)
      if (neverAsks(kind, perm ?? pr?.perm, pr?.args)) return toast(`${w.name}: an extension never starts an agent that doesn't ask first${perm ? ` (${perm})` : ` (${pr?.name}'s mode)`}`)
      const how = [model, effort && `${effort} effort`, perm && (PERMS[kind as Agent]?.find(x => x[0] === perm)?.[1] ?? perm), c.fast && 'fast mode'].filter(Boolean).join(', ')
      if (!(await ask(`Start a new workspace in ${p.name}?`, { text: `${by}${agent ? `, with ${agent}` : ''}${how ? ` (${how})` : ''}: ${shown(prompt)}`, ok: 'Start' }))) return
      const made = await call<WorkspaceView>('wsNew', { project: p.id, prompt, place: 'top', ...(agent && { preset: agent }), ...(model && { model }), ...(effort && { effort }), ...(perm && { perm }), ...(c.fast && { fast: true }), ...(p.git === false && { local: true, another: true, name: nameOf(prompt) }) }).catch(() => null)
      if (made) (showNew(made.id), setDialog(null))
      return !!made
    }
  }
  toolAsk.current = m => askTool(m, view, settings)
  // a repo's extension (or one in a folder an agent linked) turned on: what it runs, the settings it needs, what it can
  // hold; the files hash shown, or none
  // a repo's .laki.json not trusted as it is (cfgWait): its text, then Trust; meanwhile its setup, scripts and env wait
  const cfgSheet = async (p: Project) => {
    const c = await call<{ hash: string; text: string; trusted: boolean }>('projectTrust', { id: p.id }).catch(() => null)
    if (!c || c.trusted) return
    const text = `Its setup, teardown, run and other scripts run on this Mac, with its env. Until you trust it, none of them runs (its port names still show), and workspaces made meanwhile get their setup as you trust it.\n\n${c.text}`
    if ((await choose(`Trust ${p.name}'s .laki.json?`, text, [{ label: 'Not now' }, { label: "Trust this repo's .laki.json", primary: true }])) !== 1) return
    if (await call('projectTrust', { id: p.id, hash: c.hash }).then(() => true, () => false)) done(`Trusted ${p.name}'s .laki.json`)
  }
  const repoSheet = async (w: WidgetView) => {
    const what = await call<{ name: string; text: string; hash: string; cut?: string[] }>('widgetWhat', { id: w.id }).catch(e => (toast(String(e?.message ?? e), undefined, undefined, false, true), null))
    if (!what) return
    const proj = view?.projects.find(p => p.id === w.project)?.name ?? w.project
    const needs = w.options.filter(x => x.required || x.type === 'secret').map(x => `${x.label || x.key}${x.type === 'secret' ? ' (a secret, kept on this Mac)' : ''}${x.required ? ', needed' : ''}`)
    const from = w.project ? `It comes with ${proj}'s repo (.laki/extensions)` : "An agent linked its folder (laki widget dev): its code is the agent's"
    const bins = (w.needs ?? []).map(b => `${w.missingBins?.includes(b) ? '✗' : '✓'} ${b}`).join(', ') // R2: each on this Mac or not
    const text = [`${from}${w.changed ? ', and its files changed there since you turned it on' : ''}.`, what.text.replace(/^`{3,}$/gm, '').replace(/\n{3,}/g, '\n\n'), bins ? `It needs: ${bins}.` : '', needs.length ? `Its settings: ${needs.join('; ')}.` : '', w.project ? 'It shows and runs only in its workspaces.' : 'It turns off again as its files change.'].filter(Boolean).join('\n\n')
    // S10: a file the sheet cut is opened whole before Turn on shows (the daemon refuses it until then too)
    const opened = new Set<string>()
    for (;;) {
      const left = (what.cut ?? []).filter(f => !opened.has(f))
      const say = left.length ? `${text}\n\nThe sheet cut ${left.join(', ')}: open ${left.length === 1 ? 'it' : 'each'} in full before you turn it on.` : text
      const i = await choose(`Turn on ${what.name}?`, say, [{ label: 'Cancel' }, ...left.map(f => ({ label: `Open ${f} in full` })), ...(left.length ? [] : [{ label: w.project ? `Turn on in ${proj}` : 'Turn on', primary: true }])])
      if (!(i >= 1)) return // Cancel, Esc (-1)
      if (i > left.length) return what.hash
      const f = left[i - 1]
      const full = await call<{ text: string }>('widgetFull', { id: w.id, file: f }).catch(e => (toast(String(e?.message ?? e), undefined, undefined, false, true), null))
      if (!full) return
      opened.add(f)
      await choose(`${f}, in full`, full.text, [{ label: 'Back', primary: true }])
    }
  }
  return { cfgSheet, extInserts, extItems, extMenus, extOn, extRun, extWs, hereCtx, intoAgent, keyText, openPort, repoSheet, widgetApi } as const
}
