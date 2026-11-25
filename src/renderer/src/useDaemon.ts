// App's daemon connection: each event the daemon sends (api.on) to its state, notification, toast or answer, and the
// bridge's (a notification's tab, laki:// links, the menu bar's screenshot); connected once, with the first render's
// handlers (a: App's setters, refs and the handlers it reads, as before this moved out of App)
// the events that notify or toast about a workspace: none for one Recording mode hides
import type { AppInfo } from './Settings'
import type { Call } from '../../shared/api'
import { type Dialog, wsName } from './appCtx'
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from 'react'
import { api, bridge, type Msg, notify, type NotifyAction, onLakiLink, passkeyReady, passkeys } from './api'
import { NEEDS } from '../../shared/tray'
import { aiOn, type NotifyKind, type TabView, veiled, type View, type WorkspaceView } from '../../shared/types'
import type { PanelTab } from './SidePanel'
import type { Shot } from './panels'
import type { ShownPop, ShownWin } from './Shown'
import type { WidgetApi } from './Widgets'
import { askScope, diffCounts, optLabel, permVerb } from '../../shared/ask'
import { choose, rowsMorph, unchoose } from './ui'
import { hasCap } from '../../shared/caps'
import { noteCut, noteWhole } from './text'
import { settle } from './motion'
import { viewShare } from './viewShare'
import { personalOutput, spokenNote } from '../../shared/speak'
import { outputLabel, sayInit } from './say'
import { toolLine, toolOn } from './AppParts'
const QUIET = new Set(['turn', 'long', 'check', 'reminder', 'started', 'archived', 'tunnel', 'peek', 'flow'])

type St<T> = Dispatch<SetStateAction<T>>
export type DaemonCtx = {
  setLocked: St<{ pin: boolean } | null>
  hid: RefObject<Set<string>>
  viewRef: RefObject<View | null>
  setView: St<View | null>
  setDialog: St<Dialog>
  toast: (text: string, undo?: () => void, label?: string, ok?: boolean, err?: boolean, ms?: number) => void
  widgetSay: RefObject<WidgetApi['say'] | undefined>
  toolAsk: RefObject<((m: Msg) => void) | undefined>
  earlyAsks: RefObject<Msg[]>
  setProblem: St<string | undefined>
  setPinAsk: St<{ left?: number } | null>
  setKeyOffer: St<boolean>
  setConnected: St<boolean>
  setApps: St<AppInfo[]>
  waits: RefObject<Map<string, string>>
  shownTabs: RefObject<string[]>
  selectTab: (ref: string | { id: string; workspace: string }) => void
  offerCheck: (wsId?: string) => void
  setShown: St<ShownWin[]>
  setPops: St<ShownPop[]>
  fail: (e: unknown) => void
  uiRef: RefObject<((m: { do?: string; tab?: string; link?: string; on?: boolean; panel?: string }) => void) | undefined>
  archived: RefObject<string[]>
  archivedTimer: RefObject<ReturnType<typeof setTimeout> | undefined>
  call: Call
  timerAct: RefObject<(m: { act: string; ms: number; note?: string; ws?: string; tab?: string; text?: string; which?: string; important?: boolean }) => unknown>
  setGlow: St<{ tab?: string; n: number } | null>
  openNeeds: () => void
  showPanel: (t: PanelTab) => void
  setReveal: St<string[]>
  scrolledTo: RefObject<string | null>
  setScrollAsk: St<number>
  setLink: St<string | undefined>
  setNewImages: St<Shot[]>
  setWsId: St<string | null>
}

export function useDaemon(a: DaemonCtx) {
  useEffect(() => {
    const { setLocked, hid, viewRef, setView, setDialog, toast, widgetSay, toolAsk, earlyAsks, setProblem, setPinAsk, setKeyOffer, setConnected, setApps, waits, shownTabs, selectTab, offerCheck, setShown, setPops, fail, uiRef, archived, archivedTimer, call, timerAct, setGlow, openNeeds, setReveal, scrolledTo, setScrollAsk, setLink, setNewImages, setWsId, showPanel } = a
    const off = api.on(m => {
      if (m.ev === 'state') {
        setLocked(null) // D6: unlocked (its state comes only then)
        const shown = veiled(m.view) // Recording mode: private workspaces out of everything drawn
        hid.current = shown === m.view ? new Set() : new Set(m.view.workspaces.filter((w: WorkspaceView) => !shown.workspaces.includes(w)).map((w: WorkspaceView) => w.id))
        const v = m.patched ? shown : viewShare(viewRef.current, shown) // the last view's objects where nothing changed: memo'd rows, tabs and panes draw again only where something did (P2: a patch kept them already, no compare)
        settle([...m.view.workspaces.map((w: WorkspaceView) => w.id), ...m.view.tabs.map((t: TabView) => t.id)]) // V7: what's here as the window opens doesn't grow in
        // V13: a row pinned or unpinned slides to its new group. ponytail: Pinned only; Needs you's are cards of their own
        const was = viewRef.current
        rowsMorph(was ? v.workspaces.filter((w: WorkspaceView) => (o => !!o && !!o.pinned !== !!w.pinned)(was.workspaces.find(x => x.id === w.id))).map((w: WorkspaceView) => w.id) : [], () => setView(v))
      } else if (QUIET.has(m.ev) && hid.current.has(m.ws)) return // and their notifications and toasts
      else if (m.ev === 'widget-say' && typeof m.notify === 'string') {
        // an extension's notify: its new words, a notification (its click: its full view, else its page) and a toast
        const w = viewRef.current?.widgets?.find(x => x.id === m.widget)
        const open = () => setDialog(w?.full ? { widget: m.widget } : { extension: m.widget })
        if (viewRef.current?.settings.notify !== false && !document.hasFocus()) notify(w?.name ?? m.widget, m.notify, '', open, viewRef.current?.settings.notifySound) // looking at Laki: the toast is enough
        toast(`${w?.name ?? m.widget}: ${m.notify}`, open, 'Open')
      } else if (m.ev === 'widget-say') widgetSay.current?.(m.widget, { toast: m.toast, modal: m.modal, close: m.close }, m.ws)
      else if (m.ev === 'toolAsk' || m.ev === 'termAsk' || m.ev === 'clientAsk') toolAsk.current ? toolAsk.current(m) : earlyAsks.current.push(m)
      else if (m.ev === 'clientQuiet') toast(String(m.text))
      else if (m.ev === 'remoteIdle') toast(String(m.text), () => void api.call('remoteKeep').catch(() => {}), 'Keep') // T10 // T9, T11: a client's token ending soon, a limit it hit
      else if (m.ev === 'toolDone' || m.ev === 'termDone' || m.ev === 'clientDone') (earlyAsks.current = earlyAsks.current.filter(x => x.req !== m.req)), toolLine.drop(m.req) && toolOn === m.req && unchoose(m.req) // answered elsewhere: out of line
      else if (m.ev === 'problem') setProblem(m.text)
      else if (m.ev === 'pin') (setPinAsk({ left: m.left }), setProblem(undefined)) // asked: a miss before it (the link's key alone) says nothing
      else if (m.ev === 'locked') setLocked({ pin: !!m.pin })
      else if (m.ev === 'passkey' && m.offer && passkeys()) (setKeyOffer(true), passkeyReady('passkeyOptions')) // its challenge before Set up's tap
      else if (m.ev === 'remote') {
        // remote access stopped by a wrong PIN on its page: said here, and as a notification
        toast(m.text, () => setDialog({ section: 'remote' }), 'Settings')
        notify('Remote access', m.text, '', () => setDialog({ section: 'remote' }), viewRef.current?.settings.notifySound)
      } else if (m.ev === 'open') {
        setConnected(true)
        setProblem(undefined)
        setPinAsk(null)
        api.call<AppInfo[]>('apps').then(setApps, () => {})
        if (bridge?.kcWrapOk) void api.call<{ keychain?: boolean }>('kcWrapper', {}).then(r => (r?.keychain ? bridge!.kcWrapOk!() : false)).then(on => void (on && api.call('kcWrapper', { on: true }))).catch(() => {}) // keychain.ts: this window wraps the Keychain's values, once the daemon says it keeps them there (main's safeStorage only then)
      }
      // a Keychain value to wrap or unwrap (keychain.ts): main's safeStorage does it, the answer goes back; never kept here
      else if (m.ev === 'kcWrap') void (bridge?.kcWrap?.(m.op, String(m.value)) ?? Promise.resolve(null)).then(v => api.call('kcWrapped', v === null ? { req: m.req, error: "the app couldn't" } : { req: m.req, value: v }), () => api.call('kcWrapped', { req: m.req, error: "the app couldn't" })).catch(() => {})
      else if (m.ev === 'close') setConnected(false)
      else if (m.ev === 'turn') {
        if (m.kind === 'waiting') waits.current.set(m.tab, m.text ?? '')
        // a wait a moment later, with its menu (often drawn after the hook), unless it's over by then
        const post = () => {
          const t = viewRef.current?.tabs.find(t => t.id === m.tab)
          const shown = document.hasFocus() && shownTabs.current.includes(m.tab)
          const s = viewRef.current?.settings
          const w = viewRef.current?.workspaces.find(w => w.id === t?.workspace)
          // T16: a bell rang (the daemon's ring): told as an important workspace's, notifyOn and mutes aside
          if (!t || shown || (!m.bell && (s?.notify === false || s?.notifyOn?.[m.kind as NotifyKind] === false || t.muted || w?.muted)) || (m.kind === 'waiting' && t.status !== 'waiting')) return
          const perm = m.kind === 'waiting' && t.ask?.tool ? t.ask : undefined // claude's permission ask: what it wants to do
          const body = perm ? `${perm.what ?? ''}${perm.diff ? (c => ` (+${c.add} −${c.del})`)(diffCounts(perm.diff)) : ''}` : m.kind === 'waiting' ? `needs you${m.text ? `: ${m.text}` : ''}` : m.kind === 'limit' ? 'hit a usage limit' : m.text || 'finished'
          // a button per choice of its menu (its "don't ask again" one as Always: <rule>); a permission prompt whose menu
          // wasn't read: Allow and Deny, its first and last
          // one that doesn't fit is cut with … and gets none, as one with a bidi or invisible character (noteWhole), or a
          // permission ask whose command says nothing: a Yes would approve a command you can't see whole (its click shows
          // it in the tab)
          // a standing permission's choice (askScope): the button stays "Allow always" (a notification's has little room),
          // the body names its rule in full, so the whole body must fit for any button to show
          const scopes = new Map(t.ask?.options.map(o => [o, askScope(optLabel(t.ask!, o), t.preset)] as const).filter(x => x[1]))
          const always = [...scopes.values()][0]
          const told = always ? `${body}\nAllow always: ${always.rule}${always.plain ? ` (${always.plain})` : ''}` : body
          const cut = !noteWhole(told) || (!!perm && !perm.what?.trim())
          const actions: NotifyAction[] | undefined =
            m.kind !== 'waiting' || cut ? undefined : t.ask ? t.ask.options.map(o => ({ text: scopes.has(o) ? 'Allow always' : `${o.n}. ${o.label}`, n: o.n, label: o.label, ...(scopes.has(o) && { scope: optLabel(t.ask!, o) }) })) : /permission/i.test(m.text ?? '') ? [{ text: 'Allow', pick: 'first' }, { text: 'Deny', pick: 'last' }] : [{ text: 'Reply', reply: true }] // U15: a free-text question: a Reply field
          const card = !w?.important && !m.bell ? undefined : m.kind === 'waiting' ? { ask: true, ...(perm?.diff && { diff: perm.diff }), ...(perm?.tool === 'Bash' && aiOn(s) && hasCap(viewRef.current, 'ask.explain') && { explain: true }) } : { tone: m.kind === 'limit' || m.kind === 'signedout' ? ('bad' as const) : ('ok' as const) } // an important workspace's: a card on screen (main's addCard)
          const speak = m.kind === 'waiting' || m.kind === 'done' ? spoken(viewRef.current, m.kind === 'waiting' ? 'ask' : 'done', w, (m.kind === 'waiting' && perm?.what) || m.text || '', shown) : undefined
          notify(`${w ? wsName(w) : t.workspace} · ${t.name}${perm ? ` ${permVerb(perm.tool!)}` : ''}`, noteCut(told), t.id, () => selectTab(t.id), s?.notifySound, actions, card, speak)
        }
        if (m.kind === 'waiting') setTimeout(post, 800)
        else if (!m.checking) (post(), m.kind === 'done' && offerCheck(m.ws)) // a check follows: its result notifies (the check event)
      } else if (m.ev === 'proof') {
        window.dispatchEvent(new CustomEvent('laki-proof', { detail: m })) // a checked turn: its Preview's screenshot (SidePanel's)
      } else if (m.ev === 'check') {
        // Done means checked: the turn's notification, now that its check is over (skipped: nothing changed; failed: sent
        // back to the agent, which works again, so none)
        const t = viewRef.current?.tabs.find(t => t.id === m.tab)
        const s = viewRef.current?.settings
        const w = viewRef.current?.workspaces.find(w => w.id === m.ws)
        if (!t || m.status === 'failed' || (!m.bell && (s?.notify === false || t.muted || w?.muted))) return
        if (m.status !== 'over' && ((!m.bell && s?.notifyOn?.done === false) || (document.hasFocus() && shownTabs.current.includes(m.tab)))) return
        const body = m.status === 'skipped' ? t.last || 'finished' : m.status === 'passed' ? `done and checked: ${m.text}` : `over to you: ${m.text}`
        notify(`${w ? wsName(w) : t.workspace} · ${t.name}`, noteCut(String(body)), t.id, () => selectTab(t.id), s?.notifySound, undefined, w?.important || m.bell ? { tone: m.status === 'over' ? 'bad' : 'ok' } : undefined, spoken(viewRef.current, 'done', w, m.status === 'skipped' ? t.last || '' : String(m.text ?? ''), document.hasFocus() && shownTabs.current.includes(m.tab)))
      } else if (m.ev === 'scheduled') {
        // T1: a scheduled run waits for you, failed, or (Tell me: always) is done: a notification and a toast to it
        const s = viewRef.current?.settings
        const go = () => (m.tab && viewRef.current?.tabs.some(t => t.id === m.tab) ? (setDialog(null), selectTab(m.tab)) : m.ws && viewRef.current?.workspaces.some(w => w.id === m.ws && !w.archived) ? (setDialog(null), setWsId(m.ws)) : setDialog('schedules'))
        if (s?.notify !== false) notify('Scheduled task', noteCut(String(m.text)), m.tab ?? '', go, s?.notifySound)
        toast(String(m.text).slice(0, 160), go, 'Open')
      } else if (m.ev === 'flow') {
        // a workflow run asks you, shows you something (a window, maybe a notification), or ended (a notify end, a failure)
        const s = viewRef.current?.settings
        if (m.kind === 'refused') {
          // a repo's workflow an event or its schedule didn't start (once per file version): Look… opens it, where its
          // sheet shows the file before Allow; never an Allow here
          if (s?.notify === false) return
          const look = () => setDialog({ workflows: '', wf: m.wf })
          const words = `${m.name} didn't start on ${m.on === 'schedule' ? 'its schedule' : m.on}: ${m.changed ? 'it changed in the repo since you allowed it' : "it comes with the repo and isn't allowed yet"}`
          notify(`Workflow · ${m.name}`, noteCut(words), '', look, s?.notifySound)
          toast(words.slice(0, 160), look, 'Look…')
          return
        }
        if (m.kind === 'paused') {
          // 5 failed runs in a row that started by themselves: events and its schedules don't start it now
          const on = () => void api.call('flowPause', { ...m.wf, on: true }).then(() => toast(`${m.name} is on again`), fail)
          if (s?.notify !== false) notify(`Workflow · ${m.name}`, `paused: ${m.text}`, '', () => setDialog({ workflows: '', wf: m.wf }), s?.notifySound)
          toast(`${m.name} is paused: ${m.text}`.slice(0, 160), on, 'Turn on again')
          return
        }
        const open = () => setDialog({ workflows: '', run: m.id })
        // a window (a Show you's unless modal: no; an end's with modal: yes) and a popover, each as the block says
        const win = m.kind === 'show' ? { run: m.id, name: m.name, title: m.text, body: m.body ?? '' } : { run: m.id, name: m.name, title: `${m.name}: ${m.status}`, body: m.text ?? '' }
        if (m.kind === 'show' ? m.modal !== false : m.kind === 'end' && m.modal) setShown(q => [...q, win].slice(-10))
        if ((m.kind === 'show' || m.kind === 'end') && m.popover) setPops(q => [...q, { ...win, key: Date.now() + Math.random() }].slice(-3))
        if (m.kind === 'show') {
          if (m.notify && s?.notify !== false) notify(`Workflow · ${m.name}`, noteCut(String(m.text)), '', open, s?.notifySound)
          return
        }
        if (s?.notify === false || (m.kind === 'end' && !m.notify)) return
        const body = m.kind === 'waiting' ? `asks you: ${m.text}` : `${m.status}: ${m.text}`
        notify(`Workflow · ${m.name}`, noteCut(body), '', open, s?.notifySound)
        if (m.kind === 'waiting') toast(`${m.name} asks you: ${m.text}`.slice(0, 160), open, 'Open')
      } else if (m.ev === 'alert') {
        // laki alert: what an agent or a script asked to show you as a card on screen, with its choices (each answers
        // it: alertAnswer); notifications off or not, as you asked for it
        const picks: string[] = m.choices ?? []
        if (bridge) notify(String(m.title), String(m.text), m.tab ?? '', () => {}, viewRef.current?.settings.notifySound, picks.map(c => ({ text: c, alert: { id: m.id, choice: c } })), { alert: m.id, origin: m.origin })
        else void choose(String(m.title), `${m.origin ? `${m.origin}\n\n` : ''}${m.text}`, picks.length ? picks.map((c, i) => ({ label: c, primary: i === 0 })) : [{ label: 'OK', primary: true }], undefined, `alert:${m.id}`).then(i => void api.call('alertAnswer', { id: m.id, ...(picks[i] !== undefined && { choice: picks[i] }) }).catch(() => {})) // a browser (remote access): the app's own dialog
      } else if (m.ev === 'alertDone') bridge ? bridge.cardGone?.(`alert:${m.id}`) : unchoose(`alert:${m.id}`)
      else if (m.ev === 'reminder') {
        // the calendar's reminder, due (the daemon rings each once): a notification and a toast, Open its workspace. One
        // due while the app was closed comes right after the first state, before it's drawn: once there's a view
        const ring = (n = 0): unknown => {
          const v = viewRef.current
          if (!v) return n < 100 && setTimeout(() => ring(n + 1), 50)
          const w = m.ws ? v.workspaces.find(x => x.id === m.ws && !x.archived) : undefined
          const open = () => (w ? (setDialog(null), setWsId(w.id)) : setDialog('calendar'))
          if (v.settings.notify !== false || m.important) notify('Reminder', noteCut(String(m.text)), (w && v.tabs.find(x => x.workspace === w.id)?.id) ?? '', open, v.settings.notifySound, undefined, m.important ? { tone: 'info' } : undefined) // its click: there; an important one: a card on screen, notifications off or not
          toast(`Reminder: ${m.text}`.slice(0, 160), open, w ? 'Open' : 'Calendar')
        }
        ring()
      } else if (m.ev === 'tunnel') {
        // a quick tunnel cloudflared started again (it dropped, or the daemon restarted): its address is new
        const w = viewRef.current?.workspaces.find(x => x.id === m.ws)
        toast(`${w?.name ?? m.ws} :${m.port}'s tunnel is back at a new address: ${m.url}`, () => void navigator.clipboard.writeText(String(m.url)), 'Copy it')
      } else if (m.ev === 'started') {
        // a delayed start's agent (wsNew startAt), started by the daemon: where it is, and late when it was down then
        const open = () => (setDialog(null), selectTab(m.tab))
        const text = `${m.agent} started (scheduled${m.late ? `, late: it was due ${new Date(m.late).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''})`
        if (viewRef.current?.settings.notify !== false) notify(String(m.name), text, m.tab, open, viewRef.current?.settings.notifySound)
        toast(`${m.name}: ${text}`, open, 'Open')
      } else if (m.ev === 'long') {
        // a turn past settings.longTurn (once): Stop is its Esc
        const v = viewRef.current
        const t = v?.tabs.find(x => x.id === m.tab)
        if (t && !t.muted && !v?.workspaces.find(w => w.id === t.workspace)?.muted) {
          const open = () => (setDialog(null), selectTab(m.tab))
          if (v?.settings.notify !== false) notify('Laki', String(m.text), m.tab, open, v?.settings.notifySound, [{ text: 'Stop', stop: true }])
          toast(String(m.text), open, 'Open')
        }
      } else if (m.ev === 'focus') {
        selectTab(m.tab) // Laki AI's "show me": that tab, in its workspace
      } else if (m.ev === 'ui') {
        uiRef.current?.(m as unknown as { do?: string }) // Q13: Laki AI's laki_ui
      } else if (m.ev === 'archived') {
        // several at once (the setting just turned on): one message, whose Undo brings them all back
        const all = (archived.current = [...archived.current, m.ws])
        clearTimeout(archivedTimer.current)
        archivedTimer.current = setTimeout(() => (archived.current = []), 8000)
        const said = m.idle ? (all.length > 1 ? `Archived ${all.length} idle workspaces` : `Archived ${m.name}: untouched for ${m.idle} days`) : all.length > 1 ? `Archived ${all.length} workspaces: their PRs merged` : `Archived ${m.name}: PR #${m.pr} merged`
        toast(said, () => {
          archived.current = []
          for (const id of all) call('wsRestore', { id }).catch(() => {})
        })
      } else if (m.ev === 'timer') {
        // Laki AI's laki_timer: the sidebar's timers live here; the answer goes back as the agent browser's does
        new Promise(ok => ok(timerAct.current(m as Msg & { act: string; ms: number })))
          .then(
            result => api.call('browseDone', { id: m.req, ok: true, result }),
            e => api.call('browseDone', { id: m.req, ok: false, error: String((e as Error).message) }),
          )
          .catch(() => {})
      } else if (m.ev === 'peek') {
        // Laki AI looked at a tab (lit where it's shown, else the window) or used the agent browser (the window); Laki in
        // the background (away: animations paused): none, not a late one when you're back
        if (viewRef.current?.settings?.aiGlow !== false && !document.documentElement.classList.contains('away')) setGlow({ tab: shownTabs.current.includes(m.tab) ? m.tab : undefined, n: Date.now() })
      } else if (m.ev === 'uninstalled') {
        bridge?.uninstalled?.(!!m.cask) // B3: the app goes with it (main asks: to the Trash)
      } else if (m.ev === 'browse' && bridge?.browse) {
        // the agent browser (laki browser): main drives a hidden window; its answer goes back to the daemon
        const { req: id, ev: _, ...r } = m // req: an event with an id would be taken for a reply
        bridge.browse(r).then(
          result => api.call('browseDone', { id, ok: true, result }),
          e => api.call('browseDone', { id, ok: false, error: String((e as Error).message).replace(/^Error invoking remote method 'browse': (Error: )?/, '') }),
        ).catch(() => {})
      }
    })
    api.connect()
    // a notification's, a bubble's or the menu bar's: over any page, as ⌘J; its row unfolded into sight (below)
    bridge?.onFocusTab((id, panel) => id === NEEDS ? openNeeds() : (setDialog(null), selectTab(id), panel === 'changes' && showPanel('changes'), (w => w && setReveal(r => [...r, w]))(viewRef.current?.tabs.find(t => t.id === id)?.workspace), (scrolledTo.current = null), setScrollAsk(n => n + 1)))
    bridge?.onDeepLink?.(setLink)
    onLakiLink(setLink) // a laki:// link in the app (the AI's to a workspace): routed here, as the Dock's
    // the menu bar's screenshot: saved where pasted images go, then the new-workspace page with it (another one adds to it)
    bridge?.onShot?.((png, note) =>
      api.call<string>('imageSave', { data: png, ext: 'png' }).then(
        path => (setNewImages(i => [...i, { path, url: `data:image/png;base64,${png}`, ...(note && { note }) }]), setDialog('new')), // its note: the page adds it to the prompt
        e => toast(`The screenshot wasn't saved: ${(e as Error).message}`),
      ),
    )
    return off
  }, [a.selectTab])
}

// Settings › Voice › Speak asks, Speak when done: what an ask or a finish says out loud (shared/speak.ts spokenNote;
// main reads it out unless the talk key is down), the app window's own speaker (say.ts) listening for it
const spoken = (v: View | null | undefined, kind: 'ask' | 'done', w: WorkspaceView | undefined, text: string, inView: boolean) =>
  spokenNote({ kind, ws: w ? wsName(w) : '', text, on: kind === 'ask' ? v?.settings.voice?.speakAsks : v?.settings.voice?.speakDone, quiet: !!v?.dnd, recording: !!v?.settings.recording, private: !!w?.private || !!v?.projects.find(p => p.id === w?.project)?.private, inView, silent: v?.settings.voice?.speakOn === 'headphones' && !personalOutput(outputLabel()) })
if (bridge?.onSpeak) sayInit(bridge.onSpeak)
