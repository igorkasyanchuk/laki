import { unloadStep } from '../../shared/browserBudget'
import { type CSSProperties, type Dispatch, lazy, type ReactNode, type SetStateAction, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { aiOn, creatorOf, neverAsks, PERMS, veiled, type TurnKept, type Agent, flowsOn as flowsOnIn, specsOn as specsOnIn, jobOf, type Account, type StudioChat, type Gate, type GateHeld, type WidgetLogLine, type WidgetRuns, placesOf, type RunScript, type AccountView, type AchievementsKept, type CompactLogLine, AGENT_NAMES, API, HOME_ACCOUNT, isAccountAgent, RAIL_PINS, rowsOf, type WsSort, type Doctor, type LogLine, type ScriptRun, type MergeMethod, PR_QUIET, PR_SCAN, PR_TRIES, prAllows, type PR, type PRLabel, type Project, type ProjectLook, type Sep, type SideLook, type NotifyKind, type PlanKind, type PlanPin, type ProjectConfig, type Resources, type TabView, type View, type WidgetCtx, type WidgetMenu, type WidgetView, type WorkspaceView, type ActionFile, type Blame, type Stat } from '../../shared/types'
import { alwaysOf, diffCounts, optLabel, permVerb, ruleFrom } from '../../shared/ask'
import { parseAt, stamp } from '../../shared/when'
import { type NewLine, notesOf as newLines, type UpdateState } from '../../shared/update'
import { version as appVersion } from '../../../package.json'
import { Outbox } from './OutboxStrip'
import { api, bridge, daemonBase, reportView, type Msg, notify, setQuiet, type NotifyAction, onLakiLink, openExternal, openKeptLink, pageNow, passkeyReady, passkeys, passkeySetUp, passkeyUnlock } from './api'
import { DOCK_ICONS, dockPng } from './dock'
import { BrowserPane } from './Browser'
import type { ReviewApi, Talk } from './FullReview'
import { ago, type AutoKey, type Check, ciText, type FixWhat, InfoTab, type LabelApi, MERGE_WORDS, type PRAct, prState, PRStatus, REVIEW, short, showAvatars, type WsInfo } from './Info'
import { type NeedsApi } from './Needs'
import { SideChat } from './SideChat'
import { notInstalled, tabAgent } from '../../shared/install'
import { type Artifact, CopyDiagnostics, VIEWED, Loading, SnapSkeleton, Logs, Onboarding, type Meme, type NewWsParams, Ready, CheckStrip, HookStrip, InstallStrip, LaterStrip, PlanStrip, QueueStrip, SecretStrip, ShowStrip, WorkerAsks, type Shot, StarLaki, Video, videoCommand, Welcome, WhatsNew } from './panels'
import type { AccountsApi, AppInfo, SkillInfo, WidgetsApi } from './Settings'
import { designTraits, FONT_SIZE, isSection, PAGE_ZOOMS, RAIL_ITEMS, railSorted, type RowMark, rowMarkOn, termLook } from './settingsBase' // E8: not the Settings page, which loads as it opens
import { extMenuItems } from './extMenu'
import { Picker, PICKER_KEY } from './Picker'
import { ANSWER_KEYS, isKeyId, type KeyId, keyMap, keyShow, setSendKey } from '../../shared/keys'
import { type DeskAsk, onDesk } from './Desk'
import { completeOf, type Inserted, type Inserts, keepFile, VoiceBar } from './PromptInput'
import type { ProjectTab } from './Project' // a type alone: verbatimModuleSyntax keeps a { type } import's module in the bundle (E8)
import { ACHIEVEMENTS, earnedBy, pageEarns, upsOf, wentUp } from '../../shared/achievements'
import { hasCap } from '../../shared/caps'
import { click as extClick, Glyph as ExtGlyph, imagesVia, insertMenus, inWs, status as extStatus, type WidgetApi, WidgetBody, WidgetButtons, WidgetModal, WidgetPanel, WidgetStrip } from './Widgets'
import type { SayModal, WidgetSay } from '../../shared/widget'
import type { UiDo, UiProblem } from '../../shared/widgetUi'
import { globMatch } from '../../shared/widgetSchema'
import type { ExtTab } from './Extension'
import type { FlowStartAt, Sel as FlowSel } from './Workflows'
import { FLOW_ENDED, type WorkflowItem } from '../../shared/workflow'
import { Glyph, rollup } from './Glyph'
import { needsTab, nextStep, type Step, type StepId } from '../../shared/nextStep'
import { bounceOf, dockProgress, inboxOf, stateOf } from '../../shared/tray'
import { flushDraft, Reader, type ReaderApi, readable } from './Reader'
import { AskWrap, turnNext } from './Diff'
import { type TurnApi, TurnButton, TurnStrip } from './TurnStrip'
import { type Collision } from '../../shared/overlap'
import icon from './icon.svg'
import { Term, xterms, type SelectionUse } from './Term'
import { groupsOf, type Layout, move, resize, tabsOf, fillRoles, type Role, rolesIn, type RoleLayout, type RoleTab, type SavedLayout } from '../../shared/layout'
import { parseLink } from './links'
import { PanelHandle, Panes, SideHandle, useTabDrag } from './Panes'
import { actionMenu, type Changes, type Commits, type Edit, edited, type FileContent, type FileList, FilePreview, type FilesRoot, type PanelApi, type PanelTab, PANEL_WIDTH, type PRFiles, SidePanel, type Thread } from './SidePanel'
import { actionsFor, forgeName, mentionsOf, prName, prNo, rmVerdict, applySuggestions, noteCut, noteWhole, pendingWords, clock, csWord, initials, isStale, limitsCrossed, limitText, Line, nameOf, needsSorted, type RunAction, shortPath, spins, spinsUntil, STALE_AFTER, USAGE_AT, withPaths, youtubeEmbed } from './text'
import { applyTheme, blurred, css, DARK, LESS_CLEAR, MORE_CONTRAST, type Paint, paintKey, paintOf, setBgImage, THEMES, transparent, userCss } from './themes'
import { type Cloudflared, portsOf, TunnelButton, type TunnelApi } from './Tunnel'
import { type ShownPop, type ShownWin, useNotices } from './Shown'
import { type AgentUsage, ctxPct, ctxText, level, levelWord, USAGE_AGENTS, UsageButton, type UsageDay, usageText } from './Usage'
import { BgButton } from './BgTasks'
import { menuModel } from './menuModel'
import { SNAP_KEY, snapOf, snapshotOf } from './snapshot'
import { Num, morph, rowsMorph, ask, askText, copyImage, AskHost, choose, unchoose, colorVar, Countdown, type Fact, type Verdict, Icon, IconButton, keyTip, tipKeys, type IconName, ProjectMark, keep as store, load, type MenuItem, moveId, moveIds, ON, StaleDaemon, TAB_COLORS, Tips, useMenu, useRowDrag, HOTKEY, QUICK_KEY, TALK_KEY, SHOT_KEY, TELL_KEY } from './ui'
import { emojiOf, isIconName } from '../../shared/icons'
import { type Action, type AppBase, type AppCtx, appIcon, clip, colorOf, type Dialog, EDITOR_IDS, extKey, extOf, type Find, flowsOf, MINUTES, notesOf, type Opened, PAGE_WORDS, type Place, type RailKind, SCRIPT_ICONS, settingsOf, span, specsOf, STATE_WORDS, tabGlyph, type Timer, TIMER_THEN, type Watch, type Where, wsName } from './appCtx'
import { menusOf } from './menus'
import { settle } from './motion'
import { onKey } from './keydown'
import { layoutOf, TabBar, TabStrip } from './TabBar'
import { sideOf, Sidebar } from './Sidebar'
import { Dialogs, Pages, PRELOAD } from './Dialogs'

declare const __BUILT__: string | undefined // electron.vite.config.ts' define: the build's time, the daemon's too
// a daemon older than this app: a lower API, or the same API from an earlier build (it outlives app updates)
// Laki AI's glow (experimental): a moving border and a soft inner light over the pane of the tab it looked at, else the
// whole window; once (its own animation's end clears it)
function PeekGlow({ tab, onDone }: { tab?: string; onDone: () => void }) {
  const el = tab ? document.querySelector(`[data-pane="${CSS.escape(tab)}"]`) : null
  const r = el?.getBoundingClientRect() // ponytail: measured as it starts; a resize meanwhile leaves it where it was
  // seen: its middle or a corner is the pane's, not a page's or a panel's over it
  const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-pane]') === el
  const on = !!r?.width && !!r.height && [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].some(([fx, fy]) => at(r.left + r.width * fx, r.top + r.height * fy))
  return <div className={`ai-peek ${on ? '' : 'whole'}`} style={on ? { left: r!.left, top: r!.top, width: r!.width, height: r!.height } : undefined} onAnimationEnd={e => e.animationName === 'ai-peek' && onDone()} aria-hidden />
}
// the floating Laki AI chat, dragged by its head (not its buttons) anywhere over the main area, resized by its edges and
// corners; where it was left is laki.aiFloatAt (right and bottom, px), held inside the area as it changes size, and its
// size laki.aiFloatSize (CSS keeps it inside the area); a double-click on the head puts both back
type FloatAt = { right: number; bottom: number }
type FloatSize = { width: number; height: number }
const GRIPS = ['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br']
// E8: loaded as they first show (the Review tab, the floating AI chat): not in the window's first load
const FullReview = lazy(() => import('./FullReview').then(m => ({ default: m.FullReview })))
const AiPage = lazy(() => import('./Ai').then(m => ({ default: m.AiPage })))
const STEP_ICON: Record<StepId, IconName> = { continue: 'run', answer: 'bell', plan: 'clipboardCheck', check: 'alertCircle', conflict: 'conflict', ci: 'ciFail', review: 'pr', merge: 'gitMerge', archive: 'archive', look: 'changes', ship: 'ship', working: 'pr', wait: 'pr' } // One next step's button
const DOCK_MS = 320 // the AI button's way down into the status bar: styles.css' ai-dock
const OWN_ZOOMS = [0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] // a page's own ⌘± steps, a browser's
const FIXED_PAGE = '.page-body:has(> :is(.desk-tabs, .desk-grid, .desk-empty, .wf-page))' // pages ⌘± leaves be (styles.css)

// the AI button keeps to the terminals' corner (--fab-r: what's right of them), so the file preview's and the side
// panel's last rows show
function FabCorner({ className, children }: { className: string; children: ReactNode }) {
  const at = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fab = at.current
    const main = fab?.parentElement
    const wrap = main?.querySelector('.term-wrap')
    if (!fab || !main || !wrap) return
    const set = () => fab.style.setProperty('--fab-r', `${Math.max(0, main.getBoundingClientRect().right - wrap.getBoundingClientRect().right)}px`)
    const ro = new ResizeObserver(set)
    ro.observe(wrap)
    ro.observe(main)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={className} ref={at}>
      {children}
    </div>
  )
}

function AiFloat({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<FloatAt | null>(() => load<FloatAt | null>('laki.aiFloatAt', null))
  const [size, setSize] = useState<FloatSize | null>(() => load<FloatSize | null>('laki.aiFloatSize', null))
  const now = useRef({ at, size })
  now.current = { at, size }
  const [moving, setMoving] = useState('') // moving, or sizing-<grip>: the cursor everywhere meanwhile
  // 8px inside its area at least, so its head stays in reach
  const fit = (p: FloatAt): FloatAt => {
    const el = box.current
    const area = el?.offsetParent as HTMLElement | null
    if (!el || !area) return p
    const keep = (v: number, max: number) => Math.round(Math.max(8, Math.min(v, max - 8)))
    return { right: keep(p.right, area.clientWidth - el.offsetWidth), bottom: keep(p.bottom, area.clientHeight - el.offsetHeight) }
  }
  useLayoutEffect(() => {
    const area = box.current?.offsetParent
    if (!area) return
    const ro = new ResizeObserver(() => setAt(a => (a ? fit(a) : a)))
    ro.observe(area)
    return () => ro.disconnect()
  }, [])
  const head = (e: { target: EventTarget }) => {
    const t = e.target as Element
    return !!t.closest('.ai-win-head') && !t.closest('button, a, input, select, textarea')
  }
  // a drag: its moves and release come here even over a frame or outside the window; then where it is, and its size, kept
  const track = (e: React.PointerEvent, how: string, move: (m: PointerEvent, area: DOMRect, r: DOMRect) => void) => {
    const el = box.current
    if (e.button !== 0 || !el?.offsetParent) return
    e.preventDefault() // no text selected on the way
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    const area = (el.offsetParent as HTMLElement).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const go = (m: PointerEvent) => (setMoving(how), move(m, area, r))
    const up = () => {
      window.removeEventListener('pointermove', go)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setMoving('')
      if (now.current.at) store('laki.aiFloatAt', now.current.at)
      if (now.current.size) store('laki.aiFloatSize', now.current.size)
    }
    window.addEventListener('pointermove', go)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const onHead = useRef(false) // the press was on the head: a double-click's target is the box itself (the pointer was captured)
  const down = (e: React.PointerEvent) =>
    (onHead.current = head(e)) &&
    track(e, 'moving', (m, area, r) => setAt(fit({ right: area.right - r.right - (m.clientX - e.clientX), bottom: area.bottom - r.bottom - (m.clientY - e.clientY) })))
  // an edge or a corner: its far side stays where it is
  const grab = (e: React.PointerEvent, g: string) =>
    (onHead.current = false) ||
    track(e, `sizing-${g}`, (m, area, r) => {
      const dx = m.clientX - e.clientX
      const dy = m.clientY - e.clientY
      const keep = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(v, hi)))
      const w = g.includes('l') ? keep(r.width - dx, 320, r.right - area.left - 8) : g.includes('r') ? keep(r.width + dx, 320, area.right - r.left - 8) : r.width
      const h = g.includes('t') ? keep(r.height - dy, 280, r.bottom - area.top - 8) : g.includes('b') ? keep(r.height + dy, 280, area.bottom - r.top - 8) : r.height
      setSize({ width: Math.round(w), height: Math.round(h) })
      if (g.includes('r') || g.includes('b')) setAt({ right: Math.round(area.right - r.right - (g.includes('r') ? w - r.width : 0)), bottom: Math.round(area.bottom - r.bottom - (g.includes('b') ? h - r.height : 0)) })
    })
  const reset = () => onHead.current && (setAt(null), setSize(null), store('laki.aiFloatAt', undefined), store('laki.aiFloatSize', undefined))
  return (
    <div ref={box} className={`ai-float ${moving}`} style={{ ...at, ...size }} onPointerDown={down} onDoubleClick={reset}>
      {children}
      {GRIPS.map(g => (
        <div key={g} className={`ai-grip ${g}`} onPointerDown={e => grab(e, g)} aria-hidden />
      ))}
    </div>
  )
}
const WHEN_DONE_WORDS: Record<string, string> = { sleep: 'goes to sleep', lock: 'locks', shutdown: 'shuts down' }
const staleDaemon = (v: { api?: number; built?: string }) => (v.api ?? 0) < API || (typeof __BUILT__ === 'string' && !!v.built && v.built < __BUILT__)


// Run ▾'s project scripts besides run (RUN_SCRIPTS)
const SCRIPT_LABELS: Record<RunScript, string> = { test: 'Test', lint: 'Lint', format: 'Format', deploy: 'Deploy…' }
// an extension tool's asks: one dialog at a time, the others in line (tagged by req); toolOn: the one on screen
type ToolAsk = { req: string; title: string; text: string; picks: { label: string; allow: 'once' | 'always' | 'deny' }[]; answer: (allow: string) => void }
const toolLine = new Line<ToolAsk>()
let toolOn: string | undefined
const AWAY = -2 // #18: a page or dialog opened over the ask on screen: it waits, first in line, and comes back as that closes
function toolShow() {
  const t = toolLine.first
  if (!t || toolOn === t.req) return
  if (toolOn) return unchoose(toolOn) // another came first (a notification's click): this one back in line, its then shows it
  toolOn = t.req
  void choose(t.title, t.text, t.picks.map((p, i) => ({ label: p.label, primary: i === 0, danger: p.allow === 'deny' })), undefined, t.req).then(i => {
    toolOn = undefined
    if (i === AWAY) return // App's effect on its dialog shows it again
    // Esc, Deny or outside denies the one on screen only; one answered elsewhere (toolDone) or moved back: just the next
    if (toolLine.first === t) toolLine.drop(t.req), t.answer(t.picks[i]?.allow ?? 'deny')
    toolShow()
  })
}
// the events that notify or toast about a workspace: none for one Recording mode hides
const QUIET = new Set(['turn', 'long', 'check', 'reminder', 'started', 'archived', 'tunnel', 'peek', 'flow'])

// the Scheduled tasks page: closed (undefined), all projects (''), or a project's (its ⋯ menu)
const schedulesOf = (d: Dialog) => (d === 'schedules' ? '' : d && typeof d === 'object' && 'schedules' in d ? d.schedules : undefined)
// back and forward (settings.history, on unless false): a place is a page (or none: the workspace view) and the workspace
// selected; a dialog over them (⌘K, a rename, a timer) isn't one. HISTORY_MAX back, as a browser's
const HISTORY_MAX = 25
const ACH_QUIET = 10 * 60_000 // U2: an Unlocked toast at most this often
const PAGES = new Set(['settings', 'help', 'board', 'achievements', 'bird', 'ai', 'calendar', 'desk', 'todos', 'schedules', 'usage'])
const PAGE_KEYS = ['schedules', 'compare', 'extension', 'uikit', 'settings', 'section', 'project', 'specs', 'workflows', 'note']
const isPlace = (d: Dialog) => d === null || (typeof d === 'string' ? PAGES.has(d) : PAGE_KEYS.some(k => k in d))

const PICTURE = /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i // what Copy puts on the clipboard as a picture (main's PICS)
const PLAIN = /\.(md|markdown|txt|log|json|jsonl|ya?ml|toml|csv|tsv|xml|html?|css|svg|[cm]?[jt]sx?|py|rb|go|rs|sh|sql|diff|patch)$/i // Copy text: files that are text

// a row's +/-: 1234 as 1.2k, 12345 as 12k


const SIDE = 240 // the sidebar's default width
// the rail layout (Settings › Appearance › Layout): a kind each, its words, its icon
const RAIL: [RailKind, string, IconName][] = [['projects', 'Projects', 'fork'], ['shells', 'Terminal', 'terminal'], ['browsers', 'Browser', 'globe']]
// the rail with words: past RAIL_FIT buttons above the pins (⋯ More one of them), these go into More, the least used first
const RAIL_FIT = 7
const RAIL_MORE = ['todos', 'calendar', 'workflows', 'specs', 'board']
let requests = 0
const fileKey = (f: { path: string; storage?: boolean; ext?: string }) => `${f.ext ? `ext:${f.ext}:` : ''}${f.storage ? 'artifact:' : ''}${f.path}`
// remote access's page, with Laki's PIN: the code shown in Settings › Remote access on the Mac (api.pin); a wrong one
// counts down, the last stops remote access. One solid card (styles.css' .pin-*): Laki's mark, a lock in a ring that
// fills a sixth per digit, the PIN in six boxes over one input (paste, one-time-code autofill), sent as the sixth digit
// is typed; a wrong one shakes them, a right one turns the ring green with a check while the socket opens. Unlock is
// always a button: short of six digits it says so
const PIN_LEN = 6 // remote.ts' PIN
// D6: a passkey device's page, locked (each page load, and after its idle minutes): Face ID or Touch ID, or the PIN
// instead (pin: Settings allows it)
function UnlockForm({ pin }: { pin: boolean }) {
  const [usePin, setUsePin] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => passkeyReady('passkeyChallenge'), []) // its challenge before the tap (api.ts: Safari's)
  if (usePin) return <PinForm unlock onPin={code => api.call('passkeyPin', { pin: code })} />
  const go = () => {
    if (busy) return
    setBusy(true)
    setErr('')
    passkeyUnlock().then(
      () => setBusy(false),
      e => (setBusy(false), passkeyReady('passkeyChallenge'), setErr(/NotAllowed|cancel/i.test(String(e?.name ?? e?.message)) ? 'Not unlocked: try again' : String(e?.message ?? e))),
    )
  }
  return (
    <div className="pin-card">
      <div className="pin-brand">
        <img src={icon} alt="" />
        <b>Laki</b>
        <span className="pin-tag">
          <Icon name="globe" size={11} /> Remote access
        </span>
      </div>
      <div className="pin-ring" aria-hidden>
        <span>
          <Icon name="fingerprint" size={22} />
        </span>
      </div>
      <h1>Unlock Laki</h1>
      <p className="pin-say">This device unlocks with its passkey: Face ID, Touch ID or its code.</p>
      <button type="button" className="pin-go" autoFocus onClick={go} disabled={busy}>
        {busy ? (
          <>
            <span className="btn-spin" /> Waiting for you…
          </>
        ) : (
          <>
            Unlock <Icon name="arrowRight" size={15} />
          </>
        )}
      </button>
      <div className="pin-foot">
        {err ? <span className="pin-err" role="alert">{err}</span> : <span>Your Mac, through a private link</span>}
        {pin && (
          <button type="button" className="link small" onClick={() => setUsePin(true)}>
            Use PIN instead
          </button>
        )}
      </div>
    </div>
  )
}
// what a notification shows whole, so its buttons may answer it: one short line of plain ASCII words, single spaces
// between (macOS shows about two lines: a newline, a run of spaces or wide glyphs would push a tail out of sight; 40 of
// its widest letter still fit)
const shownWhole = (t: string) => t.length <= 40 && /^[!-~]+(?: [!-~]+)*$/.test(t)
function PinForm({ left, onPin, unlock }: { left?: number; onPin?: (code: string) => Promise<unknown>; unlock?: boolean }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false) // the PIN was right: the socket opens next
  const [over, setOver] = useState(false) // stopped: nothing more to try here
  const [shake, setShake] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const send = (c = code) => {
    if (busy || over || ok) return
    if (c.length < PIN_LEN) return void (setErr(`Type all ${PIN_LEN} digits`), setShake(true), box.current?.focus())
    setBusy(true)
    setErr('')
    const go = onPin ?? ((x: string) => api.pin(x))
    go(c).then(
      () => (setOk(true), setBusy(false)), // the socket opens next (or the splash says why not)
      e => (setErr((e as Error).message), setCode(''), setShake(true), /stopped/.test((e as Error).message) && setOver(true), setBusy(false), box.current?.focus()),
    )
  }
  const type = (v: string) => {
    const c = v.normalize('NFKC').replace(/\D/g, '').slice(0, PIN_LEN)
    setCode(c)
    if (err && c) setErr('')
    if (c.length === PIN_LEN) send(c) // all of it: in at once
  }
  const filled = ok ? PIN_LEN : code.length
  return (
    <form className={`pin-card ${ok ? 'ok' : ''} ${over ? 'over' : ''}`} onSubmit={e => (e.preventDefault(), send())}>
      <div className="pin-brand">
        <img src={icon} alt="" />
        <b>Laki</b>
        <span className="pin-tag">
          <Icon name="globe" size={11} /> Remote access
        </span>
      </div>
      <div className="pin-ring" aria-hidden>
        <svg viewBox="0 0 64 64">
          <circle className="pin-track" cx="32" cy="32" r="29" />
          <circle className="pin-fill" cx="32" cy="32" r="29" pathLength={100} style={{ strokeDashoffset: 100 - (filled / PIN_LEN) * 100 }} />
        </svg>
        <span key={ok ? 'ok' : over ? 'over' : 'lock'}>
          <Icon name={ok ? 'check' : over ? 'shieldAlert' : 'lock'} size={22} />
        </span>
      </div>
      <h1>{ok ? 'Unlocked' : over ? 'Remote access stopped' : 'Enter your PIN'}</h1>
      <label htmlFor="pin" className="pin-say">
        {ok ? 'Opening Laki…' : over ? 'Start it again on your Mac for a new link.' : 'The six digits Laki shows on your Mac, in Settings › Remote access.'}
      </label>
      <div className={`pin-boxes ${shake ? 'shake' : ''} ${err && !ok ? 'bad' : ''}`} onAnimationEnd={e => e.target === e.currentTarget && setShake(false)}>
        <input ref={box} id="pin" value={code} autoFocus disabled={over || ok} readOnly={busy} inputMode="numeric" autoComplete="one-time-code" aria-invalid={!!err} /* readOnly, not disabled: it keeps the keyboard for the next try */ onChange={e => type(e.target.value)} />
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <span key={i} className={`pin-box ${i < code.length ? 'full' : ''} ${i === code.length ? 'at' : ''}`} aria-hidden>
            {code[i] ?? ''}
          </span>
        ))}
      </div>
      <button type="submit" className={`pin-go ${code.length < PIN_LEN && !busy && !ok ? 'short' : ''}`} disabled={over}>
        {ok || busy ? (
          <>
            <span className="btn-spin" /> {ok ? 'Opening Laki' : 'Checking…'}
          </>
        ) : (
          <>
            Unlock <Icon name="arrowRight" size={15} />
          </>
        )}
      </button>
      <div className="pin-foot">
        {err ? (
          <span className="pin-err" role="alert">
            {err}
          </span>
        ) : (
          <span>{ok ? 'Your Mac, through a private link' : left === undefined || unlock ? 'Paste works too' : left === 1 ? 'One wrong PIN stops remote access' : `${left} wrong PINs stop remote access`}</span>
        )}
      </div>
    </form>
  )
}

// the last theme (and glass, font), until the daemon's settings arrive
applyTheme(load<string | Paint>('laki.theme', ''))

// a media query's answer, kept current (useSyncExternalStore): a phone's narrow layout, a touch screen's keys
const media = (q: string) => {
  const m = matchMedia(q)
  return { on: (f: () => void) => (m.addEventListener('change', f), () => m.removeEventListener('change', f)), now: () => m.matches }
}
const NARROW = media('(max-width: 640px)') // under the app window's minWidth (700): phones and narrow browsers only
const TOUCH = media('(pointer: coarse)')
const LESS = media(LESS_CLEAR) // macOS's Reduce transparency and Increase contrast: applyTheme reads them, App repaints
const MORE = media(MORE_CONTRAST)
const SYS_DARK = media(DARK)

// keys a phone's keyboard lacks, typed into the focused pane (claude and codex ask with arrows, Esc, ⇧⇥)
const KEYS: [string, string][] = [['esc', '\x1b'], ['tab', '\t'], ['⇧tab', '\x1b[Z'], ['^C', '\x03'], ['←', '\x1b[D'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['→', '\x1b[C'], ['⏎', '\r']]
// a press that doesn't take the focus: the terminal keeps it, and the phone its keyboard
const keep = (e: { preventDefault(): void }) => e.preventDefault()
function KeyBar({ onKey }: { onKey: (data: string) => void }) {
  const typing = () => {
    const ta = document.querySelector<HTMLTextAreaElement>('.pane.active .xterm-helper-textarea')
    if (ta && document.activeElement === ta) ta.blur()
    else ta?.focus()
  }
  return (
    <div className="keybar">
      <button onPointerDown={keep} onMouseDown={keep} onClick={typing} aria-label="Keyboard">
        ⌨
      </button>
      {KEYS.map(([k, data]) => (
        <button key={k} onPointerDown={keep} onMouseDown={keep} onClick={() => onKey(data)}>
          {k}
        </button>
      ))}
    </div>
  )
}

export function App() {
  const [view, setView] = useState<View | null>(null)
  const [connected, setConnected] = useState(false)
  const [glow, setGlow] = useState<{ tab?: string; n: number } | null>(null) // Laki AI just looked (Settings › Experimental › Laki AI's glow)
  const [problem, setProblem] = useState<string | undefined>() // the remote page: why it can't connect
  const [pinAsk, setPinAsk] = useState<{ left?: number } | null>(null) // the remote page: Laki's PIN, asked for on the splash
  const [locked, setLocked] = useState<{ pin: boolean } | null>(null) // D6: a passkey device's page, until it unlocks
  const [keyOffer, setKeyOffer] = useState(false) // D6: just paired: set a passkey up?
  const [going, setGoing] = useState<Record<string, string>>({}) // workspaces being archived or deleted: a spinner on their rows
  const [picked, setPicked] = useState<string[]>([]) // the sidebar's ⌘-click and ⇧-click: workspaces to archive, mute, move or delete at once
  const anchor = useRef<string | null>(null) // ⇧-click's other end
  const [making, setMaking] = useState<{ key: number; project: string; place?: string; name: string }[]>([]) // new ones on their way: a row each
  const made = useRef({ key: 0, page: 0 }) // making's keys; page: the new-workspace page's closes (one closed mid-create isn't the one open now)
  const [wsId, setWsId] = useState<string | null>(() => load('laki.ws', null))
  const [tabByWs, setTabByWs] = useState<Record<string, string>>(() => load('laki.tabs', {})) // the focused pane's session
  const [aiFloat, setAiFloat] = useState(false) // the floating Laki AI chat, open
  // its button minimized into the status bar (laki.aiDock) until put back; fly: on its way down or back up (DOCK_MS)
  const [aiDock, setAiDock] = useState(() => load('laki.aiDock', false))
  const [fly, setFly] = useState<'' | 'down' | 'up' | 'landed'>('')
  const docked = (on: boolean) => {
    const to = on ? 'landed' : 'up' // the status bar's item pops in, or the button rises back
    setAiDock(on)
    store('laki.aiDock', on || undefined)
    setFly(to)
    setTimeout(() => setFly(f => (f === to ? '' : f)), DOCK_MS)
  }
  // no status bar (settings.statusBar false): minimized to a small AI pill in the button's corner instead, no flight
  const dock = (on: boolean) => (on && viewRef.current?.settings.statusBar !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches ? (setFly('down'), setTimeout(() => docked(true), DOCK_MS - 20)) : docked(on))
  // another app in front: the window's animations (spinners, lines, a look's effects) stop where they are, so a window
  // in sight but not in use draws only what changes (styles.css' html.away); the bubbles say who's at work meanwhile
  useEffect(() => {
    // main says when another app is in front (a click into a Browsers page or the preview blurs the window, but Laki is
    // still in front); a browser: the page's focus, read once it has moved (into one of its frames: still focused)
    const away = (on: boolean) => void document.documentElement.classList.toggle('away', on)
    away(!document.hasFocus())
    if (bridge?.onFront) return void bridge.onFront(on => away(!on))
    const f = () => void setTimeout(() => away(!document.hasFocus()))
    window.addEventListener('focus', f)
    window.addEventListener('blur', f)
    return () => (window.removeEventListener('focus', f), window.removeEventListener('blur', f))
  }, [])
  const [dialog, setDialogNow] = useState<Dialog>(null)
  // V13: pages and dialogs change in a view transition (ui.tsx morph): Ship, New workspace and a rename grow from the
  // button that opened them and shrink back as they close
  const grows = (d: Dialog) => d === 'ship' || d === 'new' || (!!d && typeof d === 'object' && ('renameWs' in d || 'rename' in d))
  const dialogNow = useRef<Dialog>(null)
  dialogNow.current = dialog
  const setDialog = useCallback<Dispatch<SetStateAction<Dialog>>>(d => morph(() => setDialogNow(d), typeof d === 'function' ? undefined : grows(d) ? 'open' : grows(dialogNow.current) && !d ? 'close' : undefined), [])
  // the new-workspace page gone any way (Esc, a row's or the rail's click, another page over it): what it was making
  // comes as a toast, never a jump back to it from where you went
  useEffect(() => void (dialog !== 'new' && made.current.page++), [dialog])
  const [picking, setPicking] = useState(false) // development mode's element picker (Picker.tsx)
  const settingsKey = useMemo(() => ++requests, [dialog]) // each request remounts the settings page where it asks
  // #18: a page or dialog opened over an extension's or agent's ask puts it back in line (not a deny: its Esc would have
  // been the page's); it shows again as that closes. One that comes while a page is open shows over it
  useEffect(() => {
    if (dialog && toolOn) unchoose(toolOn, AWAY)
    else if (!dialog) toolShow()
  }, [dialog])
  const [newFor, setNewFor] = useState<string>() // a project just opened: its new-workspace dialog
  const [newInit, setNewInit] = useState<Partial<NewWsParams> & { linked?: boolean }>() // a laki://new link's prompt and name (linked: the page says so)
  const [newImages, setNewImages] = useState<Shot[]>([]) // the menu bar's screenshots, in the new workspace's prompt
  const [link, setLink] = useState<string>() // a laki:// link, routed once the view is in
  const [panelOpen, setPanelOpen] = useState<boolean>(() => load('laki.panel', false)) // the right panel: files, changes, review
  const [panelTab, setPanelTab] = useState<PanelTab>(() => load('laki.panelTab', 'files'))
  const [panelW, setPanelW] = useState<number>(() => load('laki.panelW', PANEL_WIDTH))
  // files open in the app, as tabs over the preview (each workspace its own); n: each request reloads it; edit: its
  // unsaved edit; storage: an artifact's (read-only). shownFile: each workspace's tab in front (fileKey)
  const [openFiles, setOpenFiles] = useState<Opened[]>([])
  const [shownFile, setShownFile] = useState<Record<string, string>>({})
  const [previewW, setPreviewW] = useState<number | null>(() => load<number | null>('laki.previewW', null)) // dragged: its width; null: it shares the room
  const [artView, setArtView] = useState<{ ws: string; path: string; wt?: boolean } | null>(null) // an HTML or Markdown artifact in the app's viewer; wt: a worktree's HTML file as a page (View as page)
  const [base, setBase] = useState<string | null>(null) // the daemon's address, for the viewer's frame ('': the page's own, remote access)
  useEffect(() => void daemonBase().then(setBase, () => {}), [])
  const [artsIn, setArtsIn] = useState<string | null>(null) // the workspace whose side panel Files shows its Artifacts (the others: their worktree)
  const [finds, setFinds] = useState<Record<string, number>>({}) // ⌘F presses per session, for its find bar
  const [floated, setFloated] = useState<string[]>([]) // tabs in windows of their own (main's tabWin): their panes say so
  const floatTab = (id: string, on = true) => bridge?.floatTab?.(id, on) // a tab in a window of its own over every app (on false: back)
  useEffect(() => void (bridge?.onFloating?.(setFloated), bridge?.floating?.().then(setFloated)), [])
  const [simFloated, setSimFloated] = useState<string[]>([]) // simulators in windows of their own: the panel shows them no more
  useEffect(() => void (bridge?.onSimFloating?.(setSimFloated), bridge?.simFloating?.().then(setSimFloated)), [])
  // tabs (of panes) per workspace: the daemon's (view.layouts, API 60: every window, the phone, Laki AI see one), kept
  // here too for the first paint and an older daemon
  const [stored, setStored] = useState<Record<string, Layout[]>>(() => load('laki.groups', {}))
  const pushes = useRef<Record<string, ReturnType<typeof setTimeout> | true>>({}) // a change of ours on its way: it wins
  // the sidebar's width per rail kind (projects, terminals, browsers: each its own); one from before, every kind's
  const [sideWs, setSideWs] = useState<Partial<Record<RailKind, number>>>(() => {
    const old = load<unknown>('laki.side', SIDE)
    const one = typeof old === 'number' && old > 0 ? old : SIDE
    const m = load<unknown>('laki.sideW', null)
    const ok = Object.entries(m && typeof m === 'object' ? m : {}).filter(([, w]) => typeof w === 'number' && w >= 160 && w <= 480) // SideHandle's range
    return { projects: one, shells: one, browsers: one, ...Object.fromEntries(ok) }
  })
  const [railKind, setRailKind] = useState<RailKind>(() => load('laki.rail', 'projects')) // the rail layout's list: which kind
  // the sidebar shown or hidden, each kind its own (Projects, Terminals, Browsers); laki.sideOpen was one for all
  const [sideOpens, setSideOpens] = useState<Partial<Record<RailKind, boolean>>>(() => (o => (o && typeof o === 'object' ? o : { projects: o !== false }))(load<unknown>('laki.sideOpen', true)))
  // Terminals' and Browsers' list folded to a strip, left or right of the main area (as Changes' comments): a kind's
  const [strips, setStrips] = useState<Partial<Record<RailKind, 'left' | 'right'>>>(() => load('laki.strips', {}))
  const setStrip = (k: RailKind, at?: 'left' | 'right') => setStrips(m => (({ [k]: _, ...rest }) => (at ? { ...rest, [k]: at } : rest))(m))
  const [folded, setFolded] = useState<string[]>(() => load('laki.folded', [])) // projects and seps whose workspaces are hidden
  const [find, setFind] = useState<Find | null>(null) // the sidebar's filter: null, all of them
  const [runsSeen, setRunsSeen] = useState<string>(() => load('laki.runsSeen', '')) // the newest scheduled run read
  // the sidebar's video (its embed URL); play: just asked for, so it starts (one kept from before waits for a click), at:
  // when, so the same link asked for again starts over; min: only its bar shows (it plays on)
  const [video, setVideo] = useState<{ src: string; play?: boolean; at?: number; min?: boolean } | null>(() => {
    const kept = load<unknown>('laki.video', null)
    const src = typeof kept === 'string' && youtubeEmbed(kept) // checked again: it becomes an iframe's src
    return src ? { src } : null
  })
  const [dropping, setDropping] = useState(false) // a folder dragged over the window
  const [shown, setShown] = useState<ShownWin[]>([]) // what workflows' Show you blocks show, in turn
  const [pops, setPops] = useState<ShownPop[]>([]) // and their popovers (an end's too), the newest 3
  const { notices, answer: answerNotice } = useNotices() // laki notice's cards, in the same corner
  const [sharing, setSharing] = useState<string | null>(null) // the tab whose Share popover is open
  const [reply, setReply] = useState<{ tab: string; text: string; x: number; y: number } | null>(null) // Reply on a terminal's selected text
  const [note, setNote] = useState<{ text: string; undo?: () => void; label?: string; ok?: boolean; busy?: boolean; err?: boolean } | null>(null) // the toast, maybe with Undo (or another action: label); ok: done, not a failure; busy: under way, until the next one
  const [menu, showMenu] = useMenu()
  const [gallery, setGallery] = useState<string | null>(null) // the workspace whose Artifacts show over the status bar
  const [branchFull, setBranchFull] = useState(() => load('laki.branchFull', false)) // the status bar's branch: all of it, base too
  // Collision radar's overlaps you hid, until they change (each one's radarKey)
  const [radarHid, setRadarHid] = useState<string[]>(() => load('laki.radarHide', []))
  const [overlapsAt, setOverlapsAt] = useState<{ w: string; list?: Collision[]; err?: string } | null>(null) // Check overlaps' dialog: one workspace's, as asked (list: none yet)
  const [readMode, setReadMode] = useState<Record<string, 'reader' | 'term'>>(() => load('laki.reader', {})) // Reader view: each agent tab's, as you left it
  const [checkHid, setCheckHid] = useState<string[]>([]) // Done means checked: strips hidden (workspace:at)
  const [hookHid, setHookHid] = useState<string[]>([]) // hooks not heard: strips dismissed (tab ids)
  // full screen (⌘⇧⏎, the tab bar's ⤢): the tab's content alone, no rail, sidebar, tab bar, panels or status bar; the
  // window full screen too (main's, so Esc stays the terminal's)
  const [full, setFull] = useState(false)
  const toggleFull = (on = !full) => (setFull(on), bridge?.fullScreen?.(on))
  const uiRef = useRef<(m: { do?: string; tab?: string; link?: string; on?: boolean; panel?: string }) => void>(undefined) // Q13: laki_ui's moves, with this render's state
  const [apps, setApps] = useState<AppInfo[]>([])
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const narrow = useSyncExternalStore(NARROW.on, NARROW.now) // a phone: one pane at a time, the sidebar and panels over it
  const sideKey: RailKind = narrow ? 'projects' : railKind // a phone's drawer: one, whatever a row's kind
  const sideOpen = sideOpens[sideKey] ?? sideOpens.projects ?? true
  const keyNow = useRef(sideKey)
  keyNow.current = sideKey // the kind in sight when it's called: a timer's ring is an older render's
  const setSideOpen = (v: boolean | ((o: boolean) => boolean)) => setSideOpens(m => (k => ({ ...m, [k]: typeof v === 'function' ? v(m[k] ?? m.projects ?? true) : v }))(keyNow.current))
  const touch = useSyncExternalStore(TOUCH.on, TOUCH.now)
  // a workspace's card as the mouse rests on its row (peekCard): its id, where (the row's top, the sidebar's right
  // edge); a moment to move onto it, where its links and buttons take clicks; a wheel, a key or leaving the window hides it
  const [peek, setPeekNow] = useState<{ id: string; top: number; left: number } | null>(null)
  // none to hide: no update at all. setPeekNow(null) on none still runs App (React bails out after the render), and a
  // menu's open, a row's press and leaving a row ask for it: 10 ms each with 40 workspaces
  const peekOn = useRef(false)
  const setPeek = (p: typeof peek) => void ((p || peekOn.current) && ((peekOn.current = !!p), setPeekNow(p)))
  // its diff's size, asked for as the card opens (the scan keeps only the shown workspaces')
  const [peekStat, setPeekStat] = useState<{ id: string; stat: Stat } | null>(null)
  useEffect(() => {
    if (!peek || viewRef.current?.workspaces.find(w => w.id === peek.id)?.stat) return // the scan's already
    let on = true
    api.call<Stat | null>('wsStat', { ws: peek.id }).then(stat => on && stat && setPeekStat({ id: peek.id, stat }), () => {})
    return () => void (on = false)
  }, [peek?.id])
  const peekTimer = useRef(0)
  const peekBox = useRef<HTMLDivElement>(null)
  // a menu (a row's ⋯, a right click, any other) closes the card first
  const openMenu: typeof showMenu = (e, items, align) => (clearTimeout(peekTimer.current), setPeek(null), showMenu(e, items, align))
  // Settings › Layout's Menus: macOS: a workspace's and a tab's menu drawn by macOS (main's menu-popup), else Laki's (a
  // browser, remote access, or a menu with an emoji grid or a filter)
  const wsTabMenu: typeof showMenu = (e, items, align) => {
    const m = viewRef.current?.settings.menus === 'macos' && bridge?.menuPopup ? menuModel(items) : undefined
    if (!m) return openMenu(e, items, align)
    if (!(e instanceof DOMRect)) (e.preventDefault(), e.stopPropagation())
    const at = e instanceof DOMRect ? e : e.type === 'contextmenu' ? new DOMRect(e.clientX, e.clientY, 0, 0) : (e.currentTarget as HTMLElement).getBoundingClientRect()
    clearTimeout(peekTimer.current)
    setPeek(null)
    void bridge!.menuPopup!(m.model, at.left, at.bottom).then(id => id && m.runs.get(id)?.())
  }
  useEffect(() => {
    if (!peek) return
    const hide = (e: Event) => !(e.type === 'wheel' && peekBox.current?.contains(e.target as Node)) && (clearTimeout(peekTimer.current), setPeek(null))
    const on = ['wheel', 'keydown'] as const
    for (const k of on) window.addEventListener(k, hide, true)
    window.addEventListener('blur', hide) // the window's own (not captured: a button on the card taking the focus would hide it before its click)
    return () => (on.forEach(k => window.removeEventListener(k, hide, true)), window.removeEventListener('blur', hide))
  }, [!!peek])
  useLayoutEffect(() => { // kept inside the window, as its text changes too
    const el = peekBox.current
    if (el && peek) el.style.top = `${Math.max(8, Math.min(peek.top - 6, window.innerHeight - el.offsetHeight - 8))}px`
  })
  const mru = useRef<string[]>([]) // sessions, most recently focused first: which pane a tab focuses

  const live = useMemo(() => view?.workspaces.filter(w => !w.archived) ?? [], [view])
  // files open in a workspace that's gone (archived, deleted) close with it
  useEffect(() => void (view && setOpenFiles(l => (l.every(f => live.some(w => w.id === f.ws)) ? l : l.filter(f => live.some(w => w.id === f.ws))))), [live])
  // a shell's spinner stops SHELL_SPIN after its command started (Glyph's spins): drawn again as one crosses it
  const [, spinTick] = useState(0)
  const spinLeft = view ? spinsUntil(view.tabs) : undefined
  useEffect(() => {
    if (spinLeft === undefined) return
    const t = setTimeout(() => spinTick(n => n + 1), spinLeft + 50)
    return () => clearTimeout(t)
  })
  // when each agent tab last worked or waited (laki.active, by tab), for the recent ones
  const active = useRef<Record<string, number>>((a => (a && typeof a === 'object' && !Array.isArray(a) ? a : {}))(load<unknown>('laki.active', {})) as Record<string, number>)
  const turnAt = useRef<Record<string, number>>({}) // each tab's last turn start (the island's done in 4m 12s)
  for (const t of view?.tabs ?? []) if (t.kind === 'agent' && (t.status === 'running' || t.status === 'waiting' || (t.done && !active.current[t.id]))) active.current[t.id] = Date.now() // done unseen with no stamp: it ran while the app was closed
  // a project's sidebar rows: rowsOf, each group's workspaces (and the ones above its first group) in its sort, a
  // group's own or the project's (manual: as dragged); last active: its agents' latest turn here, else when it was made
  const lastAts = new Map<string, number>() // this render's, by workspace
  for (const t of view?.tabs ?? []) lastAts.set(t.workspace, Math.max(lastAts.get(t.workspace) ?? 0, active.current[t.id] ?? 0))
  const lastAt = (w: WorkspaceView) => Math.max(w.created, lastAts.get(w.id) ?? 0)
  const SORT_BY: Record<WsSort, ((a: WorkspaceView, b: WorkspaceView) => number) | null> = { manual: null, created: (a, b) => b.created - a.created, activity: (a, b) => lastAt(b) - lastAt(a), name: (a, b) => wsName(a).localeCompare(wsName(b), undefined, { numeric: true }) }
  const sortedRows = (p: Project, ws: WorkspaceView[]) => {
    const out: (WorkspaceView | Sep)[] = []
    let run: WorkspaceView[] = []
    let by = SORT_BY[p.sort ?? 'manual']
    const flush = () => void (out.push(...(by ? run.sort(by) : run)), (run = []))
    for (const x of rowsOf(p, ws))
      if ('path' in x) run.push(x)
      else flush(), out.push(x), (by = SORT_BY[x.sort ?? p.sort ?? 'manual'])
    flush()
    return out
  }
  const byProject = (view?.projects ?? []).flatMap(p => sortedRows(p, live).filter((x): x is WorkspaceView => 'path' in x)) // as the sidebar shows them
  const pinned = byProject.filter(w => w.pinned) // the sidebar's top
  // the sidebar's order: Pinned, then each project's (⌘↑/⌘↓, ⌘J, the palette)
  const order = [...pinned, ...byProject.filter(w => !w.pinned)]
  // what's on screen stays there: a pick that's gone (archived, removed) or not in the view yet falls back to the one
  // shown, not to the first row, which a new workspace (placed on top, or sorted by last active) would take
  const shownWs = useRef<string | null>(null)
  // a kind whose rail button is off (Settings › Appearance › Rail): its projects go in Projects' list
  const railOf = (k?: RailKind): RailKind => ((k === 'shells' && view?.settings.railShells === false) || (k === 'browsers' && view?.settings.railBrowsers === false) ? 'projects' : (k ?? 'projects'))
  const rawKind = (w: WorkspaceView): RailKind => view?.projects.find(p => p.id === w.project)?.kind ?? 'projects'
  const kindOf = (w: WorkspaceView): RailKind => railOf(rawKind(w))
  // one closed, archived or removed: the next row (else the one before), of its project first, then of its rail kind;
  // none of its kind: none (`gone`), so the rail stays where it was and shows the empty view, not another kind's list
  const lastRows = useRef<WorkspaceView[]>([])
  const nextWs = (id: string | null) =>
    (o => (i => (i < 0 ? undefined : (near => near.find(w => w.project === o[i].project) ?? near.find(w => kindOf(w) === kindOf(o[i])))([...o.slice(i + 1), ...o.slice(0, i).reverse()].map(w => live.find(x => x.id === w.id)).filter((w): w is WorkspaceView => !!w))))(o.findIndex(w => w.id === id)))(lastRows.current)
  const gone = !!shownWs.current && !live.some(w => w.id === shownWs.current) && lastRows.current.some(w => w.id === shownWs.current)
  // wsId '': none on purpose (the last of its kind went), until one is picked
  const ws = live.find(w => w.id === wsId) ?? live.find(w => w.id === shownWs.current) ?? nextWs(shownWs.current) ?? (gone || wsId === '' ? null : order[0]) ?? null
  useEffect(() => void (gone && !ws && setWsId('')), [gone, ws])
  shownWs.current = ws?.id ?? null
  lastRows.current = order
  const wsFiles = ws ? openFiles.filter(f => f.ws === ws.id) : [] // this workspace's open files, its tabs
  const previewed = wsFiles.find(f => fileKey(f) === shownFile[ws?.id ?? '']) ?? wsFiles.at(-1) ?? null // the one in front
  const project = view?.projects.find(p => p.id === ws?.project)
  const git = project?.git !== false
  const tabs = useMemo(() => view?.tabs.filter(t => t.workspace === ws?.id) ?? [], [view, ws])
  const byId = (id: string) => tabs.find(t => t.id === id)
  const placed = groupsOf(stored[ws?.id ?? ''], tabs.map(t => t.id))
  const groups = narrow ? placed.flatMap(g => tabsOf(g).map(tab => ({ tab }))) : placed // too narrow for splits: a tab per pane
  const shownTab = useRef<string | null>(null) // likewise the tab: a new one doesn't take the pane's place
  const shownOrder = useRef<string[]>([]) // the tab bar as last drawn: a closed tab's next one (else the one before) takes its place
  const nextOf = (id: string | null) => (o => (i => (i < 0 ? undefined : [...o.slice(i + 1), ...o.slice(0, i).reverse()].map(byId).find(Boolean)))(o.indexOf(id ?? '')))(shownOrder.current)
  const tab = tabs.find(t => t.id === tabByWs[ws?.id ?? '']) ?? tabs.find(t => t.id === shownTab.current) ?? nextOf(shownTab.current) ?? tabs.find(t => t.kind === 'agent') ?? tabs[0] ?? null
  shownTab.current = tab?.id ?? null
  shownOrder.current = groups.flatMap(tabsOf)
  const group = groups.find(g => tabsOf(g).includes(tab?.id ?? '')) ?? null
  const visible = tabsOf(group)

  useEffect(() => void localStorage.setItem('laki.ws', JSON.stringify(ws?.id ?? null)), [ws?.id])
  // the selected workspace's row in sight, however it was picked (a bubble, a notification, ⌘J, a link): a list scrolled
  // away from it comes back to it, once (a folded one as it unfolds); one in sight doesn't move
  // scrollAsk: from outside the window (a bubble, a notification), the one selected already too
  const scrolledTo = useRef<string | null>(null)
  const [scrollAsk, setScrollAsk] = useState(0)
  useEffect(() => {
    const id = ws?.id
    if (!id || scrolledTo.current === id) return
    const f = requestAnimationFrame(() => (el => el && (el.scrollIntoView({ block: 'nearest' }), (scrolledTo.current = id)))(document.querySelector(`.sidebar [data-row="ws:${CSS.escape(id)}"]`)))
    return () => cancelAnimationFrame(f)
  }, [ws?.id, folded, scrollAsk])
  // back and forward: each new place after the one you're at (what was ahead of it goes, as in a
  // browser); a move of travel's own is that place again, not a new one
  const historyOn = !!view && view.settings?.history !== false
  const hist = useRef<{ at: Place[]; i: number; going?: string }>({ at: [], i: -1 })
  const [, histDrawn] = useState(0)
  const hereKey = JSON.stringify({ d: dialog, ws: ws?.id ?? null })
  useEffect(() => {
    const h = hist.current
    if (!historyOn || !isPlace(dialog)) return
    const going = h.going
    h.going = undefined
    if (going === hereKey || (h.at[h.i] && JSON.stringify(h.at[h.i]) === hereKey)) return
    h.at = [...h.at.slice(0, h.i + 1), { d: dialog, ws: ws?.id ?? null }].slice(-(HISTORY_MAX + 1))
    h.i = h.at.length - 1
    histDrawn(n => n + 1)
  }, [hereKey, historyOn])
  // to the place at j: its workspace selected again (one gone since: the one you're in; the workspace view of one gone,
  // or a page turned off since: skipped)
  const travel = (j: number) => {
    const h = hist.current
    const by = j < h.i ? -1 : 1
    const s = view?.settings ?? {}
    const off = (d: Dialog) => (d === 'desk' && s.desk === false) || (d === 'calendar' && s.calendar === false) || (d === 'bird' && s.birdView === false) || (d === 'ai' && !aiOn(s)) || (!!notesOf(d) && s.notes === false) || (d === 'todos' && s.todoList === false) || (!!specsOf(d) && !specsOnIn(s)) || (!!flowsOf(d) && !flowsOnIn(s))
    const gone = (p: Place) => off(p.d) || (p.d === null && !!p.ws && !live.some(w => w.id === p.ws))
    while (h.at[j] && gone(h.at[j])) j += by
    const p = h.at[j]
    if (!p || j === h.i) return
    const to: Place = { d: p.d, ws: p.ws && live.some(w => w.id === p.ws) ? p.ws : (ws?.id ?? null) }
    h.at[j] = to
    h.i = j
    h.going = JSON.stringify(to)
    if (to.ws && to.ws !== ws?.id) setWsId(to.ws)
    setDialog(to.d)
    histDrawn(n => n + 1)
  }
  const projOf = (w?: { project: string } | null) => (w ? view?.projects.find(p => p.id === w.project) : undefined)
  const tint = (w: WorkspaceView) => (w.color && w.color !== 'none' ? w.color : projOf(w)?.color) // its own color, else its project's
  const placeName = (p: Place) => {
    const d = p.d
    const w = live.find(x => x.id === p.ws)
    if (d === null) return w ? wsName(w) : 'the workspace'
    if (typeof d === 'string') return d === 'settings' ? 'Settings' : PAGE_WORDS[d] ?? d
    if ('extension' in d) return d.extension ? (view?.widgets?.find(x => x.id === d.extension)?.name ?? 'an extension') : 'New extension'
    if ('uikit' in d) return 'the UI kit'
    if ('settings' in d || 'section' in d) return 'Settings'
    if ('project' in d) return view?.projects.find(x => x.id === d.project)?.name ?? 'a project'
    if ('schedules' in d) return 'Schedule'
    if ('compare' in d) return 'Compare'
    if ('specs' in d) return d.slug ? (d.kind === 'brainstorm' ? 'A brainstorm' : 'A spec') : d.templates ? 'Spec templates' : 'Specs'
    if ('workflows' in d) return (n => (n.startsWith('run:') ? 'A workflow run' : n ? 'A workflow' : 'Workflows'))(d.nav ?? (d.run ? 'run:' : d.wf ? 'wf:' : ''))
    if ('note' in d) return 'Notes'
    return 'a page'
  }
  // the window's title (a screen share's picker, the Window menu, a browser's tab): the page you're on, else the
  // workspace and its tab; a dialog over a page (⌘K, a rename) keeps the page's
  const titleAt = useRef<Dialog>(null)
  if (isPlace(dialog)) titleAt.current = dialog
  // a workspace whose project has an emoji: it and the project's name first (🛒 web · fix-login)
  const hereP = projOf(ws)
  const pe = emojiOf(hereP?.icon)
  const here = titleAt.current === null ? [pe && `${pe} ${hereP!.name}`, ws && wsName(ws), tab?.name].filter(Boolean).join(' · ') : view ? placeName({ d: titleAt.current, ws: ws?.id ?? null }) : ''
  const winTitle = here ? `${here} — Laki` : 'Laki'
  useEffect(() => void (document.title = winTitle), [winTitle])
  useEffect(() => void localStorage.setItem('laki.tabs', JSON.stringify(tabByWs)), [tabByWs])
  useEffect(() => void localStorage.setItem('laki.groups', JSON.stringify(stored)), [stored])
  const layoutsOn = hasCap(view, 'layouts')
  const migrated = useRef(false)
  useEffect(() => {
    if (!layoutsOn || !view) return
    const l = view.layouts ?? {}
    // the first time: what this window arranged before the daemon kept layouts
    if (!migrated.current) {
      migrated.current = true
      for (const [id, g] of Object.entries(stored)) if (!l[id] && view.workspaces.some(w => w.id === id) && g.some(x => !('tab' in x))) call('layoutSet', { ws: id, groups: g }).catch(() => {})
    }
    setStored(m => {
      let n = m
      for (const [id, g] of Object.entries(l)) if (!pushes.current[id] && JSON.stringify(g) !== JSON.stringify(m[id])) n = { ...n, [id]: g }
      return n
    })
  }, [view?.layouts, layoutsOn])
  useEffect(() => void localStorage.setItem('laki.sideW', JSON.stringify(sideWs)), [sideWs])
  useEffect(() => void localStorage.setItem('laki.sideOpen', JSON.stringify(sideOpens)), [sideOpens])
  useEffect(() => void localStorage.setItem('laki.rail', JSON.stringify(railKind)), [railKind])
  useEffect(() => void localStorage.setItem('laki.strips', JSON.stringify(strips)), [strips])
  useEffect(() => void localStorage.setItem('laki.folded', JSON.stringify(folded)), [folded])
  useEffect(() => void localStorage.setItem('laki.branchFull', JSON.stringify(branchFull)), [branchFull])
  useEffect(() => store('laki.reader', (o => (Object.keys(o).length ? o : undefined))(Object.fromEntries(Object.entries(readMode).filter(([id]) => !view || view.tabs.some(t => t.id === id))))), [readMode]) // closed tabs' go
  useEffect(() => store('laki.radarHide', radarHid.length ? radarHid.slice(-200) : undefined), [radarHid]) // ponytail: the newest 200, none pruned as they go
  // a new workspace, and the one selected before it, stay in sight: their projects and seps unfold once the view has them
  const [reveal, setReveal] = useState<string[]>([])
  useEffect(() => {
    if (!view || !reveal.length) return
    const here = reveal.filter(id => view.workspaces.some(w => w.id === id))
    if (!here.length) return
    const open = new Set<string>()
    for (const p of view.projects) {
      let sep = ''
      for (const x of rowsOf(p, view.workspaces)) {
        if (!('path' in x)) sep = x.id
        else if (here.includes(x.id)) open.add(p.id).add(sep)
      }
    }
    setFolded(f => (f.some(x => open.has(x)) ? f.filter(x => !open.has(x)) : f))
    setReveal(r => r.filter(id => !here.includes(id)))
  }, [view, reveal])
  useEffect(() => void localStorage.setItem('laki.video', JSON.stringify(video?.src ?? null)), [video?.src])
  // the sidebar's timers, each a bar over its foot: when it ends, how long it was set for, and what happens then (ones
  // that ended while Laki was closed are dropped; a reminder's comes at once)
  const missed = useRef<Timer[]>([]) // messages for later due while Laki was closed: not sent, said so once it's up
  const [timers, setTimers] = useState<Timer[]>(() => {
    const kept = load<unknown>('laki.timers', [])
    return (Array.isArray(kept) ? kept : []).flatMap((t: Partial<Timer>): Timer[] => {
      if (t?.then === 'send') {
        const ok = typeof t.id === 'string' && typeof t.end === 'number' && typeof t.ms === 'number' && typeof t.tab === 'string' && typeof t.text === 'string' && typeof t.ws === 'string'
        if (ok && t.end! <= Date.now() && !missed.current.some(x => x.id === t.id)) missed.current.push(t as Timer)
        return ok && t.end! > Date.now() ? [{ id: t.id!, end: t.end!, ms: t.ms!, then: 'send' as const, ws: t.ws, tab: t.tab, text: t.text }] : []
      }
      const remind = t?.then === 'remind' && typeof t.ws === 'string'
      const left = !remind && typeof t?.left === 'number' && t.left > 0 ? t.left : undefined // paused: kept however long it was closed
      return typeof t?.id === 'string' && typeof t.end === 'number' && (t.end > Date.now() || remind || left) && typeof t.ms === 'number' && t.ms > 0
        ? [{ id: t.id, end: t.end, ms: t.ms, then: remind || (TIMER_THEN.some(x => x[0] === t.then) && (t.then !== 'command' || (typeof t.cmd === 'string' && !!t.cmd.trim() && typeof t.ws === 'string'))) ? t.then! : 'notify', cmd: t.cmd, ws: t.ws, left, ...(typeof t.note === 'string' && t.note.trim() && { note: t.note.trim().slice(0, 120) }), ...(t.important === true && { important: true }) }]
        : []
    })
  })
  useEffect(() => void localStorage.setItem('laki.timers', JSON.stringify(timers)), [timers])
  // stopwatches (the timer button's Stopwatch): ms counted before, from: running since; kept across a reload
  const [watches, setWatches] = useState<Watch[]>(() => (l => (Array.isArray(l) ? l.filter((w: Watch) => typeof w?.id === 'string' && typeof w.ms === 'number' && (w.from === undefined || typeof w.from === 'number')) : []))(load<unknown>('laki.watches', [])))
  useEffect(() => void localStorage.setItem('laki.watches', JSON.stringify(watches)), [watches])
  const setWatch = (id: string, f: (w: Watch) => Watch | null) => setWatches(l => l.map(w => (w.id === id ? f(w) : w)).filter((w): w is Watch => !!w))
  const watchesRef = useRef(watches)
  watchesRef.current = watches
  // Laki AI's timers (laki_timer, through the daemon): a timer, a reminder about a workspace, a message for later or a
  // stopwatch; what runs; one stopped
  const timerAct = useRef<(m: { act: string; ms: number; note?: string; ws?: string; tab?: string; text?: string; which?: string; important?: boolean }) => unknown>(() => {})
  timerAct.current = m => {
    const id = Math.random().toString(36).slice(2, 10)
    if (m.act === 'stopwatch') return (setWatches(l => [...l, { id, ms: 0, from: Date.now() }]), { id, stopwatch: 'running' })
    if (m.act === 'list')
      return {
        timers: timersRef.current.map(t => ({ id: t.id, kind: t.then === 'remind' ? 'reminder' : t.then === 'send' ? 'send later' : 'timer', secondsLeft: Math.round((t.left ?? t.end - Date.now()) / 1000), paused: t.left !== undefined, note: t.note, ws: t.ws, text: t.text, ...(t.important && { important: true }) })),
        stopwatches: watchesRef.current.map(w => ({ id: w.id, seconds: Math.round((w.ms + (w.from ? Date.now() - w.from : 0)) / 1000), running: !!w.from })),
      }
    if (m.act === 'stop') {
      if (timersRef.current.some(t => t.id === m.which)) return (setTimer(m.which!, () => null), { stopped: m.which })
      if (watchesRef.current.some(w => w.id === m.which)) return (setWatch(m.which!, () => null), { stopped: m.which })
      throw new Error(`no timer or stopwatch ${m.which}`)
    }
    const then: Partial<Timer> = m.act === 'remind' ? { then: 'remind', ws: m.ws } : m.act === 'send' ? { then: 'send', ws: m.ws, tab: m.tab, text: m.text } : {}
    setTimers(l => [...l, { id, end: Date.now() + m.ms, ms: m.ms, then: 'notify', ...then, ...(m.note && { note: m.note }), ...(m.important === true && m.act === 'timer' && { important: true }) }])
    return { id, rings: new Date(Date.now() + m.ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
  }
  const addTimer = (ms: number, more: Partial<Timer> = {}) => {
    if (more.then !== 'remind') earn(more.then === 'send' ? 'later' : 'timer')
    setTimers(l => [...l, { id: Math.random().toString(36).slice(2, 10), end: Date.now() + ms, ms, then: 'notify', ...more }])
  }
  const setTimer = (id: string, f: (t: Timer) => Timer | null) => setTimers(l => l.map(t => (t.id === id ? f(t) : t)).filter((t): t is Timer => !!t)) // null: gone
  const restart = (id: string, ms: number) => setTimer(id, x => ({ ...x, end: Date.now() + ms, ms, left: undefined })) // a new length, running
  // one ends: what was picked, then a notification (it's what you asked for: muting doesn't apply) and a message
  const timersRef = useRef(timers)
  timersRef.current = timers
  const ring = (id: string) => {
    const t = timersRef.current.find(x => x.id === id)
    if (!t) return
    if ((t.then === 'send' || t.then === 'remind') && !viewRef.current) return void setTimeout(() => ring(id), 1000) // due as Laki opens: once the tabs are in
    if (t.then === 'send' && t.tab === 'ai') return void (setTimer(id, () => null), askLater(stamp(t.text!, Date.now())))
    if (t.then === 'send') {
      setTimer(id, () => null)
      const tab = viewRef.current?.tabs.find(x => x.id === t.tab)
      const say = (text: string, ok?: boolean) => (notify('Message for later', text, ok ? t.tab! : '', () => tab && selectTab(tab.id), viewRef.current?.settings.notifySound), toast(text, undefined, undefined, ok))
      if (!tab) return say(`Not sent: its agent tab is gone (${clip(t.text!)})`)
      return void api.call<{ queued?: number }>('send', { target: tab.id, text: stamp(t.text!, Date.now()), whenIdle: true, steer: true }).then(
        r => say(`${r?.queued ? `Queued for ${tab.name}, busy now` : `Sent to ${tab.name}`}: ${clip(t.text!)}`, true),
        e => say(`Not sent to ${tab.name}: ${e.message}`),
      )
    }
    setTimer(id, () => null)
    if (t.then === 'remind') {
      const w = viewRef.current?.workspaces.find(x => x.id === t.ws && !x.archived)
      const say = w ? wsName(w) : 'a workspace that is gone now'
      notify('Reminder', say, (w && viewRef.current?.tabs.find(x => x.workspace === w.id)?.id) ?? '', () => w && setWsId(w.id), viewRef.current?.settings.notifySound) // its click: there
      return toast(`Reminder: ${say}`, w && (() => setWsId(w.id)), 'Open')
    }
    // no video now, or the command's workspace gone: only the notice (which says so for the command)
    const gone = t.then === 'command' && !viewRef.current?.workspaces.some(w => w.id === t.ws && !w.archived)
    const then = gone || (t.then !== 'command' && t.then !== 'notify' && !document.querySelector('.video')) ? 'notify' : t.then
    if (then === 'pause') videoCommand('pauseVideo')
    else if (then === 'play') (setVideo(v => v && { ...v, min: false }), setSideOpen(true), videoCommand('playVideo'))
    else if (then === 'close') setVideo(null)
    else if (then === 'command') call('tabNew', { ws: t.ws, preset: 'custom', cmd: t.cmd }).catch(() => {}) // a tab of its own, not focused: it closes when the command succeeds
    const did = gone ? `: ${t.cmd} didn't run, its workspace is gone` : then === 'notify' ? '' : then === 'command' ? `: ran ${t.cmd}` : `: ${TIMER_THEN.find(x => x[0] === then)![1].toLowerCase()}`
    // Settings › General › Timers: a sound and the app's dialog (Again starts the same one over), or a notification
    const s = viewRef.current?.settings
    const sound = s?.timerSound || 'Glass'
    const up = t.note ? `${t.note} (${span(t.ms)} is up${did})` : `${span(t.ms)} is up${did}` // its message first: what it was for
    if (t.important && bridge) return void (notify(t.note || 'Timer', up, '', () => {}, sound, undefined, { tone: 'info' }), toast(`Timer: ${up}`)) // a card on screen until closed
    if (s?.timerAlert === 'notification') return void (notify(t.note || 'Timer', up, '', () => {}, sound), toast(`Timer: ${up}`))
    if (sound !== 'none') bridge?.sound?.(sound)
    const again = () => addTimer(t.ms, { then: t.then, cmd: t.cmd, ws: t.ws, note: t.note, important: t.important })
    if (document.querySelector('.ask-overlay')) return toast(`Timer: ${up}`, again, 'Again') // a dialog would answer the open one with no
    choose(t.note || `${span(t.ms)} timer is up`, [t.note && `${span(t.ms)} timer is up`, did && did.slice(2).replace(/^./, c => c.toUpperCase())].filter(Boolean).join(' · ') || undefined, [{ label: 'Again' }, { label: 'OK', primary: true }]).then(i => i === 0 && again())
  }
  // Send later to Laki AI: asked now, or once it's free (one ask at a time: tried every 15 s for an hour); its answer is
  // a notification that opens the AI page
  // busy or not connected (a daemon restarting): tried again every 15 s for an hour
  // ponytail: the retries live in this window only; a reload meanwhile drops the ask (keep it as a timer if that bites)
  const askLater = (text: string, tries = 0) => {
    const say = (s: string, ok?: boolean) => (notify('Laki AI', s, '', () => setDialog('ai'), viewRef.current?.settings.notifySound), toast(s, () => setDialog('ai'), 'Open', ok))
    if (!tries) toast(`Asked Laki AI: ${clip(text)}`, () => setDialog('ai'), 'Open', true)
    api.call('aiAsk', { text }).then(
      () => say(`Answered: ${clip(text)}`, true),
      e => (/^(the AI is still|the AI is at work|not connected)/.test(e.message) && tries < 240 ? void setTimeout(() => askLater(text, tries + 1), 15000) : say(`${tries >= 240 || /^(Laki AI is off|ask something|no OpenRouter API key|not connected)/.test(e.message) ? 'Not asked' : 'Failed'}: ${e.message} (${clip(text)})`)),
    )
  }
  useEffect(() => {
    const n = missed.current.length
    if (n) toast(n > 1 ? `${n} messages for later weren't sent: Laki was closed when they were due` : `A message for later wasn't sent: Laki was closed at ${new Date(missed.current[0].end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${clip(missed.current[0].text!, 40)})`)
    missed.current = []
  }, [])
  const ends = timers.map(t => `${t.id}:${t.end}:${t.left}`).join()
  useEffect(() => {
    const ts = timersRef.current.filter(t => t.left === undefined).map(t => setTimeout(() => ring(t.id), t.end - Date.now()))
    return () => ts.forEach(clearTimeout)
  }, [ends])
  // the Dock's count: agents waiting for you or done while you looked away, muted ones and archived workspaces aside
  const quiet = new Set(view?.workspaces.filter(w => w.muted || w.archived).map(w => w.id))
  const needsYou = (t: TabView) => needsTab(t) && !t.muted && !quiet.has(t.workspace)
  // the Dock's count, and the menu bar's item from the same list: waiting ones first, each with what it asks
  const waits = useRef(new Map<string, string>()) // a tab's last waiting turn's text (turn events)
  const hid = useRef(new Set<string>()) // Recording mode's hidden workspaces (veiled): their events say nothing
  const needing = view?.tabs.filter(needsYou) ?? []
  const trayItems = [...needing.filter(t => t.status === 'waiting'), ...needing.filter(t => t.status !== 'waiting')].map(t => {
    const w = view?.workspaces.find(w => w.id === t.workspace)
    const asks = t.status === 'waiting' ? waits.current.get(t.id) || t.ask?.options.map(o => o.label).join(' / ') || 'waiting for you' : 'finished'
    return { tab: t.id, label: `${w ? wsName(w) : t.workspace} · ${t.name}: ${asks.replace(/\s+/g, ' ').slice(0, 60)}` }
  })
  // Q8: what the menu bar's icon shows (Settings › General › Menu bar's Show state, on unless off): idle, working,
  // waiting, blocked (the view as drawn: Recording mode's private workspaces out of it, as out of the count)
  const trayInfo = view && view.settings.trayState !== false ? stateOf(view) : undefined
  // blocked by a plan limit: drawn again as the soonest one resets (nothing else may change the view then)
  const [, trayTick] = useState(0)
  const resetAt = trayInfo?.blocked ? Math.min(...view!.tabs.map(t => t.limit ?? 0).filter(l => l > Date.now())) : Infinity
  useEffect(() => {
    if (!Number.isFinite(resetAt)) return
    const t = setTimeout(() => trayTick(n => n + 1), Math.min(resetAt - Date.now() + 500, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [resetAt])
  const dockBar = view ? dockProgress(view) : -1 // U15: a Ship or a workflow run at work: the Dock's progress bar
  const inboxItems = view && view.settings.menuBarClick === 'inbox' ? inboxOf(view, id => waits.current.get(id)) : undefined // the menu bar's Inbox (tray.ts)
  const trayKey = JSON.stringify([trayItems, view?.settings.menuBar, view?.settings.recording, trayInfo && [trayInfo.state, trayInfo.working, trayInfo.blocked], dockBar, inboxItems])
  // Handoff: remote access's address while it runs, with Settings' switch on (main offers only a lasting https one)
  const rem = view?.remote
  useEffect(() => bridge?.handoff?.(view?.settings.remoteHandoff && rem?.url ? { url: rem.url, via: rem.via, host: rem.host } : null), [view?.settings.remoteHandoff, rem?.url, rem?.via, rem?.host])
  useEffect(() => bridge?.badge?.(trayItems.length, trayItems, view?.settings.menuBar !== false, !!view?.settings.recording, trayInfo, dockBar, inboxItems), [trayKey])
  // U15: a workspace that starts waiting on you while Laki isn't in front: the Dock bounces once (tray.ts bounceOf)
  const waitedWs = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!view || !bridge?.bounce) return
    const b = bounceOf(waitedWs.current, view, document.hasFocus())
    waitedWs.current = b.now
    if (b.bounce) bridge.bounce()
  }, [view])
  useEffect(() => void (narrow && dialog && setSideOpen(false)), [narrow, dialog]) // a page the drawer opened goes on top
  // the phone's tab strip scrolls: the selected tab first in it (scroll-padding clears the sidebar button)
  useEffect(() => void (narrow && document.querySelector('.tab.sel')?.scrollIntoView({ block: 'nearest', inline: 'start' })), [narrow, tab?.id])
  useEffect(() => {
    localStorage.setItem('laki.panel', JSON.stringify(panelOpen))
    localStorage.setItem('laki.panelTab', JSON.stringify(panelTab))
    localStorage.setItem('laki.panelW', JSON.stringify(panelW))
    localStorage.setItem('laki.previewW', JSON.stringify(previewW))
  }, [panelOpen, panelTab, panelW, previewW])

  // Settings › Appearance › Background image: the daemon's file as a blob URL here (a short one in the theme's CSS)
  const bgFile = view?.settings.background?.file
  const [bgUrl, setBgUrl] = useState('')
  useEffect(() => {
    let url = ''
    let live = true // a late answer, after the file changed or went: dropped
    if (bgFile)
      void api.call<string | null>('bgGet').then(
        d => {
          if (!d || !live) return
          const [head, b64] = d.split(',')
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
          setBgUrl((url = URL.createObjectURL(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) }))))
        },
        () => {},
      )
    else setBgUrl('')
    return () => void ((live = false), url && URL.revokeObjectURL(url))
  }, [bgFile])
  setBgImage(bgUrl)
  // the theme, painted before the terminals read it (their effects run before ours)
  const paint = paintOf(view?.settings)
  const lessClear = useSyncExternalStore(LESS.on, LESS.now)
  const moreContrast = useSyncExternalStore(MORE.on, MORE.now)
  const sysDark = useSyncExternalStore(SYS_DARK.on, SYS_DARK.now) // B3: a theme that follows the system: painted again, terminals too, as it turns
  const theme = paintKey(paint) + (paint.themeAuto ? ` ${sysDark}` : '') + (lessClear ? ' less' : '') + (moreContrast ? ' more' : '') + (bgUrl ? ` ${bgUrl}` : '') // terminals repaint when it changes
  const painted = useRef<string | null>(null)
  const glassed = useRef('')
  if (view && painted.current !== theme) {
    // the window's own blur, light or dark as the theme is
    const blur = blurred(paint), light = paint.themeAuto ? undefined : !!THEMES.find(t => t.id === paint.theme)?.light // B3: following the system, the blur does too
    const float = paint.design === 'frosted' // the traffic lights inside the floating sidebar
    const side = blur && !paint.glass // V5: macOS's sidebar material, not glass's whole-window one
    if (glassed.current !== `${blur} ${light} ${float} ${side}`) (glassed.current = `${blur} ${light} ${float} ${side}`), bridge?.glass?.(blur, light, float, side)
    painted.current = theme
    applyTheme(paint)
    localStorage.setItem('laki.theme', JSON.stringify(paint))
  }
  userCss(view?.settings.customCss) // Appearance › Custom CSS
  setSendKey(view?.settings.sendKey) // Settings › Keys › Send with: the chats' boxes read it as they draw
  // L7: no https picture straight from the window: an extension's through the daemon's /img, GitHub's avatars by the switch
  imagesVia(view?.imgKey && base !== null ? u => `${base}/img?k=${view.imgKey}&u=${encodeURIComponent(u)}` : undefined)
  showAvatars(view?.settings.avatars !== false)
  setQuiet(!!view?.dnd) // U8: Do not disturb: api.ts notify sends nothing but an important ask's card
  // as it ends: one notification of what its digest card holds (not for a card a restart found waiting)
  useEffect(() => {
    const d = view?.digest
    if (!d?.rows.length || Date.now() - d.until > 60_000) return
    const n = (k: string, one: string) => (c => (c ? [`${c} ${one}`] : []))(d.rows.filter(r => r.kind === k).length)
    notify('Do not disturb is over', [...n('wait', 'waiting for you'), ...n('done', 'finished'), ...n('pr', 'PR moved')].join(', '), '', () => {}, view?.settings.notifySound)
  }, [view?.digest?.until])
  // Settings' Dock icon (unset: the app's own, nothing to send)
  const dockIcon = view?.settings.dockIcon
  useEffect(() => {
    const d = DOCK_ICONS.find(x => x[0] === dockIcon)
    if (d && bridge?.dockIcon) dockPng(d[2]).then(bridge.dockIcon).catch(() => {})
  }, [dockIcon])
  // Settings › Resources' Stop on the video: closed
  useEffect(() => {
    const f = (e: Event) => (e as CustomEvent).detail === 'video' && setVideo(null)
    window.addEventListener('laki-stop', f)
    return () => window.removeEventListener('laki-stop', f)
  }, [])
  // the floating bubbles (Settings › Appearance; main shows them while Laki isn't in front): each workspace whose agent
  // works or waits, the waiting ones first, with what it asked or last said, then the recent ones, in the theme's colors
  const fs = view?.settings
  // a bubble's card says what the sidebar's hover card does: the branch, the agents, the PR, the diff, the ports
  const projWords = (w: WorkspaceView) => (p => (p ? `${emojiOf(p.icon) ? `${emojiOf(p.icon)} ` : ''}${p.name}` : ''))(projOf(w)) // a card's project: its emoji too (ponytail: an icon by name isn't drawn there)
  const floatMore = (w: WorkspaceView) => {
    const pr = w.pr
    return {
      branch: `${w.branch || w.path.split('/').pop()} · $PORT ${w.port}`,
      agents: view!.tabs.filter(t => t.workspace === w.id && t.kind === 'agent').map(t => `${t.name}${t.progress ? ` ${t.progress.pct}%` : ''}`).join(' · '),
      pr: pr && { state: prState(pr), text: `${prNo(pr)} ${pr.title}`, meta: [pr.author && !pr.mine && `by ${pr.author}`, (pr.list?.length || pr.checks) && ciText(pr), pr.review && REVIEW[pr.review], pr.conflict && pr.state === 'OPEN' && 'conflicts'].filter(Boolean).join(' · ') },
      lines: [
        w.stat && (w.stat.add > 0 || w.stat.del > 0 || w.stat.dirty > 0) && `+${w.stat.add} −${w.stat.del} in ${w.stat.files} ${w.stat.files === 1 ? 'file' : 'files'}${w.stat.dirty ? `, ${w.stat.dirty} not committed` : ''}`,
        w.ports.length > 0 && `listening on ${w.ports.map(p => `:${p}`).join(' ')}`,
      ].filter((x): x is string => !!x),
    }
  }
  // the island's cards (floaterAt notch) and the reply window: the agent, since when it needs you, its menu, its last
  // answer and how long its turn took (runs: each tab's last turn start, as the view gave it while it ran)
  for (const t of view?.tabs ?? []) if (t.runAt) turnAt.current[t.id] = t.runAt
  const islandOf = (t: TabView) => ({ agent: t.preset ?? t.name, at: t.needAt, ...(t.status === 'waiting' && t.ask && { ask: t.ask }), ...(t.last && { answer: t.last.slice(0, 2000) }), ...(t.done && t.needAt && turnAt.current[t.id] && { took: t.needAt - turnAt.current[t.id] }) })
  const talkOn = fs?.talkOn === true && fs?.voice?.on !== false && (fs?.voice?.engine === 'cloud' || fs?.voice?.talkEngine === 'mac') // Q2: the talk key: its pill needs the cloud engine, or this Mac's (Laki Speech)
  const atWork = fs?.floater === false && !talkOn ? [] : live.flatMap(w => {
    const ag = view!.tabs.filter(t => t.workspace === w.id && t.kind === 'agent')
    const t = ag.find(t => t.status === 'waiting') ?? ag.find(t => t.status === 'running')
    const last = t && (t.status === 'waiting' ? waits.current.get(t.id) || t.ask?.options.map(o => o.label).join(' / ') : t.last && `Its last turn: ${t.last}`) // working: what it said the turn before
    return t ? [{ tab: t.id, name: wsName(w), project: projWords(w), pid: w.project, ...(t.alias && { alias: t.alias }), status: t.status as 'running' | 'waiting' | 'idle' | 'done', color: tint(w), last: last?.replace(/\s+/g, ' ').trim().slice(0, 300), ...(t.status === 'waiting' && (t.secret || t.planAsk) && { held: true }), ...(t.status === 'waiting' && t.ask?.tool && { perm: { tool: t.ask.tool, what: t.ask.what ?? '' } }), ...islandOf(t), ...floatMore(w) }] : []
  }).sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'))
  // Settings' Recent sessions too: the workspaces whose agent worked last, one bubble each, after the ones at work
  // (finished ones you haven't seen first, then by when; one idle longer than floaterRecentHours drops out)
  const recentN = Math.min(5, Math.max(0, Math.floor(fs?.floaterRecent ?? 3)))
  const recentFor = (fs?.floaterRecentHours ?? 4) * 3600e3
  const staleMin = fs?.staleAfter ?? STALE_AFTER // a finish this many minutes old is stale (isStale): Needs you's Earlier, ⌘J and the bubbles last
  const [, minute] = useState(0)
  useEffect(() => {
    if ((!recentN || !recentFor) && !(staleMin > 0)) return
    const t = setInterval(() => minute(n => n + 1), 60e3) // recent ones age out, and finishes go stale, without a state change
    return () => clearInterval(t)
  }, [recentN, recentFor, staleMin])
  // Finished ones stand out (floaterDone, unset: on): one you haven't seen stays a bubble, green, past recentN and the hours;
  // a stale one (isStale) is an idle one again: no fill, after the fresh ones, recentN and the hours decide
  // drawn as idle; its right click's Seen stays (unseen: main's menu)
  const doneAlert = fs?.floaterDone !== false
  const freshDone = (t: TabView) => t.done && !isStale(t, staleMin)
  const recent = (!recentN && !doneAlert) || (fs?.floater === false && !talkOn) ? [] : live
    .filter(w => !atWork.some(f => view!.tabs.find(t => t.id === f.tab)?.workspace === w.id))
    .flatMap(w => {
      const t = view!.tabs.filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited' && active.current[t.id]).sort((a, b) => active.current[b.id] - active.current[a.id])[0]
      return t && (!recentFor || (doneAlert && freshDone(t)) || Date.now() - active.current[t.id] < recentFor) ? [{ t, w, at: active.current[t.id] }] : []
    })
    .sort((a, b) => Number(freshDone(b.t)) - Number(freshDone(a.t)) || b.at - a.at)
    .filter((x, i) => i < recentN || (doneAlert && freshDone(x.t)))
    .map(({ t, w }) => ({ tab: t.id, name: wsName(w), project: projWords(w), pid: w.project, ...(t.alias && { alias: t.alias }), status: (freshDone(t) ? 'done' : 'idle') as 'idle' | 'done', color: tint(w), last: t.last && `Its last answer: ${t.last.replace(/\s+/g, ' ').trim().slice(0, 300)}`, ...(t.done && { unseen: true }), ...islandOf(t), ...floatMore(w) }))
  const pool = [...atWork, ...recent].slice(0, Math.max(1, fs?.floaterMax ?? 12))
  const floats = fs?.floater === false ? [] : pool // the talk pill's are the same, with the bubbles off too
  const floatColors = useMemo(() => Object.fromEntries(([['bg', '--panel'], ['fg', '--fg'], ['muted', '--muted'], ['line', '--line'], ['running', '--running'], ['waiting', '--waiting'], ['done', '--done'], ['error', '--error'], ['accent', '--accent'], ['font', '--ui-font'], ...TAB_COLORS.map(c => [`tc${c}`, `--tc-${c}`])] as const).map(([k, v]) => [k, css(v)])), [theme]) // as painted just above
  const floatOpts = { style: fs?.floaterStyle ?? 'gradient', cards: fs?.floaterCards !== false, add: fs?.floater !== false && fs?.floaterNew !== false, menu: fs?.floaterMenu === 'card' ? 'card' : 'stack', voiceTo: fs?.floaterVoiceTo === 'new' ? 'new' : 'pick', doneAlert, ai: aiOn(fs), ...(aiOn(fs) && fs?.ai?.show !== false && { aiShow: true }), at: fs?.floaterAt === 'notch' ? 'notch' : 'edge', ...(talkOn && { talk: pool }), ...(talkOn && fs?.talkTo === 'ai' && aiOn(fs) && { talkAi: true }), ...(talkOn && fs?.voice?.talkEngine === 'mac' && { speech: fs.voice.locale || 'en-US' }), ...(talkOn && fs?.voice?.answers === false && { noAnswers: true }), ...(fs?.voice?.route !== false && { route: { projects: (view?.projects ?? []).filter(p => !p.kind).map(p => ({ id: p.id, name: p.name })), aiWord: fs?.voice?.aiWord, fixes: fs?.voice?.fixes } }) } // Q5: Route by first words' names
  const floatKey = JSON.stringify([floats, floatColors, floatOpts])
  const asking = view?.tabs.filter(t => t.status === 'waiting').map(t => t.id).join(' ') // none: not connected, nothing known
  useEffect(() => void (asking !== undefined && bridge?.asking?.(asking ? asking.split(' ') : [])), [asking]) // asks on screen: an answered one's card goes
  useEffect(() => {
    bridge?.floats?.(floats, floatColors, floatOpts)
    const keep = new Set(view?.tabs.map(t => t.id))
    for (const id of Object.keys(active.current)) if (view && !keep.has(id)) delete active.current[id] // closed tabs go
    try {
      localStorage.setItem('laki.active', JSON.stringify(active.current))
    } catch {}
  }, [floatKey])

  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const archived = useRef<string[]>([]) // workspaces archived for a merged PR, while their toast shows
  const archivedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // the sidebar's foot, in one row: its words dropped one by one from the right (data-bare: how many) until it fits;
  // measured as the sidebar resizes and the theme (its font) changes
  const footRef = useRef<HTMLDivElement | null>(null)
  const fit = () => {
    const el = footRef.current
    if (!el) return
    const bs = [...el.querySelectorAll<HTMLElement>(':scope > button')]
    delete el.dataset.wrap
    for (let bare = 0; bare <= bs.length; bare++) {
      bs.forEach((b, i) => b.toggleAttribute('data-bare', i >= bs.length - bare))
      if (el.scrollWidth <= el.clientWidth + 1) return
    }
    el.dataset.wrap = '' // icons alone still too wide (a phone's drawer, every page's button): a second row, none cut off
  }
  const fitFoot = useCallback((el: HTMLDivElement | null) => {
    footRef.current = el
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])
  // err: an error's (V2: the red edge only for those)
  const toast = (text: string, undo?: () => void, label?: string, ok?: boolean, err?: boolean) => {
    clearTimeout(noteTimer.current) // an older toast's timer would cut this one short
    setNote({ text, undo, label, ok, err })
    noteTimer.current = setTimeout(() => setNote(null), undo ? 8000 : 6000)
  }
  const done = (text: string, undo?: () => void) => toast(text, undo, undefined, true) // a success, with a check
  const fail = (e: unknown) => toast((e as Error).message, undefined, undefined, false, true)
  // a picture in a viewer (a terminal link's card and its larger view, the file preview, Changes' zoom, the artifacts'
  // and Laki AI's big views): its right click copies it, unless the viewer has a menu of its own
  useEffect(() => {
    const f = (e: MouseEvent) => {
      const img = e.target instanceof HTMLImageElement && e.target.closest('.lp-img, .lp-big, .art-big, .pv-image, .img-zoom') ? e.target : null
      if (!img || e.defaultPrevented || !img.complete || !img.naturalWidth) return
      e.preventDefault()
      openMenu(new DOMRect(e.clientX, e.clientY - 4, 0, 0), [{ label: 'Copy image', icon: 'copy', run: () => void copyImage(img).then(() => done('Copied the image'), (err: Error) => toast(`Couldn't copy the image: ${err.message}`)) }])
    }
    window.addEventListener('contextmenu', f)
    return () => window.removeEventListener('contextmenu', f)
  }, [])
  const call = useCallback(<T,>(method: string, params: object = {}) => api.call<T>(method, params).catch(e => (fail(e), Promise.reject(e))), [])
  // Done means checked, offered once per project (laki.checkOffered) as a turn ends in one with a test or lint script
  // and no check of its own yet. Above the early return (no view yet): the
  // socket's handler is the first render's, where a const further down is never set
  const offerCheck = (wsId?: string) => {
    const v = viewRef.current
    const w = v?.workspaces.find(x => x.id === wsId)
    const p = v?.projects.find(x => x.id === w?.project)
    const steps = (['lint', 'test'] as const).filter(k => w?.scripts?.includes(k))
    if (!w || !p || !steps.length || p.config?.check || v?.settings.doneCheck === false || load<string[]>('laki.checkOffered', []).includes(p.id)) return
    store('laki.checkOffered', [...load<string[]>('laki.checkOffered', []), p.id])
    toast(`Check ${p.name}'s work before you're told it's done? Its ${steps.join(' and ')} run as you, on what the agent changed, as each turn ends; failures go back to the agent`, () => void call('projectSet', { id: p.id, config: { ...p.config, check: { steps } } }).then(() => done(`${p.name}: checked before you're told (Settings › ${p.name})`), () => {}), 'Turn on')
  }

  // a tab's queue (QueueStrip): the whole list again, with what it was (a delivery meanwhile refuses it)
  const queueSave = (t: TabView, queue: string[], was: string[]) => call('queueSet', { tab: t.id, queue, was }).then(() => true, () => false)
  // one removed (i), or all: Undo puts the list back while nothing else changed it
  const queueRemove = (t: TabView, i?: number) => {
    const was = t.queue ?? []
    const left = i === undefined ? [] : was.filter((_, j) => j !== i)
    void queueSave(t, left, was).then(ok => ok && toast(i === undefined ? `Cleared ${t.name}'s queue` : `Removed from ${t.name}'s queue`, () => void queueSave(t, was, left)))
  }
  // the Layout menu (the tab bar's; Settings › Keys' layout): a split by role (shared/layout.ts fillRoles) from this
  // workspace's tabs, and the side panel as it says. One that needs a Run tab or a shell starts it first, then
  // layoutWait lays it out once it's in the view (10 s at most)
  const roleOf = (t: TabView): Role | undefined => (t.kind === 'agent' ? 'agent' : t.kind === 'dev' ? 'dev' : t.kind === 'shell' ? 'shell' : undefined)
  const roleTabs = (w: WorkspaceView, gs: Layout[]): RoleTab[] => {
    const mine = viewRef.current?.tabs.filter(t => t.workspace === w.id && t.status !== 'exited') ?? []
    return [...new Set([...gs.flatMap(tabsOf), ...mine.map(t => t.id)])].flatMap(id => (t => (t ? [{ id, role: roleOf(t) }] : []))(mine.find(t => t.id === id)))
  }
  const layoutWait = useRef<{ ws: string; tree: RoleLayout; panel?: SavedLayout['panel']; needs: Role; until: number } | null>(null)
  // a layout waiting for its Run tab or shell; a new workspace whose project has a layout for new ones, once its tabs show
  const layoutSeen = useRef<Set<string> | null>(null) // the workspaces there were: theirs stay as they are
  useEffect(() => {
    const v = view
    if (!v) return
    const p = layoutWait.current
    if (p && (Date.now() > p.until || p.ws !== ws?.id)) layoutWait.current = null
    else if (p && ws && roleTabs(ws, groups).some(t => t.role === p.needs)) (layoutWait.current = null), void applyLayout(p.tree, p.panel)
    if (!layoutSeen.current) return void (layoutSeen.current = new Set(v.workspaces.map(w => w.id)))
    for (const w of v.workspaces) {
      if (layoutSeen.current.has(w.id) || w.archived) continue
      const name = v.projects.find(p => p.id === w.project)?.config?.layout
      const l = name ? v.settings.layouts?.find(x => x.name === name) : undefined
      if (!l || narrow) {
        layoutSeen.current.add(w.id)
        continue
      }
      if (!v.tabs.some(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited')) continue // its agent not up yet
      // the shell and Run tab it has a place for: started once, laid out when they're there (15 s at most)
      const at = (layoutNew.current[w.id] ??= { since: Date.now(), asked: new Set() })
      const has = new Set(roleTabs(w, []).map(t => t.role))
      const want = rolesIn(l.tree).filter(r => !has.has(r) && (r === 'shell' || (r === 'dev' && w.run)))
      for (const r of want.filter(r => !at.asked.has(r))) at.asked.add(r), void (r === 'shell' ? call('tabNew', { ws: w.id, preset: 'shell' }) : call('run', { ws: w.id })).catch(() => {})
      if (want.length && Date.now() - at.since < 15000) continue
      layoutSeen.current.add(w.id)
      delete layoutNew.current[w.id]
      const next = fillRoles(l.tree, roleTabs(w, []))
      if (next) setGroupsOf(w.id, next)
    }
  }, [view])
  const layoutNew = useRef<Record<string, { since: number; asked: Set<Role> }>>({})
  // files, an image or text dropped on a workspace's row (or its rail pin): to its agent, the one focused there, else its
  // first live one, else a new one (its last agent's profile, else the default); queued while it works (Undo takes it
  // back off the queue); with ⌥, a box first to add a line. Terminals', Browsers' and archived rows take none
  const [dropOn, setDropOn] = useState<string | null>(null)
  const dropAgent = (w: WorkspaceView) => (ts => ts.find(t => t.id === tabByWs[w.id]) ?? ts[0])((viewRef.current?.tabs ?? []).filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited'))
  const takesDrop = (w: WorkspaceView, e: React.DragEvent) => !w.archived && !isTerm(w) && !projOf(w)?.kind && w.browser === undefined && ['Files', 'text/plain'].some(k => e.dataTransfer.types.includes(k))
  const dropProps = (w: WorkspaceView) => ({
    onDragOver: (e: React.DragEvent) => takesDrop(w, e) && (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy'), dropOn !== w.id && setDropOn(w.id)),
    onDragLeave: (e: React.DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropOn(d => (d === w.id ? null : d)),
    onDrop: (e: React.DragEvent) => {
      setDropOn(null)
      if (!takesDrop(w, e)) return
      e.preventDefault() // the window's own drop (a folder: a project) leaves it
      void dropTo(w, [...e.dataTransfer.items].flatMap(i => (i.kind === 'file' ? [{ f: i.getAsFile(), dir: !!i.webkitGetAsEntry?.()?.isDirectory }] : [])), e.dataTransfer.files.length ? '' : e.dataTransfer.getData('text/plain'), e.altKey)
    },
  })
  const dropTo = async (w: WorkspaceView, files: { f: File | null; dir: boolean }[], text: string, more: boolean) => {
    // its agent starts later: a new one now would make two
    if (w.pending && !dropAgent(w)) return toast(`${wsName(w)}'s ${w.pending.agent} ${pendingWords(w.pending).replace(/^S/, 's')}: Start now first (its menu), then drop it again`)
    const paths: string[] = []
    for (const { f, dir } of files) {
      if (!f) continue
      if (dir) {
        const p = bridge?.pathOf?.(f) // a folder: its path, never read
        if (p) paths.push(p)
        else toast(`${f.name}: a folder goes in by its path, in the app only`)
        continue
      }
      try {
        paths.push((await keepFile(f, (data, ext) => api.call<string>('imageSave', { data, ext }), (data, name) => api.call<string>('fileSave', { data, name }))).path)
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}, not sent`)
      }
    }
    let msg = withPaths(text, paths)
    if (!msg.trim()) return
    const agent = dropAgent(w)
    const names = files.map(x => x.f?.name).filter(Boolean).join(', ') || clip(text, 40)
    if (more) {
      const t = await askText(`To ${wsName(w)}${agent ? ` · ${agent.name}` : ''}`, { text: 'Add a line if you like: it goes before the paths.', value: msg, multi: true, ok: 'Send' })
      if (!t?.trim()) return
      msg = t
    }
    if (!agent) {
      const last = viewRef.current?.tabs.filter(t => t.workspace === w.id && t.kind === 'agent').at(-1)
      const t = await call<TabView>('tabNew', { ws: w.id, preset: last?.profile ?? last?.preset ?? settings.agent ?? 'claude', prompt: msg }).catch(() => null)
      return t && done(`Started ${t.name} in ${wsName(w)} with ${names}`)
    }
    const r = await call<{ queued?: number }>('send', { target: agent.id, text: msg, whenIdle: true }).catch(() => null)
    if (!r) return
    const where = `${wsName(w)} · ${agent.name}`
    if (!r.queued) return done(`Sent ${names} to ${where}`)
    toast(`Sent ${names} to ${where}: queued until it's free`, () => {
      const was = viewRef.current?.tabs.find(t => t.id === agent.id)?.queue ?? []
      const i = was.lastIndexOf(msg)
      if (i < 0) return toast('Already sent: it was free')
      void queueSave(agent, was.filter((_, j) => j !== i), was)
    })
  }
  // a session by id, or one just created (its view may not have arrived yet)
  const selectTab = useCallback((ref: string | { id: string; workspace: string }) => {
    const t = typeof ref === 'string' ? viewRef.current?.tabs.find(t => t.id === ref) : ref
    if (!t) return
    mru.current = [t.id, ...mru.current.filter(x => x !== t.id)].slice(0, 200)
    setWsId(t.workspace)
    setTabByWs(m => ({ ...m, [t.workspace]: t.id }))
    setReviewing(m => (m[t.workspace] ? { ...m, [t.workspace]: false } : m))
  }, [])
  const selectGroup = (g: Layout) => selectTab(mru.current.find(id => tabsOf(g).includes(id)) ?? tabsOf(g)[0])
  // narrow shows them flat: kept as they were. To the daemon a moment later (a divider's drag is many)
  const setGroups = (next: Layout[]) => ws && !narrow && setGroupsOf(ws.id, next)
  const setGroupsOf = (id: string, next: Layout[]) => {
    setStored(m => ({ ...m, [id]: next }))
    if (!layoutsOn) return
    clearTimeout(pushes.current[id] as ReturnType<typeof setTimeout>)
    pushes.current[id] = setTimeout(() => {
      pushes.current[id] = true
      call('layoutSet', { ws: id, groups: next })
        .catch(() => {})
        .finally(() => pushes.current[id] === true && delete pushes.current[id])
    }, 250)
  }

  // the daemon connection
  const widgetSay = useRef<WidgetApi['say']>(undefined) // an extension's event handler's toast or dialog (widget-say)
  const [extModal, setExtModal] = useState<{ wid: string; ws?: string; m: SayModal; n: number } | null>(null) // an extension's own dialog (WidgetModal); n: its key, kept by a say with its id
  const extN = useRef(0)
  const toolAsk = useRef<(m: Msg) => void>(undefined) // an agent wants to run an extension's tool
  const earlyAsks = useRef<Msg[]>([]) // ones that came before the view: asked once it's drawn (widgetAsks, as a window opens)
  useEffect(() => void (toolAsk.current && earlyAsks.current.splice(0).forEach(m => toolAsk.current!(m))))
  useEffect(() => {
    const off = api.on(m => {
      if (m.ev === 'state') {
        setLocked(null) // D6: unlocked (its state comes only then)
        const v = veiled(m.view) // Recording mode: private workspaces out of everything drawn
        hid.current = v === m.view ? new Set() : new Set(m.view.workspaces.filter((w: WorkspaceView) => !v.workspaces.includes(w)).map((w: WorkspaceView) => w.id))
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
      else if (m.ev === 'toolAsk' || m.ev === 'termAsk') toolAsk.current ? toolAsk.current(m) : earlyAsks.current.push(m)
      else if (m.ev === 'toolDone' || m.ev === 'termDone') (earlyAsks.current = earlyAsks.current.filter(x => x.req !== m.req)), toolLine.drop(m.req) && toolOn === m.req && unchoose(m.req) // answered elsewhere: out of line
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
      }
      else if (m.ev === 'close') setConnected(false)
      else if (m.ev === 'turn') {
        if (m.kind === 'waiting') waits.current.set(m.tab, m.text ?? '')
        // a wait a moment later, with its menu (often drawn after the hook), unless it's over by then
        const post = () => {
          const t = viewRef.current?.tabs.find(t => t.id === m.tab)
          const shown = document.hasFocus() && shownTabs.current.includes(m.tab)
          const s = viewRef.current?.settings
          const w = viewRef.current?.workspaces.find(w => w.id === t?.workspace)
          if (!t || shown || s?.notify === false || s?.notifyOn?.[m.kind as NotifyKind] === false || t.muted || w?.muted || (m.kind === 'waiting' && t.status !== 'waiting')) return
          const perm = m.kind === 'waiting' && t.ask?.tool ? t.ask : undefined // claude's permission ask: what it wants to do
          const body = perm ? `${perm.what ?? ''}${perm.diff ? (c => ` (+${c.add} −${c.del})`)(diffCounts(perm.diff)) : ''}` : m.kind === 'waiting' ? `needs you${m.text ? `: ${m.text}` : ''}` : m.kind === 'limit' ? 'hit a usage limit' : m.text || 'finished'
          // a button per choice of its menu (its "don't ask again" one as Always: <rule>); a permission prompt whose menu
          // wasn't read: Allow and Deny, its first and last
          // one that doesn't fit is cut with … and gets none, as one with a bidi or invisible character (noteWhole), or a
          // permission ask whose command says nothing: a Yes would approve a command you can't see whole (its click shows
          // it in the tab)
          const always = perm?.rule ? alwaysOf(perm) : undefined
          const cut = !noteWhole(body) || (!!perm && !perm.what?.trim())
          const actions: NotifyAction[] | undefined =
            m.kind !== 'waiting' || cut ? undefined : t.ask ? t.ask.options.map(o => ({ text: o === always ? `Always: ${perm!.rule}` : `${o.n}. ${o.label}`, n: o.n, label: o.label })) : /permission/i.test(m.text ?? '') ? [{ text: 'Allow', pick: 'first' }, { text: 'Deny', pick: 'last' }] : [{ text: 'Reply', reply: true }] // U15: a free-text question: a Reply field
          const card = !w?.important ? undefined : m.kind === 'waiting' ? { ask: true, ...(perm?.diff && { diff: perm.diff }) } : { tone: m.kind === 'limit' ? ('bad' as const) : ('ok' as const) } // an important workspace's: a card on screen (main's addCard)
          notify(`${w ? wsName(w) : t.workspace} · ${t.name}${perm ? ` ${permVerb(perm.tool!)}` : ''}`, noteCut(body), t.id, () => selectTab(t.id), s?.notifySound, actions, card)
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
        if (!t || m.status === 'failed' || s?.notify === false || t.muted || w?.muted) return
        if (m.status !== 'over' && (s?.notifyOn?.done === false || (document.hasFocus() && shownTabs.current.includes(m.tab)))) return
        const body = m.status === 'skipped' ? t.last || 'finished' : m.status === 'passed' ? `done and checked: ${m.text}` : `over to you: ${m.text}`
        notify(`${w ? wsName(w) : t.workspace} · ${t.name}`, noteCut(String(body)), t.id, () => selectTab(t.id), s?.notifySound, undefined, w?.important ? { tone: m.status === 'over' ? 'bad' : 'ok' } : undefined)
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
    bridge?.onFocusTab((id, panel) => (setDialog(null), selectTab(id), panel === 'changes' && showPanel('changes'), (w => w && setReveal(r => [...r, w]))(viewRef.current?.tabs.find(t => t.id === id)?.workspace), (scrolledTo.current = null), setScrollAsk(n => n + 1)))
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
  }, [selectTab])

  // laki:// links select and fill in; nothing starts from one
  useEffect(() => {
    if (!link || !view) return
    setLink(undefined)
    const l = parseLink(link)
    const proj = (id?: string) => view.projects.find(p => p.id === id || p.name === id)?.id
    if (l?.to === 'ws') {
      // by id, else by name (a model may write the name): a live one first
      const w = view.workspaces.find(w => w.id === l.ws) ?? [...view.workspaces].sort((a, b) => +!!a.archived - +!!b.archived).find(w => (w.name || w.id) === l.ws || wsName(w) === l.ws) // its own name (MCP's) or the one shown
      const t = view.tabs.find(t => t.id === l.tab && t.workspace === w?.id)
      if (!w) toast(`No workspace ${l.ws}`)
      else if (w.archived) toast(`${wsName(w)} is archived`)
      else {
        setDialog(null)
        t ? selectTab(t) : setWsId(w.id)
      }
    } else if (l?.to === 'new') {
      if (!view.projects.length) return toast('Add a project first (⌘O)')
      if (l.project && !proj(l.project)) toast(`No project ${l.project}: pick one`)
      setNewFor(proj(l.project))
      setNewInit({ prompt: l.prompt, name: l.name, ...(l.prompt && { linked: true }) })
      setDialog('new')
    } else if (l?.to === 'schedules') setDialog({ schedules: proj(l.project) ?? '' })
    else if (l?.to === 'settings') setDialog(l.section && isSection(l.section) ? { section: l.section, ...(l.spot && { spot: l.spot }) } : 'settings')
    else if (l?.to === 'studio') setDialog({ extension: l.id, back: { section: 'widgets' } })
    else if (l?.to === 'extension') view.widgets?.some(w => w.id === l.id) ? setDialog({ extension: l.id, back: { section: 'widgets' }, ...(l.inspect && { tab: 'data' as const }) }) : toast(`No extension ${l.id}`)
    else if (l?.to === 'help') setDialog('help')
    else if (l?.to === 'board') setDialog('board')
    else if (l?.to === 'achievements') setDialog('achievements')
    else if (l?.to === 'ai') setDialog('ai')
    else if (l?.to === 'about') setDialog('about')
    else if (l?.to === 'onboard') (setOnboard(o => ({ ...o, off: false })), setDialog('onboard'))
    else if (l?.to === 'desk') settings.desk !== false ? setDialog('desk') : toast('My Desk is off: Settings › General › Pages')
    else if (l?.to === 'uikit') setDialog({ uikit: true, ...(l.icons && { icons: true }) })
    else if (l?.to === 'starters') setDialog('starters')
    else toast(`Laki can't open ${link.slice(0, 80)}`)
  }, [link, view])

  // tell the daemon what's on screen: it clears ● there and doesn't set it
  const current = useRef<string | null>(null)
  current.current = tab?.id ?? null
  const shownTabs = useRef<string[]>([])
  shownTabs.current = visible
  // the workspace whose per-workspace extensions show (scope workspace: Widgets.tsx inWs), and fetch: none under a page
  // over every workspace (Board, Schedule, the AI page…), nor a terminal's, a browser's or one on an SSH host; the Desk's
  // tiles: the one selected last (laki.ws), named on each
  const covered = schedulesOf(dialog) !== undefined || dialog === 'board' || dialog === 'achievements' || dialog === 'calendar' || dialog === 'ai' || !!specsOf(dialog) || !!flowsOf(dialog)
  const wsHere = !covered && ws && !ws.archived && !ws.host && !project?.kind ? ws.id : null
  useEffect(() => reportView(() => ({ tab: current.current, tabs: shownTabs.current, browse: !!bridge?.browse, ws: wsHere })), [tab?.id, visible.join(), wsHere])

  // a folder dropped on the window becomes a project (git or not), then a new workspace in it
  useEffect(() => {
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    // a drop target inside (the prompt's images) prevents the default: not a folder for us then
    const over = (e: DragEvent) => {
      if (!files(e)) return
      setDropping(!e.defaultPrevented)
      e.preventDefault()
    }
    const leave = (e: DragEvent) => !e.relatedTarget && setDropping(false)
    const drop = async (e: DragEvent) => {
      setDropping(false)
      if (!files(e) || e.defaultPrevented) return
      e.preventDefault()
      if (!bridge?.pathOf) return fail(new Error('Drop folders on the app window'))
      void addFolders([...e.dataTransfer!.files].map(f => bridge!.pathOf!(f)))
    }
    // each a project (one already: that one), then the new-workspace page for the last; a drop on the window or the Dock icon
    const addFolders = async (paths: string[]) => {
      let last: Project | null = null
      for (const path of paths) last = (await call<Project>('projectAdd', { path }).catch(() => null)) ?? last // call says why
      if (last) {
        setNewFor(last.id)
        setDialog('new')
      }
    }
    const unFolders = bridge?.onFolders?.(paths => void addFolders(paths))
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      unFolders?.()
    }
  }, [call])

  // panes: a pane (or a whole tab) dropped beside or onto another pane, or into the tab bar; only where that
  // changes something
  const { drag, start } = useTabDrag(
    (id, whole, over) => {
      setGroups(move(groups, id, whole, over))
      selectTab(id)
      requestAnimationFrame(() => xterms.get(id)?.focus()) // the keyboard goes with it
    },
    (id, whole, over) => JSON.stringify(move(groups, id, whole, over)) !== JSON.stringify(groups), // a split where it is too
  )

  // a new shell from a shell: in the folder that one is in now (cwdOf), as a terminal's new tab does
  const cwdOf = (w: WorkspaceView | null, from = tab) => (from?.kind === 'shell' && from.workspace === w?.id ? { cwdOf: from.id } : undefined)
  // own: a tab of its own whatever Settings' splitNew says (⌘ held as the + menu's item was picked)
  const newTab = async (preset: string, cmd?: string, w: WorkspaceView | null = ws, own = false) => w && selectTab(await call<TabView>('tabNew', { ws: w.id, preset, cmd, ...(preset === 'shell' && !cmd && cwdOf(w)), ...(own && { beside: null }) }))
  // a new shell next to the focused pane
  const split = async (edge: 'right' | 'bottom', next = tab?.id) => {
    if (!ws || !next) return
    const t = await call<TabView>('tabNew', { ws: ws.id, preset: 'shell', beside: next, edge, ...cwdOf(ws, byId(next)) }) // the daemon puts it there
    if (!layoutsOn) setGroups(move([...groups, { tab: t.id }], t.id, false, { pane: next, edge }))
    selectTab(t)
  }

  const closeTabs = async (ts: TabView[]) => {
    const running = ts.filter(t => t.status !== 'exited')
    if (running.length && !settings.closeNoAsk && !(await ask(`Close ${ts.map(t => t.name).join(', ')}?`, { text: `${running.length > 1 ? 'Their processes' : 'Its process'} will be stopped.`, ok: 'Close', danger: true }))) return
    for (const t of ts) await flushDraft(t.id), await call('tabClose', { id: t.id })
    if (ts.length === 1 && (ts[0].kind === 'agent' || ts[0].kind === 'shell') && kb.reopenTab) toast(`Closed ${ts[0].name} · ${keyShow(kb.reopenTab)} brings it back`)
  }
  // ⇧⌘T, the + menu's Recently closed: a tab you closed back in its workspace, its chat resumed (the newest, or index's)
  // U8: Stop all agents (⌘K, the File menu, a key of yours): the turns under way named, asked once, then each gets Esc
  const stopAllAsk = async () => {
    const v = viewRef.current
    const at = v?.tabs.filter(t => t.kind === 'agent' && t.status === 'running') ?? []
    if (!at.length) return toast('No agent is at work')
    const names = at.map(t => `${v!.workspaces.find(w => w.id === t.workspace)?.name ?? t.workspace} · ${t.name}`)
    if (!(await ask(`Stop ${at.length === 1 ? 'the agent' : `all ${at.length} agents`} at work?`, { text: `${names.slice(0, 8).join(', ')}${names.length > 8 ? ` and ${names.length - 8} more` : ''}. Each gets its interrupt key (Esc): nothing is closed, its chat stays. What's queued for one waits for its Resume queue.`, ok: 'Stop all', danger: true }))) return
    const r = await call<{ stopped: string[] }>('stopAll', {}).catch(() => undefined) // call's toast said why
    if (r) toast(`Stopped ${r.stopped.length} of ${at.length}`)
  }
  // F8: the status bar's ↓n: the base merged in (clean), or its agent asked to (conflicts); a rebase asks first when the
  // branch is pushed (a force push would follow, yours to do)
  const behindMenu = (w: WorkspaceView): MenuItem[] => [
    { head: `${w.stat?.behind} behind ${w.base}` },
    { label: w.stat?.clean !== false ? `Update: merge ${w.base} in` : `Update: ask the agent to merge ${w.base} in (conflicts)`, icon: 'gitCompare', run: () => void call<{ merged?: boolean; told?: boolean }>('wsUpdate', { ws: w.id }).then(r => toast(r.merged ? `Merged ${w.base} in` : 'Its agent merges it in and resolves the conflicts')).catch(() => {}) },
    {
      label: `Rebase onto ${w.base}…`,
      icon: 'fork',
      run: async () => {
        if (w.pr && !(await ask(`Rebase ${w.branch}?`, { text: `It has a PR (#${w.pr.number}): after a rebase the branch needs a force push, which Laki never does for you.`, ok: 'Rebase' }))) return
        await call('wsUpdate', { ws: w.id, how: 'rebase' }).then(() => toast(`Rebased onto ${w.base}`)).catch(() => {})
      },
    },
  ]
  const reopenTab = async (w = ws, index?: number) => {
    if (!w) return
    if (!w.closed?.length) return toast('No closed tab to bring back here')
    const t = await call<TabView & { fresh?: boolean }>('tabReopen', { ws: w.id, ...(index !== undefined && { index }) }).catch(fail)
    if (!t) return
    if (t.fresh) toast(`${t.name}: its chat is gone, so it starts a new one`)
    selectTab(t)
  }

  // ⌘↑ ⌘↓: the rows in sight, not those a folded project or group hides
  const wsAt = (d: number) => {
    const seen = order.filter(w => (w.id === ws?.id || !foldedAway(w)) && (!rail || kindOf(w) === railKind)) // the rail's: its list's
    if (!seen.length) return
    const i = Math.max(0, seen.findIndex(w => w.id === ws?.id))
    return seen[(i + d + seen.length) % seen.length]
  }
  const moveWs = (d: number) => (w => w && setWsId(w.id))(wsAt(d))
  const foldedAway = (w: WorkspaceView) => {
    const p = view?.projects.find(p => p.id === w.project)
    if (w.pinned || !p || find) return false // filtering: the hits show, folded or not
    if (folded.includes(p.id)) return true
    let under = false // a folded sep above it
    for (const x of rowsOf(p, live)) if (!('path' in x)) under = folded.includes(x.id)
      else if (x.id === w.id) return under
    return false
  }

  // while f runs, the rows of ids say what's happening (archiving, deleting: a worktree takes a moment to go)
  const [checking, setChecking] = useState<string>() // `<step>:<ws>`: its gates run (gated)
  const busyWith = async <T,>(ids: string[], what: string, f: () => Promise<T>) => {
    setGoing(g => ({ ...g, ...Object.fromEntries(ids.map(id => [id, what])) }))
    try {
      return await f()
    } finally {
      setGoing(g => Object.fromEntries(Object.entries(g).filter(([id]) => !ids.includes(id))))
    }
  }
  // what Delete takes with it, said first, a line each: where it is, uncommitted files, commits not pushed, its PR, agents
  // at work, servers, the storage folder's files; the daemon's git counts (wsPeek) are waited for 1.5 s at most
  type Peek = { dirty?: number; ahead?: number; unpushed?: number; subs?: string[]; ignored?: string[]; files?: string[] }
  // and what git status doesn't count (the daemon's `unsaved`): uncommitted work inside a submodule, ignored files your
  // checkout hasn't got the same. Archive's second question (wsArchive's { dirty }) lists them too
  const few = (a: string[]) => `${a.slice(0, 3).join(', ')}${a.length > 3 ? ` and ${a.length - 3} more` : ''}`
  const peekFacts = (pk: Peek, kept = false): Fact[] => [
    ...(pk.subs ? [{ label: 'Submodules', icon: 'gitBranch', tone: kept ? 'warn' : 'bad', value: `${few(pk.subs)}: uncommitted work, ${kept ? 'kept in the stopped codespace' : 'lost'}` } as Fact] : []),
    ...(pk.ignored ? [{ label: 'Ignored files', icon: 'files', tone: kept ? 'warn' : 'bad', value: `${few(pk.ignored)}: not in your checkout, ${kept ? 'kept in the stopped codespace' : 'lost'}` } as Fact] : []),
  ]
  const peekWs = async (w: WorkspaceView): Promise<Peek> => (hasCap(view, 'ws.peek') ? await Promise.race([api.call<Peek>('wsPeek', { id: w.id }).catch(() => ({})), new Promise<Peek>(r => setTimeout(() => r({}), 1500))]) : {})
  // archive: the same, but the storage folder stays (archive keeps it), and a codespace is stopped, its files kept.
  // Each line's icon is tinted by what it means for you (green: nothing lost, amber: mind it, red: lost), the PR's state
  // is a pill, and the verdict over them sums it up: Safe to delete (merged, or nothing of its own), else what to check
  const rmFacts = async (w: WorkspaceView, archive = false, pk?: Peek): Promise<{ facts: Fact[]; verdict?: Verdict }> => {
    pk ??= await peekWs(w)
    const cs = w.codespace !== undefined
    const stops = archive && cs // what's in it stays
    const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
    const tabs = view?.tabs.filter(t => t.workspace === w.id && t.status !== 'exited') ?? []
    const busy = tabs.filter(t => t.kind === 'agent' && (t.status === 'running' || t.status === 'waiting'))
    const pr = w.pr
    const merged = pr?.state === 'MERGED'
    const open = !!pr && !merged && pr.state !== 'CLOSED'
    const keptArts = archive || !!view?.settings?.keepStorage
    const facts: Fact[] = [{ label: 'Project', icon: 'folder', value: view?.projects.find(p => p.id === w.project)?.name ?? '' }]
    if (w.kind === 'worktree') facts.push({ label: 'Branch', icon: 'gitBranch', value: `${w.branch} → ${w.base} (${cs && !stops ? 'only what was pushed stays' : 'stays'})` })
    facts.push(cs ? { label: 'Codespace', icon: 'cloud', value: `${w.codespace || '(being made)'}: ${stops ? 'stopped, its files kept' : 'deleted on GitHub'}` } : { label: 'Folder', icon: 'folderOpen', value: `${w.host ? `${w.host}:` : ''}${shortPath(w.path)}${w.kind === 'worktree' ? ' (removed)' : ' (stays)'}` })
    if (pk.dirty !== undefined) facts.push({ label: 'Changes', icon: 'changes', tone: pk.dirty ? (stops ? 'warn' : 'bad') : 'ok', value: pk.dirty ? `${n(pk.dirty, 'uncommitted file')}${pk.files?.length ? ` (${few(pk.files)})` : ''}: ${stops ? 'kept in the stopped codespace' : 'lost'}` : 'none uncommitted' })
    facts.push(...peekFacts(pk, stops))
    if (pk.ahead) facts.push({ label: 'Commits', icon: 'gitCommit', tone: pk.unpushed ? 'warn' : 'ok', value: `${n(pk.ahead, 'commit')} not in ${w.base}${pk.unpushed ? `, ${pk.unpushed} not pushed` : ', all pushed'} (on the branch)` })
    if (pr) facts.push({ label: pr.forge === 'gitlab' ? 'MR' : 'PR', icon: merged ? 'gitMerge' : 'pr', pr: prState(pr), chip: merged ? 'Merged' : pr.draft && open ? 'Draft' : open ? 'Open' : 'Closed', value: `${prNo(pr)}${pr.title ? ` · ${pr.title}` : ''} (stays on ${forgeName(pr)})` })
    if (pr?.author) facts.push({ label: 'Author', icon: 'user', value: `${pr.author}${pr.mine ? ' (you)' : ''}` })
    facts.push({ label: 'Tabs', icon: 'terminal', tone: busy.length ? 'warn' : undefined, value: tabs.length ? `${n(tabs.length, 'tab')}${busy.length ? `, ${busy.length} agent${busy.length === 1 ? '' : 's'} at work: stopped` : ''}` : 'none' })
    if (w.ports.length) facts.push({ label: 'Servers', icon: 'server', value: `${w.ports.map(p => `:${p}`).join(', ')}: stopped` })
    if (w.artifacts) facts.push({ label: 'Artifacts', icon: 'files', tone: keptArts ? undefined : 'warn', value: `${n(w.artifacts, 'file')}${keptArts ? ' (kept)' : ': deleted'}` })
    facts.push({ label: 'Created', icon: 'clock', value: ago(w.created) })
    const verdict = rmVerdict({ archive, kept: archive && !w.host && w.codespace === undefined, cs: stops, worktree: w.kind === 'worktree', dirty: pk.dirty, subs: pk.subs?.length, ignored: pk.ignored?.length, ahead: pk.ahead, unpushed: pk.unpushed, lost: !stops, pr, busy: busy.length, artifacts: w.artifacts ?? 0, keptArts })
    return { facts, verdict }
  }
  const rmWs = async (w: WorkspaceView) => {
    if (!(await ask(`Delete ${wsName(w)}?`, { text: `Its tabs stop${w.kind === 'worktree' ? ', the worktree is removed (the branch stays)' : ''}.`, ...(await rmFacts(w)), ok: 'Delete', danger: true }))) return
    if (!(await busyWith([w.id], 'deleting', () => call('wsRm', { id: w.id }).then(() => true, () => false)))) return // the toast says why
    done(`Deleted ${wsName(w)}${w.kind === 'worktree' && w.branch ? `: its branch ${w.branch} stays` : ''}`)
  }
  // a terminal closes as a tab does: asked only while something runs in it (an agent, a command, a server) or it keeps artifacts
  const closeTerm = async (w: WorkspaceView) => {
    const busy = w.ports.length > 0 || (!!w.artifacts && !view?.settings?.keepStorage) || (view?.tabs ?? []).some(t => t.workspace === w.id && t.status !== 'exited' && (t.kind === 'agent' || t.status === 'running' || !!t.runs))
    if (busy && !(await ask(`Close ${wsName(w)}?`, { text: 'What runs in it stops.', ...(await rmFacts(w)), ok: 'Close', danger: true }))) return
    if (!(await busyWith([w.id], 'closing', () => call('wsRm', { id: w.id }).then(() => true, () => false)))) return
    done(`Closed ${wsName(w)}`)
  }
  const rmItem = (w: WorkspaceView): MenuItem => (isTerm(w) ? { label: 'Close terminal', icon: 'x', key: 'x', danger: true, tip: 'Ends its shells and removes it', run: () => closeTerm(w) } : { label: 'Delete workspace', icon: 'trash', key: 'd', danger: true, tip: w.kind === 'worktree' ? 'Removes it and its worktree; its branch stays' : 'Removes it from Laki; its folder stays', run: () => rmWs(w) })
  // an extension's gates on a ship, a merge or an archive: Checking… on its button while they run (checking: the step and
  // workspace; an archive's row says it, busyWith); a hold says what held it, each by its icon, then Do it anyway (asked
  // first) or the agent's fix, shown to change first. f(force) makes the call; undefined: failed (the toast says), or not done
  const gatesOn = (step: Gate, w?: WorkspaceView) => (view?.widgets ?? []).some(x => x.on && x.gates?.includes(step) && (!x.project || x.project === w?.project)) // a repo's: its project's only
  const gated = async <T,>(w: WorkspaceView, step: Gate, f: (force?: boolean) => Promise<T>): Promise<T | undefined> => {
    const key = `${step}:${w.id}`
    const on = gatesOn(step, w)
    if (on) setChecking(key)
    const r = await f().finally(() => on && setChecking(c => (c === key ? undefined : c)))
    const held = (r as { held?: GateHeld[] } | null | undefined)?.held
    if (!held) return r
    const fix = held.flatMap(h => (h.fix ? [h.fix] : [])).join('\n\n')
    const agent = !!fix && (view?.tabs ?? []).some(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited')
    const words = { ship: 'shipped', merge: 'merged', archive: 'archived', tool: 'run' }[step]
    const n = await choose(`Not ${words}`, undefined, [{ label: 'Cancel' }, ...(agent ? [{ label: 'Ask the agent to fix it', primary: true }] : []), { label: 'Do it anyway', danger: true }], undefined, undefined, held.map(h => ({ icon: h.icon, label: h.name, value: h.why })))
    if (agent && n === 1) {
      const text = await askText('Ask the agent to fix it', { text: `To ${wsName(w)}'s agent, once it's free. Change it as you like.`, value: fix, multi: true, ok: 'Send' })
      return void (text?.trim() && call('send', { target: w.id, text, whenIdle: true }).then(() => toast('Sent to the agent'), () => {}))
    }
    if (n !== (agent ? 2 : 1)) return
    if (!(await ask(`${{ ship: 'Ship', merge: 'Merge', archive: 'Archive', tool: 'Run' }[step]} ${wsName(w)} anyway?`, { text: `Past what ${held.map(h => h.name).join(', ')} said.`, ok: 'Do it anyway', danger: true }))) return
    return f(true)
  }
  // archive: asked first, with what goes (its uncommitted changes, with the worktree) and what stays; Undo brings it
  // back. One that changed since it was asked is asked again. asked: the caller asked already (several at once)
  const archive = async (w: WorkspaceView, asked = false) => {
    const old = !hasCap(view, 'archive.dirty') // its daemon archives whatever is there
    const pk: Peek = asked ? {} : await peekWs(w)
    const cs = w.codespace !== undefined // its codespace stops, its files stay
    const loses = !!(pk.dirty || pk.subs || pk.ignored)
    if (!asked && !(await ask(`Archive ${wsName(w)}?`, { text: cs ? "Its tabs stop and its codespace stops; its files stay until GitHub deletes a stopped codespace (after 30 days by default). Restore it from the project's menu." : `Its tabs stop and the worktree is removed${loses ? ', with what is only in it' : ''}; the branch stays. Restore it from the project's menu.`, ...(await rmFacts(w, true, pk)), ok: 'Archive', danger: loses && !cs }))) return
    let forced = false
    const go = (ifClean: boolean) => (force?: boolean) => busyWith([w.id], gatesOn('archive', w) && !(forced ||= !!force) ? 'checking' : 'archiving', () => call<Peek & { held?: GateHeld[] } | null>('wsArchive', { id: w.id, ifClean, force: forced }).catch(() => undefined))
    const r: (Peek & { held?: GateHeld[] }) | null | undefined = old && asked ? { dirty: -1 } : await gated(w, 'archive', go(!old && !loses)) // what it was asked about goes
    if (r === undefined) return // the toast says why, or it wasn't done
    if (r?.dirty) {
      const k = r.dirty - (r.subs?.length ?? 0) - (r.ignored?.length ?? 0) // wsArchive's count is all of them
      const lost = k > 0 ? `${k} uncommitted ${k === 1 ? 'change goes' : 'changes go'} with the worktree` : r.dirty > 0 ? 'what is only in the worktree goes with it' : 'the worktree is removed'
      if (!(await ask(`Archive ${wsName(w)}?`, { text: `Its tabs stop and ${lost} (the branch stays).`, facts: peekFacts(r), ok: 'Archive', danger: true }))) return
      if ((await gated(w, 'archive', go(false))) === undefined) return
    }
    done(`Archived ${wsName(w)}`, () => restore(w.id))
  }
  useEffect(() => {
    if (!picked.length) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && !dialog && !document.querySelector('.menu, .overlay') /* a menu's or an ask's Esc is theirs */ && (e.preventDefault(), e.stopPropagation(), setPicked([]))
    window.addEventListener('keydown', f, true) // before the terminal: Esc here isn't the agent's
    return () => window.removeEventListener('keydown', f, true)
  }, [picked.length > 0, !!dialog])
  useEffect(() => setPicked(p => (p.some(id => !live.some(w => w.id === id)) ? p.filter(id => live.some(w => w.id === id)) : p)), [live]) // archived or deleted meanwhile
  // a Browsers page closes (⌘W) as a browser's tab does: no question, the next one of its project selected, Undo opens it again
  const closePage = async (w: WorkspaceView) => {
    if (going[w.id]) return // a held ⌘W: it's on its way
    const i = order.findIndex(x => x.id === w.id)
    const next = order.slice(i + 1).find(x => x.project === w.project) ?? order.slice(0, Math.max(0, i)).reverse().find(x => x.project === w.project)
    if (!(await busyWith([w.id], 'closing', () => call('wsRm', { id: w.id }).then(() => true, () => false)))) return
    if (next) setReveal(r => [...r, next.id]), setWsId(next.id) // in a folded group: it opens
    // ponytail: Undo opens its address again, not its pin, color, group or name (wsRm forgets them)
    done(`Closed ${wsName(w)}`, () => quickNew('browsers', w.browser || undefined))
  }
  const statText = (w: WorkspaceView) => w.stat && `+${w.stat.add} −${w.stat.del} in ${w.stat.files} ${w.stat.files === 1 ? 'file' : 'files'} against ${w.kind === 'worktree' ? w.base : 'the last commit'}${w.stat.dirty ? `, ${w.stat.dirty} not committed` : ''}`
  const markUnread = (id: string) => call('unread', { tab: id }).catch(() => {})
  // claude's and codex's accounts by name (Settings › Agents & profiles): the agent's own sign-in first
  const accountsOf = (agent?: string) => (isAccountAgent(agent) ? [{ id: HOME_ACCOUNT, name: 'Default sign-in' }, ...(view?.settings.accounts ?? []).filter(a => a.agent === agent)] : [])
  const showNew = (id: string, ...more: string[]) => (setReveal(r => [...r, ...(wsId ? [wsId] : []), id, ...more]), setWsId(id))
  const forkWs = (w: WorkspaceView) => call<WorkspaceView>('wsFork', { id: w.id }).then(x => showNew(x.id), () => {})

  const run = async () => ws && selectTab(await call<TabView>('run', { ws: ws.id }))
  // a RUN_SCRIPTS one (Run ▾, ⌘K): its tab, the last one's replaced; deploy once you say so
  const runScript = async (w: WorkspaceView, k: RunScript) => {
    if (k === 'deploy' && !(await ask(`Deploy ${w.name ?? w.id}?`, { text: "Runs the project's deploy script in a deploy tab.", ok: 'Deploy' }))) return
    call<TabView>('run', { ws: w.id, script: k }).then(selectTab, () => {})
  }
  // the panel on the right, on a tab: Info (⌘I), Files, Changes, Review, Preview
  const showPanel = (t: PanelTab) => (setPanelTab(t), setPanelOpen(true), setReviewTight(false)) // asked for: it shows, beside a narrow Review tab too
  uiRef.current = m => {
    if (m.do === 'show' && m.tab) return void (setDialog(null), selectTab(m.tab))
    if (m.do === 'link' && m.link) return void setLink(m.link)
    if (m.do === 'full_screen') return void (m.on !== false && setDialog(null), toggleFull(m.on !== false))
    if (m.do === 'panel') return void (m.panel === 'none' ? setPanelOpen(false) : showPanel(m.panel as PanelTab))
    if (m.do === 'close') return void (full ? toggleFull(false) : setDialog(null))
  }
  const panelShown = panelOpen
  const togglePanel = (t = panelTab) => (panelShown && !(reviewOn && reviewTight) && t === panelTab ? setPanelOpen(false) : showPanel(t)) // one U6 hid: a click brings it back
  const info = panelOpen && panelTab === 'info'
  const showInfo = (on = !info) => (on ? showPanel('info') : setPanelOpen(false))
  // the run script: its tab, Run ▾
  const devTab = ws ? view?.tabs.find(t => t.workspace === ws.id && t.kind === 'dev') : undefined
  const devRunning = !!devTab && devTab.status !== 'exited'
  const editScripts = () => project && setDialog({ settings: project.id, script: 'run', spot: 'Scripts' }) // opened at its Scripts, lit
  // an action from Run ▾: a prompt to its agent's tab (queued while it works), a command to a shell (a new one if none)
  const runAction = async (w: WorkspaceView, a: RunAction, tab?: string) => {
    // a new tab goes in whole: the view doesn't have it yet. Any workspace's (a sidebar row's Run ›): not byId, the shown one's
    const t = tab ? view?.tabs.find(x => x.id === tab) : await call<TabView>('tabNew', { ws: w.id, preset: 'shell' }).catch(() => null)
    if (!t) return
    selectTab(t)
    const r = await call<{ queued?: number }>('send', { target: t.id, text: stamp(a.text, Date.now()), whenIdle: a.target !== 'shell', vars: true }).catch(() => null) // its {{HH:mm}}-style dates: now's; its {{branch}}…: the daemon's
    if (r?.queued) toast(`${a.name}: queued for when the agent's turn ends`)
  }
  // Run ▾'s actions for a workspace (the sidebar's right click: any workspace's, its own tabs and project)
  const actionItems = (w: WorkspaceView): MenuItem[] => {
    const live = (view?.tabs ?? []).filter(t => t.workspace === w.id && t.status !== 'exited').map(t => ({ id: t.id, agent: t.kind === 'agent' ? t.preset : undefined, shell: t.kind === 'shell', busy: t.status !== 'idle' || !!t.runs }))
    const cfg = view?.projects.find(p => p.id === w.project)?.config
    return actionMenu(actionsFor(settings.actions, cfg?.actions, live, w.id === ws?.id ? tab?.id : undefined), id => view?.tabs.find(t => t.id === id)?.name, (a, t) => runAction(w, a, t))
  }
  // Run ▾: the toolbar's, and a sidebar row's right click (Run ›) for any workspace
  const runMenu = (w = ws): MenuItem[] => {
    if (!w) return []
    const dev = view?.tabs.find(t => t.workspace === w.id && t.kind === 'dev')
    const p = view?.projects.find(x => x.id === w.project)
    const edit = () => p && setDialog({ settings: p.id, script: 'run', spot: 'Scripts' }) // opened at its Scripts, lit
    return [
      { label: dev ? 'Restart' : 'Run', icon: 'run', key: 'r', tip: w.run ? `Runs the project's run script in its own tab, $PORT set to ${w.port}${dev ? ': stopped first' : ''}` : 'No run script yet: set one in the project\'s settings', run: () => (w.run ? call<TabView>('run', { ws: w.id }).then(selectTab, () => {}) : edit()) },
      ...(dev && dev.status !== 'exited' ? [{ label: 'Stop', icon: 'stop', key: 's', tip: 'Sends ⌃C to the run tab', run: () => api.send('input', { tab: dev.id, data: '\x03' }) } as MenuItem] : []),
      ...(dev ? [{ label: 'Show the run tab', icon: 'terminal', key: 't', tip: 'Brings the run script\'s tab to the front', run: () => selectTab(dev.id) } as MenuItem] : []),
      ...(w.scripts ?? []).map((k): MenuItem => ({ label: SCRIPT_LABELS[k], icon: SCRIPT_ICONS[k], tip: `Runs the project's ${k} script in a tab of its own`, run: () => runScript(w, k) })),
      ...(w.noSetup && p?.hasSetup ? [{ label: 'Run the setup script', icon: 'terminal', sub: 'Made without it', tip: 'Runs the project\'s setup script here, as a new workspace would have',  run: () => call<TabView>('run', { ws: w.id, script: 'setup' }).then(selectTab, () => {}) } as MenuItem] : []), // its tab; the item goes
      { label: `Open localhost:${w.port}`, icon: 'link', key: 'o', tip: `Opens this workspace's port (its $PORT) in your browser`, run: () => openPort(w.port) },
      ...actionItems(w),
      null,
      { label: w.run || w.scripts?.length ? 'Edit scripts…' : 'Set a run script…', icon: 'pencil', key: 'e', tip: 'Opens the project\'s settings at Scripts: setup, run, teardown, test, lint, format, deploy', run: edit },
      ...(p && !p.kind ? [{ label: 'Edit actions…', icon: 'pencil', tip: 'Opens the project\'s settings at Actions: saved prompts for an agent and commands for a shell, listed in this menu', run: () => setDialog({ settings: p.id, spot: 'Actions' }) } as MenuItem] : []),
    ]
  }
  // the file preview goes (closed, or another file shown): an unsaved edit only once you say so
  // a file in a tab of its own (one open already: in front, at the line asked for); its unsaved edit goes only once you say so
  const openFile = (f: Omit<Opened, 'n'>) => {
    const k = fileKey(f)
    setOpenFiles(l => (l.some(x => x.ws === f.ws && fileKey(x) === k) ? l.map(x => (x.ws === f.ws && fileKey(x) === k && f.line !== undefined ? { ...x, line: f.line, n: ++requests } : x)) : [...l, { ...f, n: ++requests }]))
    setShownFile(m => ({ ...m, [f.ws]: k }))
  }
  const closeFile = async (f: Opened) => {
    if (edited(f.edit) && !(await ask(`Discard your changes to ${f.path.split('/').pop()}?`, { text: "They aren't saved.", ok: 'Discard', danger: true }))) return
    const mine = openFiles.filter(x => x.ws === f.ws)
    const i = mine.findIndex(x => fileKey(x) === fileKey(f))
    const next = mine[i + 1] ?? mine[i - 1] // the one in front closed: the one beside it comes forward
    setOpenFiles(l => l.filter(x => !(x.ws === f.ws && fileKey(x) === fileKey(f))))
    if (next && fileKey(mine.find(x => fileKey(x) === shownFile[f.ws]) ?? mine.at(-1)!) === fileKey(f)) setShownFile(m => ({ ...m, [f.ws]: fileKey(next) }))
  }
  const closePreview = async () => void (previewed && (await closeFile(previewed)))
  // a terminal's ⌘-clicked file:// link: a file of the tab's workspace in the preview, anything else as Finder would
  // (main's open-path, which follows links: a workspace's file by its real path too); a host's only in the preview,
  // through the daemon; a browser has no Finder
  // Reply's targets for a tab's selected text: the tab when an agent runs in it, else its workspace's live agents
  // ⌥ by Reply: the selection as a new workspace's prompt (the page filled in), a new agent tab's here, or Laki AI's question
  const selectionTo = (id: string) => (text: string, how: SelectionUse) => {
    const w = view?.workspaces.find(x => x.id === byId(id)?.workspace)
    const said = text.trim()
    if (how === 'workspace') return newWs(projOf(w)?.kind ? undefined : w?.project, { prompt: said }) // a terminal's: you pick the project
    if (how === 'tab') return void (w && call<TabView>('tabNew', { ws: w.id, preset: settings.agent ?? 'claude', prompt: said }).then(selectTab, () => {}))
    if (!aiOn(settings)) return toast('Laki AI is off: Settings › AI')
    if (settings.ai?.float === false) setDialog('ai')
    else setAiFloat(true)
    void whereNow().then(context => api.call('aiAsk', { text: said, context })).catch(fail)
  }
  // Reply's agent: the tab's own (an agent tab, or a shell running one); a plain shell's terminal has no Reply
  const replyTo = (id: string) => (t => (t && (t.kind === 'agent' || t.runs) && t.status !== 'exited' ? [t] : []))(byId(id))
  // a picture's path hovered in a terminal: the workspace's file, its storage folder's, a pasted one. One not there (an
  // agent names og.png, it's site/og.png): the workspace's one file of that name or tail; none or several: null, no card
  const fileLists = useRef(new Map<string, { at: number; list: Promise<FileList | null> }>()) // a workspace's files, a minute: one listing for many hovers
  const filesOf = (ws: string, within = 60_000) => {
    const c = fileLists.current.get(ws)
    if (c && Date.now() - c.at < within) return c.list
    const list = api.call<FileList>('files', { ws }).catch(() => null)
    fileLists.current.set(ws, { at: Date.now(), list })
    return list
  }
  // a name not where the terminal's folder says (hover's and ⌘-click's alike): the worktree's one file of that name
  // (a list read a while ago, then again: one the agent just made), else its storage folder's newest ($LAKI_STORAGE_FOLDER,
  // where agents keep their screenshots; artifactList's order). Two in the worktree: neither
  const findNamed = async (w: WorkspaceView, rel: string): Promise<{ path: string; storage?: true } | undefined> => {
    const named = (f: string) => f === rel || f.endsWith(`/${rel}`)
    let hits = (await filesOf(w.id))?.files.filter(named) ?? []
    if (!hits.length) hits = (await filesOf(w.id, 3000))?.files.filter(named) ?? []
    if (hits.length) return hits.length === 1 ? { path: hits[0] } : undefined
    const kept = w.storage ? (await api.call<{ path: string }[]>('artifactList', { ws: w.id }).catch(() => [])).find(f => named(f.path))?.path : undefined
    return kept ? { path: kept, storage: true } : undefined
  }
  // a hovered file of the tab's workspace or its storage folder (one not there: the workspace's file of that name),
  // fileRead's answer's `what` (a picture's data URL, a text's); null: no card; undefined: not one of the workspace's
  const PEEK_TEXT = 50 * 1024 // a Markdown or text file's hover card: 50 KB at most
  const peekFile = (id: string, path: string, what: 'image' | 'text') => {
    const w = view?.workspaces.find(x => x.id === byId(id)?.workspace)
    // a text file over PEEK_TEXT: no card (null: its path's tooltip), however much the daemon read of it
    const read = (storage: boolean, p = path) => api.call<{ image?: string; text?: string; size?: number }>('fileRead', { ws: w!.id, path: p, storage }).then(r => (what === 'text' && (r.size ?? 0) > PEEK_TEXT ? null : r[what]))
    if (w && path.startsWith(`${w.path}/`))
      return read(false).catch(async e => {
        if (!/ENOENT|no such file/i.test(String(e?.message ?? e))) throw e // a real failure is said, not hidden
        const f = await findNamed(w, path.slice(w.path.length + 1))
        return f ? read(!!f.storage, f.path) : null
      })
    if (w?.storage && path.startsWith(`${w.storage}/`)) return read(true)
  }
  // a Markdown file's card: the workspace's and its storage folder's only (anywhere else on this Mac: no card)
  const peekText = (id: string) => (path: string) => peekFile(id, path, 'text') ?? Promise.resolve(null)
  const peekImage = (id: string) => (path: string) => {
    const mine = peekFile(id, path, 'image')
    if (mine) return mine
    const w = view?.workspaces.find(x => x.id === byId(id)?.workspace)
    if (w?.host) return Promise.reject(new Error('Not a file of this workspace')) // a full path on its host: not this Mac's
    // anywhere on this Mac: a scratchpad's, /tmp's; refused (remote access, a daemon before API 151): a pasted one's
    return api.call<{ image?: string }>('imageRead', { path }).then(
      r => r.image,
      e => api.call<string>('aiImage', { path }).catch(() => Promise.reject(e)), // neither: imageRead's why
    )
  }
  const openPath = async (tab: string, path: string) => {
    const w = view?.workspaces.find(x => x.id === byId(tab)?.workspace)
    if (!w) return
    const rel = path.startsWith(`${w.path}/`) ? path.slice(w.path.length + 1).replace(/\/+$/, '') : ''
    const how = w.host || !bridge?.openPath ? (rel ? { rel } : 'none') : await bridge.openPath(path, w.path)
    if (typeof how === 'object') panelApi(w).preview(how.rel)
    else if (how === 'missing') {
      const f = rel ? await findNamed(w, rel) : undefined
      if (f) openFile({ ws: w.id, path: f.path, ...(f.storage && { storage: true }) })
      else toast(`Not there: ${path}`)
    }
  }
  // a file path in a terminal's text, clicked: a file of the workspace in Laki's preview at its line, or your editor
  // (Settings › Terminal's fileClick; other: ⌥ held with ⌘, the other one); any other path as a file:// link's
  const openCode = (tab: string) => (path: string, line: number | undefined, other: boolean) => {
    const w = view?.workspaces.find(x => x.id === byId(tab)?.workspace)
    const rel = w && path.startsWith(`${w.path}/`) ? path.slice(w.path.length + 1) : ''
    if (!w || !rel) return void openPath(tab, path)
    if ((settings.fileClick === 'editor') !== other) return void call('openIn', { ws: w.id, app: 'editor', file: rel }).catch(() => {})
    panelApi(w).preview(rel, line)
  }
  // Changes' Revert, a git action: always asked (a whole file, or what of it: a hunk, some lines), an agent at work there
  // in the same question
  const revertOk = async (w: WorkspaceView, file: string, part?: string, uncommitted?: boolean) => {
    const busy = view?.tabs.find(t => t.workspace === w.id && t.kind === 'agent' && t.status === 'running')
    const warn = busy && `${busy.preset ?? busy.name} is working here: it may write it again.`
    const name = file.split('/').pop()
    return ask(part ? `Revert ${part} in ${name}?` : `Revert ${name}?`, { text: [`Back to how ${part ? 'it is' : 'the file is'} ${uncommitted ? 'in the last commit' : `on ${w.base ?? 'the base'}`}${part ? '' : ': every change in it goes'}. Nothing is committed; Undo is in the toast.`, warn].filter(Boolean).join(' '), ok: 'Revert', danger: true })
  }
  const redo = (w: WorkspaceView, id: string, then?: () => void) => call('hunkRedo', { ws: w.id, id }).then(() => (then?.(), done('Back as it was')), () => {})
  const panelApi = (w: WorkspaceView): PanelApi => ({
    files: () => api.call<FileList>('files', { ws: w.id }),
    newFile: (path, dir) => api.call<{ path: string }>('fileNew', { ws: w.id, path, dir }).then(r => r.path),
    openFile: file => void call('openIn', { ws: w.id, app: 'editor', file }).catch(() => {}),
    preview: (path, line) => openFile({ ws: w.id, path, line }),
    changes: uncommitted => api.call<Changes>('diff', { ws: w.id, uncommitted }),
    prChanges: () => api.call<Changes>('prDiff', { ws: w.id }),
    sinceChanges: () => api.call<Changes>('diff', { ws: w.id, since: true }),
    ...(hasCap(view, 'diff.since') && { commitChanges: (sha: string) => api.call<Changes>('diff', { ws: w.id, since: sha }) }),
    prHeadOf: sha => (x => x && prNo(x))(view?.workspaces.find(x => x.id !== w.id && !x.archived && x.pr?.head === sha)?.pr),
    turnChanges: n => api.call<Changes>('turnDiff', { ws: w.id, ...(n !== undefined && { n }) }),
    turns: () => api.call<TurnKept[]>('turnList', { ws: w.id }),
    ...(w.kind === 'worktree' && { bases: () => api.call('baseBranches', { ws: w.id }), setBase: (base: string) => api.call('wsBase', { ws: w.id, base }) }),
    commits: () => api.call<Commits>('commits', { ws: w.id }),
    commitDiff: sha => api.call<Changes>('commitDiff', { ws: w.id, sha }),
    prFiles: () => api.call<PRFiles>('prFiles', { ws: w.id }),
    setViewed: (path, viewed, id) => api.call('prViewed', { ws: w.id, path, viewed, id }),
    read: (path, base, uncommitted) => api.call<FileContent>('fileRead', { ws: w.id, path, base, uncommitted }),
    prFile: path => api.call<FileContent>('prFile', { ws: w.id, path }),
    // the workspace's live agent tabs, the focused one first: where a comment or the full review's go
    agents: (ts => [...ts.filter(t => t.id === tabByWs[w.id]), ...ts.filter(t => t.id !== tabByWs[w.id])])((view?.tabs ?? []).filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited')).map(t => ({ id: t.id, name: t.name })),
    threads: () => api.call<Thread[]>('prThreads', { ws: w.id }),
    // the file read again: its lines must still be what the review saw (applySuggestions), and fileWrite's was keeps an
    // agent's write meanwhile; Undo writes the text back the same way
    apply: async (path, edits, then) => {
      const was = (await call<FileContent>('fileRead', { ws: w.id, path })).text
      if (was === undefined) return toast(`${path} isn't text`)
      let text: string
      try {
        text = applySuggestions(was, edits)
      } catch (e) {
        return toast(`${path.split('/').pop()}: ${(e as Error).message}: nothing applied`)
      }
      await call('fileWrite', { ws: w.id, path, text, was })
      then?.()
      done(`Applied ${edits.length === 1 ? 'the suggestion' : `${edits.length} suggestions`} to ${path.split('/').pop()}`, () => void call('fileWrite', { ws: w.id, path, text: was, was: text }).then(() => (then?.(), done('Back as it was')), () => {}))
    },
    comment: c => api.call('prComment', { ws: w.id, ...c }).then(() => (earn('comment'), toast(`Commented on PR #${w.pr?.number}`))),
    toAgent: (text, line, tab) => api.call('send', { target: tab ?? w.id, text, whenIdle: true, steer: true }).then(() => (line && earn('comment'), toast(`Sent to ${(tab && view?.tabs.find(t => t.id === tab)?.name) || 'the agent'}`))),
    saveImage: data => api.call<string>('imageSave', { data, ext: 'png' }),
    proofShot: (turn, png) => api.call('proofShot', { ws: w.id, turn, png }),
    toPrompt: text => intoAgent(w.id, text),
    sourceGuess: words => api.call<string[]>('sourceGuess', { ws: w.id, words }).catch(() => []),
    sim: p => api.call('sim', p),
    setup: () => setDialog({ section: 'simulator' }),
    float: bridge?.floatSim && (device => bridge!.floatSim!(device, w.id)),
    floated: simFloated,
    unfloat: bridge?.floatSim && (device => bridge!.floatSim!(device, w.id, false)),
    menu: (e, path, dir) => openMenu(e, fileMenu(w, path, dir)),
    fileItems: path => fileMenu(w, path, false, false), // its menu has View as page already (webItems)
    look: bridge?.quickLook && !w.host ? (path, storage) => (storage ? w.storage : w.path) && bridge!.quickLook!(`${storage ? w.storage : w.path}/${path}`) : undefined, // host: SSH or a codespace, no file here
    web: (path, at, line) => void call<{ url: string }>('fileWeb', { ws: w.id, path, at, line }).then(r => openExternal(r.url), fail),
    page: artPage(w, 'x.html', true) ? path => setArtView({ ws: w.id, path, wt: true }) : undefined, // View as page: a changed HTML file
    undoHunk: async (path, hunk, lines, then, uncommitted) => {
      if (!(await revertOk(w, path, lines ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : 'this hunk', uncommitted))) return false
      const { id } = await call<{ id: string }>('hunkUndo', { ws: w.id, path, hunk, lines, uncommitted })
      then?.()
      done(`Reverted ${lines ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : '1 hunk'} in ${path.split('/').pop()}`, () => void redo(w, id, then))
      return true
    },
    undoFile: async (path, then, uncommitted) => {
      if (!(await revertOk(w, path, undefined, uncommitted))) return false
      const { id } = await call<{ id: string }>('fileUndo', { ws: w.id, path, uncommitted })
      then?.()
      done(`Reverted ${path.split('/').pop()}`, () => void redo(w, id, then))
      return true
    },
    redo: id => redo(w, id),
    artifacts: w.storage
      ? {
          files: () => api.call<{ path: string }[]>('artifactList', { ws: w.id }).then(l => ({ files: l.map(f => f.path), changed: {} })),
          preview: path => (/\.html?$/i.test(path) && inViewer(path) ? openArt(w, path) : openFile({ ws: w.id, path, storage: true })), // an HTML page shown as a page (its Source: the preview)
          open: path => openArt(w, path),
          menu: (e, path) => openMenu(e, artMenu(w, path)),
        }
      : undefined,
  })
  // the full review's: the panel's, the workspace's agents (the focused one first), a send when its turn ends, and the
  // PR's review
  const reviewApi = (w: WorkspaceView): ReviewApi => ({
    ...panelApi(w),
    send: (tab, text) => api.call('send', { target: tab, text, whenIdle: true }).then(() => done(`Sent the review to ${view?.tabs.find(t => t.id === tab)?.name ?? 'the agent'}`)),
    threadsAll: () => api.call<Thread[]>('prThreads', { ws: w.id, all: true }),
    talk: () => api.call<Talk[]>('prTalk', { ws: w.id }),
    say: body => api.call<{ url?: string }>('prSay', { ws: w.id, body }).then(r => toast(`Commented on PR #${w.pr?.number}`, r.url ? () => openExternal(r.url!) : undefined, 'Open', true)),
    blame: (path, side, uncommitted) => api.call<Blame>('blame', { ws: w.id, path, side, uncommitted }),
    notesGet: () => api.call('reviewNotesGet', { ws: w.id }),
    notesSet: notes => api.call('reviewNotesSet', { ws: w.id, notes }),
    mark: () => api.call('reviewMark', { ws: w.id }),
    post: comments => api.call<{ url?: string; n: number }>('prReview', { ws: w.id, comments }).then(r => (r.url ? toast(`Posted ${r.n} comment${r.n === 1 ? '' : 's'} on PR #${w.pr?.number}`, () => openExternal(r.url!), 'Open', true) : done(`Posted ${r.n} comment${r.n === 1 ? '' : 's'} on PR #${w.pr?.number}`))),
  })
  // an artifact opened: HTML and Markdown in the app's viewer (Settings › General › Storage, unless In the browser), the
  // rest a document in its app, else shown in Finder
  const inViewer = (path: string) => settings.artifactsIn !== 'browser' && VIEWED.test(path)
  const artPage = (w: WorkspaceView, path: string, wt?: boolean) => ((wt ? w.wtKey && !w.host && base /* View as page: a local worktree, never over remote access ('') */ : w.artKey) && base !== null ? `${base}/${wt ? 'worktree' : 'artifact'}/${wt ? w.wtKey : w.artKey}/${encodeURIComponent(w.id)}/${path.split('/').map(encodeURIComponent).join('/')}` : undefined) // its own key: one workspace's
  // in the browser: an HTML one as the daemon's sandboxed page (L11: never a file: page), anything else by main's open-path
  const inBrowser = (w: WorkspaceView, path: string) => (/\.html?$/i.test(path) && artPage(w, path) ? void bridge?.openExternal?.(artPage(w, path)!) : void bridge?.openPath?.(`${w.storage}/${path}`))
  const openArt = (w: WorkspaceView, path: string) => (inViewer(path) ? setArtView({ ws: w.id, path }) : inBrowser(w, path))
  // the file itself (file://), when you ask: its scripts run as a local page (the viewer's Open file, the right click's)
  const asFile = (w: WorkspaceView, path: string) => (bridge?.openFile && w.storage && /\.html?$/i.test(path) ? () => void bridge!.openFile!(`${w.storage}/${path}`, w.storage!).then(r => (r === 'viewer' ? openArt(w, path) : r === 'missing' && toast(`Not there: ${path}`)), fail) : undefined)
  // an artifact's right click (Files' Artifacts, the status bar's strip and its big view): open it, Finder, the clipboard
  const artMenu = (w: WorkspaceView, path: string): MenuItem[] => {
    const full = `${w.storage}/${path}`
    return [
      ...(inViewer(path) ? [{ label: 'Open', icon: 'file', run: () => openArt(w, path) } as MenuItem] : []),
      ...(bridge?.openPath ? [{ label: inViewer(path) ? 'Open in the browser' : 'Open', icon: inViewer(path) ? 'globe' : 'file', run: () => inBrowser(w, path) } as MenuItem] : []),
      ...((f => (f ? [{ label: 'Open the file', icon: 'file', sub: 'As file:// in your browser: its scripts can read your files', run: f } as MenuItem] : []))(asFile(w, path))),
      ...(bridge?.openPath ? [{ label: 'Show in Finder', icon: 'folder', run: () => revealArt(w, path) } as MenuItem, null] : []),
      ...(bridge?.copyFile ? [{ label: 'Copy', icon: 'copy', key: 'c', sub: PICTURE.test(path) ? 'The picture' : 'The file: paste it in Finder, Slack or mail', run: () => void bridge!.copyFile!(full).then(k => (k === 'missing' ? toast(`${path} is gone`) : done(k === 'image' ? 'Picture copied' : 'File copied')), fail) } as MenuItem] : []),
      ...(PLAIN.test(path) ? [{ label: 'Copy text', icon: 'copy', key: 't', run: () => void api.call<FileContent>('fileRead', { ws: w.id, path, storage: true }).then(c => (c.text === undefined ? toast(`${path} isn't text`) : c.cut ? toast(`${path} is too big to copy as text: Copy puts the file itself there`) : copy(c.text)), fail) } as MenuItem] : []),
      { label: 'Copy path', icon: 'copy', key: 'p', run: () => copy(full) },
      ...extItems('file', w, { ws: w.id, file: path, storage: true }, path), // its file actions, on the artifact
    ]
  }
  // an artifact's folder in Finder ('': the storage folder): open-path would open a document in its app
  const revealArt = (w: WorkspaceView, path: string) => void bridge?.openPath?.(`${w.storage}/${path.replace(/\/?[^/]*$/, '')}`)
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => done('Copied'), fail)
  // the agent skills installed with other text than this Laki's (Settings › Agent skill: an update of Laki changed
  // it, an edit, half a folder): a bar with Update, read as it connects and on the window's focus (a minute apart);
  // not one another Laki set up (foreign: Update there would point it here). Not now: until the app starts again
  const [oldSkills, setOldSkills] = useState<SkillInfo[]>([])
  const [hung, setHung] = useState<'no' | 'yes' | 'waited'>('no') // main's pings: the daemon isn't answering; Wait hides the bar until it answers and stops again
  useEffect(() => {
    bridge?.onDaemonHung?.(h => setHung(was => (!h ? 'no' : was === 'waited' ? 'waited' : 'yes')))
  }, [])
  const [troubleSeen, setTroubleSeen] = useState(0) // R6: the trouble bar's ×: until another error (by its time: a restarted daemon counts from 1 again)
  // the daemon restarted, terminals kept (shutdown keep): the stale bar's and the trouble bar's; the app's own way when it isn't asked as you
  const restartDaemon = () => api.call('shutdown', { keep: true }).catch((e: Error) => (bridge?.restartDaemon && /who's calling/.test(e.message) ? bridge.restartDaemon().then(ok => ok || Promise.reject(e)) : Promise.reject(e)))
  const skillsAt = useRef(0)
  const skillsLater = useRef(false)
  const stale = (rows: SkillInfo[]) => setOldSkills(skillsLater.current ? [] : rows.filter(r => r.state === 'outdated' && !r.foreign))
  useEffect(() => {
    if (!connected) return
    const check = () => {
      if (skillsLater.current || Date.now() - skillsAt.current < 60_000) return
      skillsAt.current = Date.now()
      api.call<SkillInfo[]>('skills').then(stale, () => {})
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [connected])
  // one after another: each answer is the rows after its write (at once, the last could be read before another's);
  // the bar goes as it starts (a second click does nothing), and comes back with what's left
  const updateSkills = () => {
    const todo = oldSkills
    const names = [...new Set(todo.map(r => r.name))].join(', ')
    setOldSkills([])
    return todo
      .reduce((p, r) => p.then(() => api.call<SkillInfo[]>('skillSet', { agent: r.agent, on: true, skill: r.skill })), Promise.resolve<SkillInfo[]>([]))
      .then(rows => (stale(rows), done(`Updated Laki's skill in ${names}`)), e => (fail(e), api.call<SkillInfo[]>('skills').then(stale, () => {})))
  }
  // a tab's whole terminal as text, the scrollback too (an older daemon's: the bottom of its screen)
  const copyTab = (t: TabView) =>
    void api.call<string>('screen', { target: t.id, all: true }).then(text => {
      if (!text.trim()) return toast(`Nothing in ${t.name} to copy`)
      const n = text.split('\n').length
      return navigator.clipboard.writeText(text).then(() => done(`Copied ${t.name}: ${n} line${n === 1 ? '' : 's'}`), fail)
    }, fail)
  const tunnelApi = (w: WorkspaceView): TunnelApi => ({
    check: () => api.call<Cloudflared>('cloudflared', { ws: w.id }),
    start: (port, mails, hours, host) => api.call('tunnelStart', { ws: w.id, port, mails, hours, host }),
    stop: port => api.call('tunnelStop', { ws: w.id, port }),
    open: openExternal,
    copy,
    name: w.name || w.id,
    settings: () => setDialog({ section: 'tunnels' }),
  })
  const settings = view?.settings ?? {}
  const specsOn = specsOnIn(settings) // Settings › General › Pages: on unless turned off
  const flowsOn = flowsOnIn(settings) // the same
  // Achievements (achievements.ts): each earned once, as you do it, into settings.achievements (got: when). sent: the
  // last one written, shown and built on until the view has it, so an unlock, a ✕ and Turn off in a row keep each
  // other. Off: none earned, no trophy, no toast
  // ponytail: the whole object is written, so two windows earning in the same instant can lose one; a daemon method if it matters.
  // Only this window's calls count: the new-workspace and AI windows (NewWindow.tsx) earn nothing
  const sent = useRef<AchievementsKept | null>(null)
  if (sent.current && JSON.stringify(sent.current) === JSON.stringify(settings.achievements ?? {})) sent.current = null
  const achKept: AchievementsKept = sent.current ?? settings.achievements ?? {}
  const achRef = useRef(achKept)
  achRef.current = achKept
  const [unlocked, setUnlocked] = useState<string[]>([]) // the unlock toast's, newest last
  const unlockTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const unlockAt = useRef(0)
  const toastAt = useRef(0)
  const toasts = useRef(true)
  const [achMore, setAchMore] = useState(0)
  const achSet = (o: AchievementsKept) => {
    const next = (sent.current = achRef.current = { ...achRef.current, ...o })
    return api.call('settingsSet', { achievements: next }).catch(e => {
      if (sent.current === next) sent.current = null // the view's again: a failed unlock can be earned again
      throw e
    })
  }
  const earn = (id: string) => {
    const a = achRef.current
    if (!viewRef.current || a.off || a.got?.[id] || a.hidden?.includes(id)) return // no view yet: its settings unknown, written over; hidden: doesn't unlock
    achSet({ got: { ...a.got, [id]: Date.now() } }).catch(() => {})
    const fresh = Date.now() - unlockAt.current > 1500 // one action's unlocks together, not the last toast's too
    unlockAt.current = Date.now()
    // U2: a toast every ACH_QUIET at most; the ones between count on the trophy (+n) until its page is opened
    if (fresh && (toasts.current = Date.now() - toastAt.current >= ACH_QUIET)) toastAt.current = Date.now()
    if (!toasts.current) return setAchMore(n => n + 1)
    setUnlocked(u => (fresh ? [id] : [...u, id]))
    clearTimeout(unlockTimer.current)
    unlockTimer.current = setTimeout(() => setUnlocked([]), 6000)
  }
  const earnRef = useRef(earn)
  earnRef.current = earn
  useEffect(() => api.onCall((method, params, r) => void (achRef.current.off || earnedBy(method, params, r).forEach(id => earnRef.current(id)))), []) // off (a new install's): no bookkeeping per call
  // the view's numbers and values that moved since the last view (the first, and the first after a reconnect: where
  // they start, nothing earned; a new daemon's view, an update's migrations, isn't something you did)
  const ups = useRef<Record<string, number | string>>(undefined)
  useEffect(() => void (connected || (ups.current = undefined)), [connected])
  useEffect(() => {
    if (!view || achKept.off) return
    const now = upsOf(view)
    if (ups.current) wentUp(ups.current, now).forEach(earn)
    ups.current = now
  }, [view])
  useEffect(() => void (dialog && pageEarns(typeof dialog === 'string' ? dialog : settingsOf(dialog) ? 'settings' : Object.keys(dialog)[0]).forEach(earn)), [dialog])
  useEffect(() => void (find && earn('filter')), [!!find])
  useEffect(() => void (dialog === 'achievements' && setAchMore(0)), [dialog])
  // Changes or the Simulator on screen, once it wasn't: not the panel as it was left when Laki started
  const onTab = panelShown && ws ? panelTab : ''
  const tabWas = useRef<string>(undefined)
  useEffect(() => {
    if (!view) return
    const id = ({ changes: 'changes', device: 'simTab' } as Record<string, string>)[onTab]
    if (id && tabWas.current !== undefined && tabWas.current !== onTab) earn(id)
    tabWas.current = onTab
  }, [onTab, !view])
  useEffect(() => void bridge?.onEarn?.(id => earnRef.current(id)), []) // main's: the global hotkey, a bubble's click
  // Laki AI's extension chats (studioChats, Laki AI on): where you left off, in Settings › Extensions and a new
  // extension's page, again a moment after an ai event
  const [studioChats, setStudioChats] = useState<StudioChat[]>([])
  const studioOn = aiOn(settings)
  useEffect(() => {
    if (!studioOn || !connected) return
    let t: ReturnType<typeof setTimeout> | undefined
    const chats = () => void api.call<StudioChat[]>('studioChats').then(setStudioChats, () => {})
    chats()
    const off = api.on(m => {
      if (m.ev === 'ai' && m.chat) t ??= setTimeout(() => ((t = undefined), chats()), 1500) // not a streamed partial (A7)
    })
    return () => (off(), clearTimeout(t))
  }, [studioOn, connected])
  const pickKey = settings.pickerKey ?? PICKER_KEY // the element picker's hotkey ('' none)
  const kb = keyMap(settings.keys) // Settings › Keys': the keys of App's own actions in use ('' none)
  const kh = (id: KeyId) => keyShow(kb[id]) || undefined // as a menu's hint
  tipKeys.map = kb // keyTip's, for tooltips outside App
  const kt = keyTip // a tooltip with its keys, drawn as keycaps (ui.tsx tipText)
  const hotkey = !view ? null : settings.hotkeyOn !== false ? settings.hotkey ?? HOTKEY : '' // the global hotkey (main's globalShortcut; '' none; null: no settings yet)
  const [held, setHeld] = useState({ open: false, shot: false, quick: false, tell: false, talk: false }) // main took the keys (Help shows only those)
  useEffect(() => void (hotkey !== null && bridge?.hotkey?.(hotkey).then(open => setHeld(h => ({ ...h, open })))), [hotkey])
  const shotKey = !view ? null : settings.shotAsk !== false && aiOn(settings) ? settings.shotKey ?? SHOT_KEY : false // Screenshot to Laki AI's (false: off)
  useEffect(() => void (shotKey !== null && bridge?.shotKey?.(shotKey).then(shot => setHeld(h => ({ ...h, shot })))), [shotKey])
  const quickKey = !view ? null : settings.quickOn === true ? settings.quickKey ?? QUICK_KEY : '' // Q1: the quick bar's ('' none: off until turned on)
  useEffect(() => void (quickKey !== null && bridge?.quickKey?.(quickKey).then(quick => setHeld(h => ({ ...h, quick })))), [quickKey])
  // Allow / Deny the newest ask from any app ('' none: off until turned on, Settings › General)
  const allowKey = !view ? null : settings.allowOn === true ? settings.allowKey ?? ANSWER_KEYS.allow.key : ''
  const denyKey = !view ? null : settings.denyOn === true ? settings.denyKey ?? ANSWER_KEYS.deny.key : ''
  useEffect(() => void (allowKey !== null && bridge?.answerKey?.('allow', allowKey)), [allowKey])
  useEffect(() => void (denyKey !== null && bridge?.answerKey?.('deny', denyKey)), [denyKey])
  const tellKey = !view ? null : settings.tellOn === true ? settings.tellKey ?? TELL_KEY : '' // Q7: show and tell's ('' none: off until turned on)
  useEffect(() => void (tellKey !== null && bridge?.tellKey?.(tellKey).then(tell => setHeld(h => ({ ...h, tell })))), [tellKey])
  const talkKey = !view ? null : talkOn ? settings.talkKey ?? TALK_KEY : '' // Q2: the talk key ('' none: off until turned on, the cloud engine only)
  useEffect(() => void (talkKey !== null && bridge?.talkKey?.(talkKey).then(talk => setHeld(h => ({ ...h, talk })))), [talkKey])
  const updateAuto = !view ? null : settings.updateCheck !== false // Settings' Check for updates (null: no settings yet)
  const updateDelay = settings.updateDelay ?? 0 // and its Update delay, days
  useEffect(() => void (updateAuto !== null && bridge?.updateAuto?.(updateAuto, updateDelay)), [updateAuto, updateDelay])
  // main's update.ts: a newer release stays in the status bar until you update (every check says so, a restart too);
  // a version a scheduled check found also toasts, once each (main's update.json). Its notes and Download: Settings
  const [upd, setUpd] = useState<UpdateState | null>(null)
  // U13: What's new, once a version: the notes (loaded only then) of this one when settings' seenVersion is another;
  // none for it (a build between releases): nothing shown
  const [news, setNews] = useState<NewLine[]>([])
  const seenV = view?.settings.seenVersion
  useEffect(() => {
    if (seenV === undefined || seenV === appVersion) return setNews([])
    let on = true
    void import('../../../docs/release-notes.md?raw').then(m => on && setNews(newLines(m.default, appVersion)))
    return () => void (on = false)
  }, [seenV])
  const newsSeen = () => (setNews([]), void api.call('settingsSet', { seenVersion: appVersion }).catch(() => {}))
  // Update when idle (the daemon's view.updateIdle, so it outlives this window: Settings › Updates, an agent's laki
  // update --when-idle): the release looked for and downloaded, installed once no agent works or asks (the agent that
  // asked aside: its turn goes on, the daemon outlives the app), then, in the new app, the older daemon restarted once
  // none does at all (tabs resume). Nothing to update: it's turned off, saying why
  const idleAsk = view?.updateIdle
  const idleGo = useRef('') // what was done for this ask already (a step each, not again on every view)
  useEffect(() => {
    if (!idleAsk || !upd || !bridge?.update) return
    const busy = (but?: string) => view!.tabs.some(t => t.id !== but && (t.status === 'running' || t.status === 'waiting') && (t.kind === 'agent' || !!t.runs))
    const once = (step: string, go: () => unknown) => idleGo.current !== `${idleAsk.at}:${step}` && ((idleGo.current = `${idleAsk.at}:${step}`), void go())
    const off = (why: string) => once('off', () => (toast(why), api.call('updateIdle', { on: false })))
    if (upd.status === 'checking' || upd.status === 'downloading') return
    if (upd.status === 'ready') return void (!busy(idleAsk.by) && once('install', () => bridge!.update!('install')))
    if (upd.latest && upd.status === 'available') return void (upd.install && upd.latest.feed ? once('download', () => bridge!.update!('download')) : off("Laki can't update itself here: Settings › Updates opens the release's page"))
    // an error from before this ask (an earlier check's): looked again first; one from a step of its own stops it
    if (upd.status === 'error') return void (idleGo.current.startsWith(`${idleAsk.at}:`) ? off(`Update when idle stopped: ${upd.error}`) : once('check', () => bridge!.update!('check')))
    if ((upd.checked ?? 0) < idleAsk.at && !upd.latest) return void once('check', () => bridge!.update!('check')) // looked for since it was asked
    if (staleDaemon(view!)) return void (!busy() && once('daemon', () => api.call('shutdown', { keep: true }))) // the new app: main starts the new daemon; keep (R6): the pty host's terminals go on
    off(upd.held ? `Laki ${upd.held.version} waits for your update delay` : 'Laki is up to date')
  }, [idleAsk, upd, view])
  useEffect(() => {
    void bridge?.update?.('state').then(x => setUpd(s => s ?? x)) // an event that came first is newer
    return bridge?.onUpdate?.(s => (setUpd(s), void (s.found && s.latest && toast(`Laki ${s.latest.version} is out`, () => setDialog({ section: 'general', spot: 'Updates' }), "See what's new"))))
  }, [])
  // a rail of kinds (Slack's) beside a list of the one picked; a phone keeps the one drawer
  const rail = !narrow
  const railWords = settings.railLabels !== false // its own setting: words under its icons, or icons only (narrower)
  const railW = railWords ? 68 : 52
  const sideKind: RailKind = rail ? railKind : 'projects' // a phone's drawer, or no rail: one width
  const sideW = sideWs[sideKind] ?? SIDE
  const setSideW = (w: number) => setSideWs(m => ({ ...m, [sideKind]: w }))
  // the start-up snapshot (snapshot.ts): the app's main window keeps its layout on pagehide and every minute; drawn
  // dimmed in place of the splash as it starts again (5 s at most, then the splash)
  const snapUi = useRef<() => void>(() => {})
  snapUi.current = () => {
    const v = viewRef.current
    if (!bridge || !v) return
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(snapshotOf(veiled(v), { sideW, panelW, panelOpen, rail: railKind, railOn: rail, ws: ws?.id, tab: tab?.id })))
    } catch {}
  }
  useEffect(() => {
    if (!bridge) return
    const keep = () => snapUi.current()
    const i = setInterval(keep, 60_000)
    addEventListener('pagehide', keep)
    return () => (clearInterval(i), removeEventListener('pagehide', keep))
  }, [])
  const [snap] = useState(() => {
    try {
      return bridge ? snapOf(localStorage.getItem(SNAP_KEY)) : undefined
    } catch {
      return undefined
    }
  })
  const [snapLate, setSnapLate] = useState(false)
  useEffect(() => void (snap && !view && setTimeout(() => setSnapLate(true), 5000)), [])
  const fromSnap = useRef(false)
  const isTerm = (w: WorkspaceView) => !!w.term || rawKind(w) === 'shells' // a terminal: closed, not deleted
  useEffect(() => void (railOf(railKind) !== railKind && setRailKind('projects')), [railKind, settings.railShells, settings.railBrowsers])
  // the full review (settings.fullReview, FullReview.tsx): the tab bar's first tab while a git workspace has changes
  // (its stat) or an open PR (someone else's under review: no changes of its own, it opens on the PR's; only once its
  // stat is in, so a stopped codespace, never scanned, isn't woken); shown or not per workspace (a session's tab picked
  // leaves it), and the stat and PR head it last showed: its dot, files changed or the PR pushed since
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({})
  const [reviewSeen, setReviewSeen] = useState<Record<string, string>>({})
  const statKey = ws?.stat ? JSON.stringify([ws.stat, (ws.prLinked || !ws.stat.files) && ws.pr?.head]) : '' // FullReview reads again as it moves; the PR's head only where it opens on the PR's diff
  const reviewTab = !!ws && settings.fullReview !== false && git && !!ws.stat && (!!ws.stat.files || ws.pr?.state === 'OPEN') && ws.browser === undefined && !isTerm(ws) && !ws.archived
  const reviewOn = reviewTab && !!reviewing[ws!.id]
  const [reviewTight, setReviewTight] = useState(false) // U6: FullReview's diff had under 480px: the side panel is away until you leave the tab
  useEffect(() => void (reviewOn || setReviewTight(false)), [reviewOn])
  const openReview = () => ws && setReviewing(m => ({ ...m, [ws.id]: true }))
  useEffect(() => void (reviewOn && ws && setReviewSeen(m => (m[ws.id] === statKey ? m : { ...m, [ws.id]: statKey }))), [reviewOn, ws?.id, statKey])
  const lastIn = useRef<Partial<Record<RailKind, string>>>({}) // each kind's last workspace: its rail button goes back there
  useEffect(() => {
    if (!ws || !project) return
    const k = railOf(project.kind)
    lastIn.current[k] = ws.id
    setRailKind(k) // picked anywhere (⌘J, the palette, a link, a new one): its kind's list shows it
  }, [ws?.id, project?.id])
  const railTo = (k: RailKind) => {
    setRailKind(k)
    setDialog(null) // a page over the main area gives way, as a row's click does
    const to = live.find(w => w.id === lastIn.current[k]) ?? order.find(w => kindOf(w) === k)
    if (to) setWsId(to.id)
  }
  useEffect(() => void requestAnimationFrame(fit), [theme, settings.uiFont, settings.sideLook?.labels, settings.fun, settings.videoButton, settings.timerButton, settings.statusBar, sideOpen, !!view, rail]) // a new font, a button more or less (the rail takes two): measured again
  const tracked = Object.keys(USAGE_AGENTS).filter(a => a !== 'gemini' || settings.usage?.[a] === true) // the status bar's plan limits (R4: Gemini's only from its endpoint)
  const geminiModels = [...new Set((view?.tabs ?? []).filter(t => t.preset === 'gemini').flatMap(t => (m => (m ? [m] : []))(t.model ?? view?.presets.find(p => p.name === t.profile)?.model)))] // their quotas first
  // a plan limit past settings.usageAt as Usage.tsx reads them: a toast, and a notification unless you're looking (or
  // notify is off); once per window per reset (laki.limitsTold), told or not as it crosses (seen: each window's last %)
  // ponytail: only while the app is open with the ring on screen; the daemon doesn't watch usage on its own
  const limitsSeen = useRef<Record<string, number>>({})
  const limits = (rows: AgentUsage[]) => {
    const s = viewRef.current?.settings
    const told = load<Record<string, number>>('laki.limitsTold', {})
    const { hits, seen } = limitsCrossed(rows, s?.usageAt ?? USAGE_AT, limitsSeen.current, told)
    limitsSeen.current = seen
    if (!hits.length || s?.notifyOn?.usage === false) return rows
    hits.forEach(h => (told[h.id] = h.w.resets ?? 0))
    store('laki.limitsTold', told)
    const says = hits.map(h => limitText(h, rows))
    if (s?.notify !== false && !document.hasFocus()) says.forEach(t => notify('Plan limit', t, '', () => {}, s?.notifySound))
    toast(says.join('; '))
    return rows
  }
  // ⌘E's: the project's own (Open in's last pick for its folder), else Settings' (the daemon's openIn 'editor' alike)
  const editorOf = (pid?: string) => (pid && settings.editors?.[pid]) || settings.editor || 'cursor'
  const projectOf = (where: Where) => where.project ?? view?.workspaces.find(x => x.id === where.ws)?.project
  const editor = editorOf(project?.id)
  const targets: AppInfo[] = [...apps.filter(a => !a.browser), ...(settings.editorCmd?.trim() ? [{ id: 'custom', name: 'Custom command' }] : [])]
  const editorName = targets.find(a => a.id === editor && a.id !== 'custom')?.name ?? 'editor'
  const openIn = (app: string, where: Where = { ws: ws?.id }) => {
    call('openIn', { ...where, app }).catch(() => {})
    // an editor picked for a project's folder is ⌘E's there from now on (a file's pick is just for it; Settings › Open
    // in keeps the default, and each project's)
    const pid = where.file || where.widget ? undefined : projectOf(where)
    if (pid && EDITOR_IDS.includes(app) && app !== editorOf(pid)) call('settingsSet', { editors: { ...settings.editors, [pid]: app } }).catch(() => {})
  }
  // Open in: every app, ⌘E's first
  const openInItems = (where: Where = { ws: ws?.id }): MenuItem[] =>
    (ed =>
      [...targets]
        .sort((a, b) => Number(b.id === ed) - Number(a.id === ed))
        .map(a => ({ label: a.name, icon: appIcon(a.id), hint: a.id === ed && !where.file ? '⌘E' : undefined, run: () => openIn(a.id, where) })))(editorOf(projectOf(where)))
  // typed into an agent's prompt, unsent: the focused one if it's this workspace's, else its first live one; then its
  // pane gets the keys
  // F14: Always allow in this project (the ask bar's, the Reader's): its command or path as a rule of the project's, as
  // you edit it, then this ask answered Allow
  const alwaysAllow = async (t: TabView) => {
    const p = view?.projects.find(x => x.id === view.workspaces.find(w => w.id === t.workspace)?.project)
    const a = t.ask
    const first = a?.options[0]
    if (!p || !a?.tool || !first) return
    const pattern = await askText(`Always allow ${a.tool} in ${p.name}?`, { text: a.tool === 'Bash' ? 'Any agent here running a command that starts with this (or matches its *) is allowed without asking. Never a risky command (rm -rf, sudo, a force push…), one chained with ; && | or one outside the worktree. Edit or remove it in Settings › the project.' : 'Any agent here doing this to a path that matches it (* and ** as in a glob) is allowed without asking, inside the worktree only. Edit or remove it in Settings › the project.', value: ruleFrom(a), ok: 'Always allow' })
    if (!pattern?.trim()) return
    await call('projectSet', { id: p.id, allow: [...(p.allow ?? []), { tool: a.tool, pattern: pattern.trim(), addedAt: Date.now() }] })
    await call('answer', { tab: t.id, n: first.n, label: first.label }).catch(() => {})
  }
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
    clearTimeout(noteTimer.current)
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
    render: (id, full, sample, cells, ws) => api.call<string | null>('widgetRender', { id, full, ...(sample && { sample }), ...(cells && { cells }), ws }),
    run: (id, ws) => call('widgetRun', { id, ws }),
    open: url => (/^laki:\/\//i.test(url) ? setLink(url) : openExternal(url)),
    copy: text => void copy(text),
    full: (id, at) => (at && setWsId(at), setDialog({ widget: id, back: dialog })), // at: a row mark's workspace, selected first: its instance shows
    close: () => setDialog(d => (d && typeof d === 'object' && 'widget' in d ? (d.back ?? null) : d)), // the full view's (Esc in its frame), not a page's

    action: (id, action, arg, label, ws) => {
      const what = label || action
      clearTimeout(noteTimer.current)
      setNote({ text: `${what}…`, busy: true }) // something is happening, until it says what
      return api.call<{ ok: boolean; out?: string; error?: string; open?: string; send?: string } & WidgetSay>('widgetAction', { id, action, arg, ws }).then(
        r => (!r.ok ? (toast(`${what} failed: ${r.error}`), false as const) : (r.open && widgetApi.open(r.open), r.send && (w => w && void widgetDo(inWs(w, ws ?? null), { do: 'send', prompt: r.send! }, what))(view?.widgets?.find(x => x.id === id)), r.toast || r.modal || r.close ? (setNote(null), widgetApi.say(id, r, ws)) : r.open || r.send ? setNote(null) : done(r.out || `${what}: done`))), // #26: its link opened after it; send: to the agent, asked first
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
  // an extension's tool an agent calls (widgetToolCall): what would run, asked here and as a notification; the first
  // answer counts (widgetToolAnswer), Esc denies. Always: in this workspace from now on, for a tool that asks first
  toolAsk.current = m => {
    if (toolLine.has(m.req)) return // sent again as the socket came back (widgetAsks)
    type Pick = { label: string; allow: 'once' | 'always' | 'deny' }
    const answer = (allow: string) => void api.call('widgetToolAnswer', { req: m.req, allow }).catch(() => {})
    if (m.ev === 'termAsk') {
      // S1: a laki command from a terminal Laki hasn't seen (main.ts' termAsk): yours once you allow it, once per terminal
      const title = 'Allow this terminal to act as you?'
      const picks: Pick[] = [{ label: 'Allow this terminal', allow: 'once' }, { label: 'Deny', allow: 'deny' }]
      notify(title, `${m.cmd} on ${m.tty}`, '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, [])
      toolLine.add({ req: m.req, title, text: `A laki command came from a terminal Laki hasn't seen: ${m.tty}, started by ${m.cmd} (${(m.chain ?? []).join(' ‹ ')}).\n\nAllow it if you just ran laki there. An agent that left its tab looks the same: Deny if you didn't. Asked once per terminal.`, picks, answer: allow => void api.call('termAnswer', { req: m.req, allow: allow === 'once' }).catch(() => {}) })
      return toolShow()
    }
    if (typeof m.perm === 'string') {
      // an extension's agent (its AI source or an AI action, claude -p) asking for a tool it may not use unasked: its
      // input as lines, Always: in its runs from now on (its page lists them)
      const tool = m.perm.replace(/^mcp__(.+?)__(.+)$/, '$2 ($1)')
      const lines = Object.entries((m.input ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}: ${(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 300)}`)
      const title = `${m.name} wants to use ${tool}`
      const picks: Pick[] = [{ label: 'Allow once', allow: 'once' }, { label: `Always for ${m.name}`, allow: 'always' }, { label: 'Deny', allow: 'deny' }]
      // Allow from the notification only when it shows the whole input as it is (noteWhole; a value past 300 is cut, so
      // that one's over too)
      const said = lines.join(' · ')
      notify(title, noteCut(said) || m.perm, '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, !noteWhole(said) ? undefined : picks.map(p => ({ text: p.label, tool: { req: m.req, allow: p.allow } })))
      toolLine.add({ req: m.req, title, text: `${lines.length ? `${lines.join('\n')}\n\n` : ''}Its agent asks while it works in the background. Always: it uses ${m.perm} unasked from now on (Revoke on its page). Deny: it goes on without it.`, picks, answer })
      return toolShow()
    }
    if (m.cross === 'preset') {
      // an agent's laki preset (main.ts' presetAsk): the profile as it would be; once only
      const title = `${m.agent} in ${m.from} wants to ${m.target}`
      const picks: Pick[] = [{ label: 'Allow', allow: 'once' }, { label: 'Deny', allow: 'deny' }]
      // no Allow on the notification: it can't show the profile, and one click could add a mode that never asks
      notify(title, 'Open Laki to see what changes', m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, [])
      toolLine.add({ req: m.req, title, text: `Every tab started on it runs with its args and env.\n\n${m.text}`, picks, answer })
      return toolShow()
    }
    if (m.cross === 'remove') {
      // an agent's laki rm (main.ts' rmAsk): a workspace, a project or a scheduled task; once only, read in the dialog
      const title = `${m.agent} in ${m.from} wants to ${m.target}`
      const picks: Pick[] = [{ label: 'Allow', allow: 'once' }, { label: 'Deny', allow: 'deny' }]
      notify(title, String(m.text ?? ''), m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, [])
      toolLine.add({ req: m.req, title, text: String(m.text ?? ''), picks, answer })
      return toolShow()
    }
    if (m.cross === 'expose') {
      // S7: an agent's Expose to the world (main.ts' exposeAsk): who and how long in the text; once only
      const title = String(m.target ?? 'Expose a port to the world?')
      const picks: Pick[] = [{ label: 'Expose it', allow: 'once' }, { label: 'Deny', allow: 'deny' }]
      notify(title, `${m.agent} in ${m.from} asks`, m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, [])
      toolLine.add({ req: m.req, title, text: `${m.agent} in ${m.from} asks for a public address.\n\n${m.text ?? ''}`, picks, answer })
      return toolShow()
    }
    if (m.cross === 'cmd') {
      // an agent's command in a new terminal tab (main.ts' cmdAsk: laki tab --cmd, laki new --tab): once only
      const title = `${m.agent} in ${m.from} wants to run a command in ${m.to}`
      const picks: Pick[] = [{ label: 'Run it', allow: 'once' }, { label: 'Deny', allow: 'deny' }]
      const cmd = String(m.text ?? '')
      // Run it from the notification only when it shows the whole command (shownWhole); any other is read in the dialog
      notify(title, noteCut(cmd), m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, shownWhole(cmd) ? picks.map(p => ({ text: p.label, tool: { req: m.req, allow: p.allow } })) : [])
      toolLine.add({ req: m.req, title, text: `In a new terminal tab of ${m.to}, as you: the agent's own permission prompts don't see it.\n\n$ ${m.text}`, picks, answer })
      return toolShow()
    }
    if (m.cross) {
      // an agent's send or screen into another workspace's tab (main.ts' crossAsk): what it sends, or that it reads; an
      // event for another workspace (emit): its workflows and extensions run there
      const send = m.cross === 'send'
      const emit = m.cross === 'emit'
      const title = emit ? `${m.agent} in ${m.from} wants to send ${m.target} to ${m.to}` : `${m.agent} in ${m.from} wants to ${send ? 'send to' : 'read'} ${m.target} in ${m.to}`
      const picks: Pick[] = [{ label: 'Allow once', allow: 'once' }, { label: `Always from ${m.from} to ${m.to}`, allow: 'always' }, { label: 'Deny', allow: 'deny' }]
      const said = String(m.text ?? '')
      // Allow from the notification only when it shows all of what goes (shownWhole); any other is read in the dialog
      const whole = !(send || emit) || shownWhole(said)
      notify(title, send || emit ? noteCut(said) : 'what its terminal shows now', m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, whole ? picks.map(p => ({ text: p.label, tool: { req: m.req, allow: p.allow } })) : [])
      toolLine.add({ req: m.req, title, text: `${emit ? `An event: the workflows and extensions listening in ${m.to} would run there, with this:\n\n${m.text}` : send ? `It would send this to ${m.target}:\n\n${m.text}` : `It would read what ${m.target}'s terminal shows now, which may hold what you'd keep in ${m.to}.`}\n\nAlways: until Laki restarts.`, picks, answer })
      return toolShow()
    }
    const where = m.ws ? (view?.workspaces.find(w => w.id === m.ws)?.name ?? m.ws) : ''
    const title = `${m.agent || 'An agent'} wants to run ${m.name}: ${m.action}`
    const input = m.input && Object.keys(m.input).length ? `\n\nInput: ${JSON.stringify(m.input)}` : ''
    const picks: Pick[] = [{ label: 'Allow once', allow: 'once' }, ...(m.ask === 'first' ? [{ label: where ? `Always in ${where}` : 'Always', allow: 'always' } as Pick] : []), { label: 'Deny', allow: 'deny' }]
    // its click: the window, this ask on screen (the one there back in line)
    notify(title, `${m.description}${where ? ` · ${where}` : ''}`, m.tab ?? '', () => toolLine.front(m.req) && toolShow(), settings.notifySound, picks.map(p => ({ text: p.label, tool: { req: m.req, allow: p.allow } })))
    toolLine.add({ req: m.req, title, text: `${m.description}\n\n$ ${m.command}${input}${where ? `\n\nIn ${where}` : ''}`, picks, answer })
    toolShow()
  }
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
    const text = [`${from}${w.changed ? ', and its files changed there since you turned it on' : ''}.`, what.text.replace(/^`{3,}$/gm, '').replace(/\n{3,}/g, '\n\n'), needs.length ? `Its settings: ${needs.join('; ')}.` : '', w.project ? 'It shows and runs only in its workspaces.' : 'It turns off again as its files change.'].filter(Boolean).join('\n\n')
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
  // Settings › Extensions' and the Extension page's: each one's settings, page, folder, logs
  const extCfg: WidgetsApi = {
    list: view?.widgets ?? [],
    ungated: view?.tabs.filter(t => t.ungated).length,
    gateRestart: () => call<{ restarted: number; left: number }>('gateRestart', {}).then(r => (r.left && toast(`${r.left} still at work or asking: restart once idle`), r)),
    home: view?.widgetHome,
    // turned on with a setting it needs still empty: its page, at that field; a repo's (.laki/extensions) shows what
    // it runs first (repoSheet), on only for the files shown
    set: async (id, o) => {
      const rw = view?.widgets?.find(x => x.id === id)
      if (o.on && !o.seen && (rw?.project || rw?.agentDev)) {
        const seen = await repoSheet(rw)
        if (!seen) return
        o = { ...o, seen }
      }
      const r = await call<WidgetView>('widgetSet', { id, ...o })
      if (o.on && r?.missing?.length) setDialog((e => (e?.extension === id ? { extension: id, back: e.back, key: extKey(e), edit: r.missing![0] } : { extension: id, back: dialog, edit: r.missing![0] }))(extOf(dialog))) // its page already: kept (key), not drawn again
      return r
    },
    desk: settings.desk !== false,
    agents: (view?.presets ?? []).filter(p => !p.off && (p.agent === 'claude' || p.agent === 'codex')).map(p => ({ name: p.name, agent: p.agent })),
    agent: settings.widgetAgent,
    run: (id, ws) => call('widgetRun', { id, ws }),
    stop: id => call('resourceStop', { key: `agent:${id}` }),
    // asked first, then the trash: Undo puts it back
    rm: async id => {
      const name = view?.widgets?.find(w => w.id === id)?.name ?? id
      if (!(await ask(`Delete ${name}?`, { text: 'Its folder, settings and data go to the trash, and it stops running. Undo brings it back.', ok: 'Delete', danger: true }))) return
      const r = await call<{ trash: string }>('widgetRm', { id })
      if (r) done(`Deleted ${name}`, () => void call('widgetRestore', { trash: r.trash }))
    },
    // Laki AI's extension chats where you left off: the ones with nothing made yet, and the one at work
    chats: studioOn ? studioChats.filter(c => c.busy || !view?.widgets?.some(w => w.id === c.id)) : [],
    chatRm: async id => {
      if (!(await ask('Delete this session?', { text: 'Its chat with Laki AI goes; nothing was saved of the extension yet.', ok: 'Delete', danger: true }))) return
      await call('studioChatRm', { id })
      setStudioChats(cs => cs.filter(c => c.id !== id))
    },
    reload: () => call('widgetReload'),
    page: id => setDialog({ extension: id, back: dialog }),
    remix: (id: string) => api.call<{ id: string }>('widgetRemix', { id }).then(r => setDialog({ extension: r.id, back: dialog }), e => toast(String(e?.message ?? e), undefined, undefined, false, true)), // a copy to change, on its page
    undo: (id, after) => api.call('widgetUndo', { id, after }),
    tryOnce: (id, ws) => api.call<{ ok: boolean; error?: string }>('widgetRun', { id, once: true, ws }),
    folder: (id, e) => {
      const w = view?.widgets?.find(x => x.id === id)
      openMenu(e, [{ head: 'Open in' }, ...openInItems({ widget: id }), null, { label: 'Copy path', icon: 'copy', key: 'c', run: () => w && copy(w.dir) }])
    },
    allLogs: settings.widgetLogs === true,
    hours: settings.widgetHours,
    logs: id => setDialog({ extension: id, back: extOf(dialog)?.extension === id ? extOf(dialog)!.back : dialog, tab: 'logs' }),
    log: {
      read: (id, o) => api.call<{ on: boolean; lines: WidgetLogLine[]; next: number }>('widgetLogs', { id, ...o }),
      clear: id => api.call('widgetLogClear', { id }),
      reveal: id => void call('openIn', { widget: id, log: true, app: 'finder' }),
    },
    kit: icons => setDialog({ uikit: true, icons, back: dialog }),
    runs: (id, ws) => api.call<WidgetRuns>('widgetRuns', { id, data: true, ws }),
    mock: (id, o) => call('widgetMock', { id, ...o }),
    files: id => api.call<{ files: Record<string, string> }>('widgetFiles', { id }).then(r => r.files),
    save: (id, path, text, was, force) => api.call('widgetFileSave', { id, path, text, was, force }),
    make: kind => api.call<{ id: string }>('widgetNew', { kind, name: kind === 'pullmain' ? 'Pull main' : `My ${kind === 'onefile' ? 'script' : kind}` }).then(r => setDialog({ extension: r.id, back: dialog === 'starters' ? null : dialog }), e => toast(String(e?.message ?? e), undefined, undefined, false, true)), // ⌘K's picker: its page, then nothing behind it
    check: (id, run, ws) => api.call<{ problems: UiProblem[] }>('widgetCheck', { id, run, ws }),
    revoke: (id, action, ws) => api.call('widgetGrantRm', { id, action, ws }),
    wsName: ws => (ws ? (view?.workspaces.find(w => w.id === ws)?.name ?? ws) : 'no workspace'),
  }
  const fontSize = settings.fontSize ?? FONT_SIZE // Settings' size: every tab's, less its own zoom
  // ⌘± zoom the tab with the keyboard (laki.zoom: each tab's points over Settings' size; ⌘0 back to it), a page its own
  // size (below)
  const [zooms, setZooms] = useState<Record<string, number>>(() => (z => (z && typeof z === 'object' && !Array.isArray(z) ? z : {}))(load<unknown>('laki.zoom', {})) as Record<string, number>)
  useEffect(() => void localStorage.setItem('laki.zoom', JSON.stringify(zooms)), [zooms])
  const sizeOf = (id: string) => Math.min(32, Math.max(8, fontSize + (Number(zooms[id]) || 0)))
  const zoom = (d: number) => {
    if (pageKey && document.querySelector('.main > .settings-page')) return zoomPage(d) // a page over the terminals
    if (!tab || dialog) return // a page or dialog over the terminals: not the tab you'd see grow
    const size = d ? Math.min(32, Math.max(8, sizeOf(tab.id) + d)) : fontSize
    if (size === sizeOf(tab.id)) return // as big or as small as it goes, or at Settings' size already
    const { [tab.id]: _, ...rest } = zooms
    setZooms(size === fontSize ? rest : { ...rest, [tab.id]: size - fontSize })
    toast(size === fontSize ? `${tab.name}: Settings' size, ${fontSize}` : `${tab.name}: text ${size} (⌘0: back to ${fontSize})`, undefined, undefined, true)
  }
  const tabIds = view?.tabs.map(t => t.id).join() // closed tabs' zooms go
  useEffect(() => void (view && setZooms(z => (Object.keys(z).every(id => view.tabs.some(t => t.id === id)) ? z : Object.fromEntries(Object.entries(z).filter(([id]) => view.tabs.some(t => t.id === id)))))), [tabIds])
  // Appearance's Pages size: Settings, Help and the list pages, over the terminal font's size they follow
  const pageZoom = PAGE_ZOOMS.includes(settings.pageZoom as number) ? settings.pageZoom! : 1
  // ⌘± on a page: its own size over that, kept per page (laki.pageZooms, by its dialog's kind), as a browser keeps a
  // site's; ⌘0 back to 100%
  const [ownZooms, setOwnZooms] = useState<Record<string, number>>(() => (z => (z && typeof z === 'object' && !Array.isArray(z) ? z : {}))(load<unknown>('laki.pageZooms', {})) as Record<string, number>)
  useEffect(() => void localStorage.setItem('laki.pageZooms', JSON.stringify(ownZooms)), [ownZooms])
  const pageKey = !dialog ? undefined : settingsOf(dialog) ? 'settings' : typeof dialog === 'string' ? dialog : Object.keys(dialog)[0]
  const own = (pageKey && OWN_ZOOMS.includes(ownZooms[pageKey]) && ownZooms[pageKey]) || 1
  const zoomPage = (d: number) => {
    const i = OWN_ZOOMS.indexOf(own)
    const z = d ? OWN_ZOOMS[Math.min(OWN_ZOOMS.length - 1, Math.max(0, i + d))] : 1
    if (!pageKey || z === own) return
    if (document.querySelector(FIXED_PAGE)) return toast('This page keeps its size: its tiles and blocks drag in fixed steps') // styles.css: no zoom there
    setOwnZooms(({ [pageKey]: _, ...rest }) => (z === 1 ? rest : { ...rest, [pageKey]: z }))
    toast(`This page: ${Math.round(z * 100)}%${z === 1 ? '' : ' (⌘0: 100%)'}`, undefined, undefined, true)
  }

  // the sidebar's order: projects, and workspaces and seps within their project, dragged
  const rows = useRowDrag(d => {
    if (d.kind === 'project') return void call('reorder', { projects: moveId(view!.projects.map(p => p.id), d) })
    const p = view!.projects.find(p => p.seps?.some(x => x.id === d.id) || live.some(w => w.id === d.id && w.project === p.id))
    if (!p) return
    const ids = rowsOf(p, view!.workspaces).map(x => x.id) // archived ones too: a restore keeps its place
    // a folded sep takes the workspaces it hides along, up to the next sep
    const at = ids.indexOf(d.id)
    const next = ids.findIndex((x, i) => i > at && !!p.seps?.some(s => s.id === x))
    const many = d.kind === 'ws' && picked.length > 1 && picked.includes(d.id) ? ids.filter(x => picked.includes(x)) : [] // the picked ones of this project, as one
    const moved = many.length > 1 ? moveIds(ids, many, d) : moveId(ids, d, folded.includes(d.id) ? (next < 0 ? ids.length : next) - at : 1)
    call('reorder', { workspaces: moved })
    // a workspace moved within a sorted group: its sort puts it back, so say why it didn't move
    const groupOf = (l: string[]) => l.slice(0, l.indexOf(d.id)).findLast(x => p.seps?.some(s => s.id === x)) ?? ''
    const g = groupOf(ids)
    const sort = p.seps?.find(s => s.id === g)?.sort ?? p.sort ?? 'manual'
    if (!p.seps?.some(s => s.id === d.id) && sort !== 'manual' && g === groupOf(moved)) toast(`Sorted ${SORTS.find(x => x[0] === sort)![1].toLowerCase()}: the ${g ? 'group' : 'project'}'s ⋯ › Sort workspaces › As dragged keeps the order you drag`)
    if (d.into && folded.includes(d.target)) fold(d.target) // dropped into a folded group: it opens, to show it there
  })
  // Sort workspaces: a project's (unset: as dragged), or a group's (unset: the project's, its own way named)
  const SORTS: [WsSort, string][] = [['manual', 'As dragged'], ['created', 'Newest first'], ['activity', 'Last active first'], ['name', 'By name']]
  const sortItems = (cur: WsSort | undefined, pick: (s: WsSort | undefined) => void, inherit?: WsSort): MenuItem[] => [
    {
      label: 'Sort workspaces',
      icon: 'sort',
      hint: cur ? SORTS.find(x => x[0] === cur)![1].toLowerCase() : inherit ? 'like the project' : undefined,
      items: [
        ...(inherit ? [{ label: `Like the project (${SORTS.find(x => x[0] === inherit)![1].toLowerCase()})`, icon: 'sort', hint: cur ? undefined : ON, run: () => pick(undefined) } as MenuItem] : []),
        ...SORTS.map(([k, label]) => ({ label, icon: 'sort', hint: (cur ?? (inherit ? undefined : 'manual')) === k ? ON : undefined, run: () => pick(k) }) as MenuItem),
      ],
    },
  ]

  // the foot's timer button: a new one, for a length
  const startMenu = (): MenuItem[] => [
    { head: 'Start a timer' },
    ...MINUTES.map(m => ({ label: span(m * 60000), icon: 'timer', run: () => addTimer(m * 60000) }) as MenuItem),
    { label: 'Other length, a message or a command…', icon: 'pencil', key: 'o', run: () => setDialog('timer') },
    { label: 'Important timer…', icon: 'alertCircle', key: 'i', tip: 'As it ends, a card at the bottom right over every app, until you close it', run: () => setDialog('importantTimer') },
    null,
    { label: 'Stopwatch', icon: 'clock', key: 's', run: () => setWatches(l => [...l, { id: Math.random().toString(36).slice(2, 10), ms: 0, from: Date.now() }]) },
  ]

  // right click on a workspace in the sidebar
  // a delayed start (wsNew startAt): its agent now, at another time (when.ts parseAt's words, or limit), or never
  const laterNow = (w: WorkspaceView) => void call('wsSet', { id: w.id, start: true }).catch(() => {})
  const laterChange = async (w: WorkspaceView) => {
    const t = (await askText(`When should ${w.pending?.agent ?? 'its agent'} start?`, { text: 'tomorrow 9am, in 2h, 2026-10-20 14:30, or limit: after the plan limit resets', value: w.pending?.limit ? 'limit' : '', ok: 'Change' }))?.trim()
    if (!t) return
    const at = /^(after )?(the )?(plan )?limit/i.test(t) ? ('limit' as const) : parseAt(t)
    if (typeof at === 'object') return toast(at.error)
    call('wsSet', { id: w.id, pending: { at } }).then(() => done(pendingWords({ at: at === 'limit' ? undefined : at, limit: at === 'limit', agent: '' }, true)), () => {})
  }
  const laterCancel = (w: WorkspaceView) => call('wsSet', { id: w.id, pending: null }).then(() => done(`${w.pending?.agent ?? 'Its agent'} won't start in ${wsName(w)}`), () => {})
  const detachPr = (w: WorkspaceView) => void call('prDetach', { ws: w.id }).then(() => done(w.prLinked ? 'Only related now: its own PR, once opened, is its PR' : `PR #${w.pr?.number ?? ''} detached: only related`), () => {}) // call toasts a failure

  // Move to group ›, a submenu: a workspace into one of its project's groups (first in it, as a drop on its head), or out
  // of its group (last before the first one); no groups: nothing (they're made from the project's ⋯)
  // Move to group: a workspace's, or several picked ones of one project (groupMoves: [] when they aren't)
  const groupMoves = (ws_: WorkspaceView[]): MenuItem[] => {
    const p = view?.projects.find(p => p.id === ws_[0]?.project)
    if (!p?.seps?.length || ws_.some(w => w.project !== p.id)) return []
    const ids = rowsOf(p, view!.workspaces).map(x => x.id)
    const seps = p.seps ?? []
    const isSep = (x: string) => seps.some(s => s.id === x)
    const groupOf = (id: string) => ids.slice(0, ids.indexOf(id)).reverse().find(isSep)
    const inSep = ws_.length === 1 ? groupOf(ws_[0].id) : undefined
    const to = (target: string, into: boolean) => {
      call('reorder', { workspaces: moveIds(ids, ws_.map(w => w.id), { kind: 'ws', id: ws_[0].id, target, after: into, into }) }).catch(() => {})
      if (into && folded.includes(target)) fold(target) // as a drop does: it opens, to show it there
    }
    return [
      ...seps.filter(s => s.id !== inSep).map(s => ({ label: s.name || 'Unnamed group', icon: 'sep', run: () => to(s.id, true) }) as MenuItem),
      ...(ws_.some(w => groupOf(w.id)) ? [{ label: 'Out of its group', icon: 'minus', run: () => to(ids.find(isSep)!, false) } as MenuItem] : []),
    ]
  }
  // Run workflow ›: the project's workflows and yours, a pick its Run sheet in this workspace (Workflows on; not a
  // terminal's, a browser's, a host's or an archived one)
  const flowsHere = (w: WorkspaceView) => flowItems.filter(f => f.source === 'yours' || f.project === w.project)
  const flowMenu = (w: WorkspaceView): MenuItem[] =>
    !flowsOn || rawKind(w) !== 'projects' || w.term || w.host || w.archived || view?.projects.find(p => p.id === w.project)?.config?.workflows !== true // its project's Applicable for Workflows (off unless on)
      ? []
      : (l => [{ label: 'Run workflow', icon: 'flow', key: 'w', items: l.length ? l.map(f => ({ label: f.name, sub: f.problems[0] ?? (f.source === 'project' ? 'the project’s' : 'yours'), icon: 'flow', ...(f.problems.length && { tone: 'warn' as const }), run: () => runFlow(f, w.id) }) as MenuItem) : [{ label: 'New workflow…', icon: 'plus', run: () => setDialog({ workflows: '' }) }] }])(flowsHere(w))
  const runFlow = (f: WorkflowItem, ws?: string) => setDialog({ workflows: '', start: { id: f.id, source: f.source, project: f.project, ws, at: Date.now() } })
  // a git workspace on a branch with no PR found: one can be attached by hand (prAttach)
  const attachable = (w: WorkspaceView) => !w.pr && !!w.branch && !w.term && view?.projects.find(p => p.id === w.project)?.git !== false
  // the status bar's branch, short: Laki's prefix (Settings › Git & worktrees) off
  const shortBranch = (b: string, pre = settings.branchPrefix?.trim() || 'laki/') => (b.startsWith(pre) ? b.slice(pre.length) : b)
  // a workspace for the info panel and the status bar's PR
  const cfgOf = (w: WorkspaceView) => view?.projects.find(p => p.id === w.project)?.config
  const allows = (w: WorkspaceView, k: 'approve' | 'close' | 'merge' | 'land' | 'revert') => prAllows(cfgOf(w), k)
  const infoOf = (w: WorkspaceView, cfg = cfgOf(w)): WsInfo => {
    const live = (id?: string) => view?.workspaces.find(x => x.id === id && !x.archived)
    const from = live(w.from)
    return {
      ...w,
      checking: checking === `merge:${w.id}`,
      from: from && { id: from.id, name: wsName(from), tab: creatorOf(w, view?.tabs ?? []) },
      started: view?.workspaces.filter(x => x.from === w.id && !x.archived).map(x => ({ id: x.id, name: wsName(x) })),
      allow: { approve: prAllows(cfg, 'approve'), close: prAllows(cfg, 'close'), merge: prAllows(cfg, 'merge'), land: prAllows(cfg, 'land'), revert: prAllows(cfg, 'revert') && hasCap(view, 'pr.revert') },
      method: cfg?.mergeMethod,
      ...(w.fix?.pr === w.pr?.number && { fixTries: w.fix?.tries, mergeTries: w.fix?.merges }), // this PR's counts only
      prScan: settings.prScan || PR_SCAN,
      prQuiet: Math.max(settings.prQuiet || PR_QUIET, settings.prScan || PR_SCAN),
      prTries: settings.prTries || PR_TRIES,
    }
  }
  // merge when green, and fix CI on a fork's PR: asked as it's turned on
  const setAuto = async (w: WorkspaceView, k: AutoKey, v: boolean) => {
    if (k === 'autoFix' && v && (w.fork || w.pr?.cross) && !(await ask(`Fix CI on ${w.pr ? `PR #${w.pr.number}` : 'this PR'}, from a fork?`, { text: "Its failing checks' logs go to the agent, and they're output of code someone outside the repo wrote: they can say anything. The agent is told they're data, not instructions; read what it does.", ok: 'Fix CI' }))) return
    if (k === 'autoLand' && v && !(await ask(`Merge ${w.pr ? `PR #${w.pr.number}` : 'the PR'} when it's green?`, { text: `Laki will ${MERGE_WORDS[cfgOf(w)?.mergeMethod ?? 'squash'].toLowerCase()} it as you and delete its branch on GitHub, once every check passes, it has no conflicts, isn't a draft, is approved if the repo asks for a review and its agent isn't working.`, ok: 'Merge when green' }))) return
    call('wsSet', { id: w.id, [k]: v }).catch(() => {})
  }
  // job: only that check's (its Log's Send to the agent); whether it went
  const prFix = (w: WorkspaceView, what: FixWhat, job?: string) => call('prFix', { ws: w.id, what, job }).then(() => (toast('Sent to the agent'), true), () => false)
  const ciLog = (w: WorkspaceView, c: Check) => (job => (job ? setDialog({ ciLog: w.id, job, name: c.name, url: c.url }) : c.url && openExternal(c.url)))(jobOf(c.url)) // other CI: its page
  // GitHub asked again now, not at the next scan (every settings.prScan minutes)
  const refreshPR = () => call('prRefresh').then(() => done('PR status: fresh from GitHub'), () => {})
  // the PR section's Labels: the repo's, and one put on or taken off (gh pr edit, as you)
  const labelApi = (w: WorkspaceView): LabelApi => ({
    list: () => call<PRLabel[]>('prLabels', { ws: w.id }),
    set: (label, on) => void call('prLabel', { ws: w.id, label, on }).then(() => done(on ? `Labeled PR #${w.pr?.number}: ${label}` : `Took ${label} off PR #${w.pr?.number}`), () => {}),
  })
  // right click on the status bar's PR
  // Approve / Close / Merge: gh as you, once you say so (merge: the checks and review in the question, and whether
  // GitHub deletes the branch)
  // what a PR action's question shows, as a delete's: the PR's author, branches, size, checks, reviews, conflicts, labels
  const prFacts = (w: WorkspaceView): Fact[] => {
    const pr = w.pr!
    const said = [pr.approved?.length && `approved by ${pr.approved.join(', ')}`, pr.changes?.length && `changes asked by ${pr.changes.join(', ')}`].filter(Boolean)
    const told = (pr.review === 'APPROVED' && pr.approved?.length) || (pr.review === 'CHANGES_REQUESTED' && pr.changes?.length) // the names say the decision
    const review = [told ? '' : (pr.review && REVIEW[pr.review]) || (said.length ? '' : 'none needed'), ...said].filter(Boolean).join(', ')
    // each in its tone (the icon's color): green what's fine, amber what to look at, red what's wrong
    const checks: Pick<Fact, 'icon' | 'tone'> = pr.checks === 'pass' ? { icon: 'checkCircle', tone: 'ok' } : pr.checks === 'fail' ? { icon: 'ciFail', tone: 'bad' } : pr.checks === 'pending' ? { icon: 'clock', tone: 'warn' } : { icon: 'alertCircle', tone: 'warn' }
    return [
      pr.author && { label: 'Author', icon: 'user', value: `${pr.author}${pr.mine ? ' (you)' : ''}` },
      { label: 'Branch', icon: 'gitBranch', value: `${w.branch || '?'} → ${pr.base ?? 'its base'}${pr.cross ? ' (from a fork)' : ''}` },
      pr.additions !== undefined && { label: 'Size', icon: 'diff', value: <><span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions ?? 0}</span></> },
      { label: 'Checks', ...checks, value: ciText(pr) },
      { label: 'Review', icon: 'eye', tone: pr.review === 'APPROVED' ? 'ok' : pr.review === 'CHANGES_REQUESTED' ? 'bad' : pr.review === 'REVIEW_REQUIRED' ? 'warn' : undefined, value: review },
      pr.conflict && { label: 'Conflicts', icon: 'conflict', tone: 'bad', value: `merge conflicts with ${pr.base ?? 'its base'}` },
      pr.ready === false && !pr.conflict && { label: 'GitHub', icon: 'alertCircle', tone: 'warn', value: "wouldn't merge it now: blocked, behind or unstable" },
      pr.draft && { label: 'Draft', icon: 'pencil', tone: 'warn', value: 'still a draft' },
      pr.labels?.length && { label: 'Labels', icon: 'tag', value: pr.labels.map(l => l.name).join(', ') },
      pr.updated && { label: 'Updated', icon: 'clock', value: ago(pr.updated) },
    ].filter(Boolean) as Fact[]
  }
  // what a merge comes to, over its facts: the worst first
  const mergeVerdict = (pr: NonNullable<WorkspaceView['pr']>): Verdict =>
    pr.conflict ? { tone: 'bad', text: `Conflicts with ${pr.base ?? 'its base'}: GitHub won't merge it` }
    : pr.checks === 'fail' ? { tone: 'bad', text: 'Its checks fail' }
    : pr.review === 'CHANGES_REQUESTED' ? { tone: 'bad', text: 'Changes were asked for' }
    : pr.checks === 'pending' ? { tone: 'warn', text: 'Its checks still run' }
    : pr.checks === 'cancelled' ? { tone: 'warn', text: 'Its checks were cancelled' }
    : pr.draft || pr.ready === false ? { tone: 'warn', text: pr.draft ? 'Still a draft' : "GitHub wouldn't merge it now" }
    : pr.review === 'REVIEW_REQUIRED' ? { tone: 'warn', text: 'A review is required first' }
    : !pr.checks ? { tone: 'warn', text: 'No checks ran on it: nothing tested it' }
    : { tone: 'ok', text: 'Checks pass, no conflicts' }
  const prAct = async (w: WorkspaceView, act: PRAct, method: MergeMethod = cfgOf(w)?.mergeMethod ?? 'squash') => {
    const pr = w.pr
    if (!pr) return
    if (act === 'draft') return prDraft(w)
    // a merged one undone: a new PR that reverts it, then (if you like) a workspace on it, to merge it or fix forward
    if (act === 'revert') {
      if (!(await ask(`Revert ${prName(pr)}?`, { text: `${pr.title ?? ''}\nOpens a new ${pr.forge === 'gitlab' ? 'merge request' : 'pull request'} on ${forgeName(pr)} that undoes it. Nothing is merged until you merge that one.`.trim(), facts: prFacts(w), ok: 'Open the revert' }))) return
      const r = await call<{ pr: { number: number; url: string; title: string } }>('prAct', { ws: w.id, act }).catch(() => null)
      if (!r) return
      const lab = pr.forge === 'gitlab' // ponytail: no workspace from an MR yet (wsNew's pr is gh's): its page only
      const how = await choose(`Opened ${prNo({ ...pr, number: r.pr.number })}: ${r.pr.title}`, lab ? undefined : 'Open it as a workspace, to merge it or have an agent fix forward from there?', [{ label: 'Not now' }, { label: `Open on ${forgeName(pr)}`, primary: lab }, ...(lab ? [] : [{ label: 'New workspace', primary: true }])])
      if (how === 1) openExternal(r.pr.url)
      else if (how === 2) void call('wsNew', { project: w.project, pr: r.pr.url, preset: settings.agent ?? 'claude' }).catch(() => {})
      return
    }
    if (act === 'merge') {
      const del = { label: `Delete the branch on ${forgeName(pr)}`, on: true }
      const verb = { squash: 'Squash-merge', merge: 'Merge', rebase: 'Rebase-merge' }[method]
      if ((await choose(`${verb} ${prName(pr)} into ${pr.base ?? 'its base'}?`, pr.title, [{ label: 'Cancel' }, { label: MERGE_WORDS[method], primary: true }], del, undefined, prFacts(w), mergeVerdict(pr))) !== 1) return
      return gated(w, 'merge', force => call('prAct', { ws: w.id, act, method, deleteBranch: del.on, force }).catch(() => undefined)).then(r => r !== undefined && toast(`Merged ${prName(pr)}`, undefined, undefined, true))
    }
    const close = act === 'close'
    if (!(await ask(close ? `Close ${prName(pr)}?` : `Approve ${prName(pr)}?`, { text: [pr.title, close && `Without merging; it can be reopened on ${forgeName(pr)}.`].filter(Boolean).join('\n'), facts: prFacts(w), ok: close ? (pr.forge === 'gitlab' ? 'Close merge request' : 'Close pull request') : 'Approve', danger: close }))) return
    call('prAct', { ws: w.id, act }).then(() => toast(close ? `Closed ${prName(pr)}` : `Approved ${prName(pr)}`, undefined, undefined, true), () => {})
  }
  // the waiting tabs of the workspaces this tab's agent started (fromTab), for its pane's foot (WorkerAsks)
  const workerAsks = (tab: string) => {
    const mine = view?.workspaces.filter(w => w.fromTab === tab && !w.archived) ?? []
    return mine.flatMap(w => (view?.tabs ?? []).filter(t => t.workspace === w.id && t.status === 'waiting').map(t => ({ ws: w.id, name: wsName(w), tab: t })))
  }
  const prDraft = (w: WorkspaceView) => {
    const pr = w.pr
    if (pr) call('prDraft', { ws: w.id, draft: !pr.draft }).then(() => toast(pr.draft ? `${prName(pr)} is ready for review` : `${prName(pr)} is a draft`, undefined, undefined, true), () => {})
  }
  const prMenu = (w: WorkspaceView, F = forgeName(w.pr), K = w.pr?.forge === 'gitlab' ? 'MR' : 'PR'): MenuItem[] => [ // F, K: GitHub's PR or GitLab's MR
    { label: `Refresh from ${F}`, icon: 'refresh', key: 'r', tip: 'Reads its checks, reviews and state again now', run: refreshPR },
    ...(w.pr
      ? [
          { label: `Open the ${K}`, icon: 'link', key: 'o', run: () => openExternal(w.pr!.url) } as MenuItem,
          { label: 'Open its checks', icon: 'link', key: 'c', tip: `Its CI checks on ${F}`, run: () => openExternal(`${w.pr!.url}/${w.pr!.forge === 'gitlab' ? 'pipelines' : 'checks'}`) } as MenuItem,
          { label: `Copy ${K} link`, icon: 'copy', key: 'l', run: () => copy(w.pr!.url) } as MenuItem,
          ...(bridge?.share ? [{ label: 'Share…', icon: 'share', tip: `macOS's Share menu with its link: Messages, Mail, AirDrop`, run: () => bridge!.share!(w.pr!.url) } as MenuItem] : []), // U15; off macOS: Copy link
          { label: `Copy ${prNo(w.pr)}`, icon: 'copy', key: 'n', run: () => copy(prNo(w.pr!)) } as MenuItem,
        ]
      : []),
    ...(w.pr?.state === 'OPEN'
      ? [
          null,
          ...(allows(w, 'merge') && !w.pr.draft ? [{ label: `${MERGE_WORDS[cfgOf(w)?.mergeMethod ?? 'squash']}…`, icon: 'pr', key: 'm', tip: `Merges it on ${F}, after you confirm`, run: () => prAct(w, 'merge') } as MenuItem] : []),
          ...(w.pr.mine || !allows(w, 'approve') ? [] : [{ label: 'Approve…', icon: 'check', key: 'a', good: true, tip: `Approves it on ${F} as you, after you confirm`, run: () => prAct(w, 'approve') } as MenuItem]),
          { label: w.pr.draft ? 'Ready for review' : 'Convert to draft', icon: w.pr.draft ? 'eye' : 'pencil', key: 'f', tip: w.pr.draft ? `Out of draft on ${F}: reviewers are asked` : `Back to a draft on ${F}: it went ready too early`, run: () => prDraft(w) } as MenuItem,
          ...(allows(w, 'close') ? [{ label: `Close ${K}…`, icon: 'x', danger: true, tip: `Closes it on ${F} without merging, after you confirm`, run: () => prAct(w, 'close') } as MenuItem] : []),
        ]
      : []),
    ...(w.pr?.state === 'MERGED' && allows(w, 'revert') && hasCap(view, 'pr.revert') ? [null, { label: `Revert ${K}…`, icon: 'undo', key: 'v', tip: `A new ${K} on ${F} that undoes this one, after you confirm`, run: () => prAct(w, 'revert') } as MenuItem] : []),
    ...(w.pr ? [null, { label: `Detach ${prName(w.pr)}`, icon: 'unlink', key: 'd', sub: 'Only related, kept off this workspace (Attach a PR brings it back)', run: () => detachPr(w) } as MenuItem] : []),
  ]

  // right click on a tab (or a pane header: one session)
  // Reader view (Reader.tsx): a claude or codex tab as its chat; a phone opens them so, else the terminal
  const readerOn = settings.reader !== false
  const inReader = (id: string) => byId(id)?.preset === 'acp' || (readerOn && readable(byId(id)) && (readMode[id] ?? (narrow ? 'reader' : 'term')) === 'reader') // an ACP agent's tab has no terminal to show
  const setRead = (id: string, m: 'reader' | 'term') => setReadMode(o => ({ ...o, [id]: m }))
  // U2: Terminal | Reader, in the pane's header (split panes) or the tab bar (one pane): never over the terminal's lines
  const readSwitch = (id?: string) =>
    id && readerOn && readable(byId(id)) && byId(id)?.preset !== 'acp' ? (
      <div className="reader-switch capsule nodrag" role="group" aria-label="Show it as">
        <button className={inReader(id) ? '' : 'on'} aria-pressed={!inReader(id)} onClick={() => setRead(id, 'term')}>Terminal</button>
        <button className={inReader(id) ? 'on' : ''} aria-pressed={inReader(id)} onClick={() => setRead(id, 'reader')}>Reader</button>
      </div>
    ) : null
  const onePane = !group || tabsOf(group).length < 2
  const readerApi: ReaderApi = {
    dismiss: tab => call('failDismiss', { tab }),
    draft: (tab, text) => api.call('tabDraft', { tab, text }),
    setMode: (tab, mode) => call('tabMode', { tab, mode }),
    read: (tab, v) => api.call('chatRead', { tab, v }),
    keys: (tab, data) => void api.call('input', { tab, data }).catch(() => {}), // ←/→ between its questions
    bgOutput: (tab, id) => api.call('bgOutput', { tab, id }),
    appCall: (tab, id, name, args) => api.call('mcpAppCall', { tab, id, name, arguments: args }),
    send: (tab, text) => call('send', { target: tab, text, whenIdle: true, steer: true }),
    // F6: a shell block's command into a new shell tab of the workspace, typed and not run: the tab shows, ⏎ there
    // runs it (several lines: one paste, typeInto waits for the new shell's bracketed paste). same (⌥-click): into its
    // last shell tab at its prompt (one running a program would take it as that program's keys), a new one when none
    run: async (t, text, same) => {
      const sh = (same && viewRef.current?.tabs.findLast(x => x.workspace === t.workspace && x.kind === 'shell' && x.status === 'idle' && !x.runs)) || (await call<TabView>('tabNew', { ws: t.workspace, preset: 'shell' }).catch(() => null))
      if (!sh) return
      await call('send', { target: sh.id, text, enter: false }).catch(() => {})
      selectTab(sh)
    },
    mentions: t => mentionsOf(viewRef.current, t.workspace), // @ in its box: your other workspaces, your projects
    proof: t => (p => (p?.tab === t.id ? p : undefined))(view?.workspaces.find(w => w.id === t.workspace)?.proof), // the Proof card: its last checked turn's
    openProof: (t, path) => openFile({ ws: t.workspace, path, storage: true }),
    ...(!view?.managed?.allowRules && { alwaysAllow: t => void alwaysAllow(t).catch(() => {}) }),
    answer: (tab, n, label) => void call('answer', { tab, n, label }).catch(() => {}), // label: a menu changed meanwhile (the next of several questions) isn't answered by it (call's toast says so)
    review: () => ((turnNext.on = true), window.dispatchEvent(new CustomEvent('laki-scope', { detail: 'turn' })), showPanel('changes')), // Changes open already: the event; else turnNext as it mounts
    undo: t =>
      void ask(`Undo ${t.name}'s last turn?`, { text: `${t.changes!.n} file${t.changes!.n === 1 ? '' : 's'} back as they were before it: ${t.changes!.files.slice(0, 4).map(f => f.path).join(', ')}${t.changes!.n > 4 ? '…' : ''}. Files it made are removed. Nothing is committed.`, ok: 'Undo', danger: true }).then(ok => void (ok && call<{ files: number }>('turnUndo', { tab: t.id }).then(r => done(`${r.files} file${r.files === 1 ? '' : 's'} back as before the turn`), () => {}))),
  }
  // F1: a kept turn's menu (TurnStrip): its diff in Changes, the files back to before it, a workspace from it
  const turnApi = (ws: string): TurnApi => ({
    list: tab => api.call<TurnKept[]>('turnList', { tab }),
    show: t => ((turnNext.on = true), (turnNext.n = t.n), window.dispatchEvent(new CustomEvent('laki-scope', { detail: 'turn' })), window.dispatchEvent(new CustomEvent('laki-turn', { detail: t.n })), showPanel('changes')),
    rewind: t =>
      ask(t.rewind ? `Undo the rewind to before turn ${t.rewind}?` : `Rewind files to before turn ${t.n}?`, { text: `${t.rewind ? 'The files go back to what they were before you rewound.' : `Every file goes back to what it was before "${t.prompt ?? `turn ${t.n}`}": this turn's changes, later turns' and your own edits since.`} What's there now is kept as a turn of its own, so this can be undone. Files only: not installs, migrations, pushes or what git ignores. Nothing is committed.`, ok: t.rewind ? 'Undo the rewind' : 'Rewind', danger: true }).then(
        ok => (ok ? call<{ files: number }>('turnRewind', { ws, n: t.n }).then(r => done(r.files ? `${r.files} file${r.files === 1 ? '' : 's'} back as ${t.rewind ? 'before the rewind' : `before turn ${t.n}`}` : 'The files are that way already')) : undefined),
      ),
    fork: t => void call<WorkspaceView>('turnFork', { ws, n: t.n }).then(w => showNew(w.id), () => {}),
  })
  const restore = (id: string) => call('wsRestore', { id }).then(() => showNew(id))
  const newWs = (projectId?: string, init?: Partial<NewWsParams>) => {
    setNewFor(projectId)
    setNewInit(init) // a sep's place, or none: not the one the page was opened with before
    setDialog('new')
  }

  // the native folder picker, then straight to a workspace in that project (the web dev renderer has
  // no picker: it gets the typed-path dialog)
  const openProject = async () => {
    if (!bridge) return setDialog('project')
    const path = await bridge.pickFolder()
    if (!path) return
    const p = await call<Project>('projectAdd', { path }).catch(() => null) // the toast says why
    if (p) newWs(p.id)
  }
  // Browsers workspaces opened since the app started: their pages stay loaded (hidden) as you move between them
  const [browsed, setBrowsed] = useState<string[]>([])
  useEffect(() => {
    if (ws?.browser !== undefined && !browsed.includes(ws.id)) setBrowsed(b => [...b, ws.id])
  }, [ws?.id])
  // Settings › Resources' Stop on a browser: the pages you aren't on unloaded (each loads again as you open it)
  const wsNow = useRef(ws?.id)
  wsNow.current = ws?.id
  useEffect(() => {
    const f = (e: Event) => (e as CustomEvent).detail === 'browsers' && setBrowsed(b => b.filter(id => id === wsNow.current))
    window.addEventListener('laki-stop', f)
    return () => window.removeEventListener('laki-stop', f)
  }, [])
  // Settings › Resources' memory budget (shared/browserBudget.ts): over it, the oldest hidden page nothing holds is unloaded,
  // the way Stop does; opening it loads its saved address. budgetSaid: why nothing could be, for that page
  const guests = useRef(new Map<string, number>())
  const usedAt = useRef(new Map<string, number>())
  const budgetSaid = useRef('')
  useEffect(() => {
    if (ws?.browser !== undefined) usedAt.current.set(ws.id, Date.now())
  }, [ws?.id])
  const browserBudget = view?.settings.browserBudget ?? 0
  useEffect(() => {
    budgetSaid.current = ''
    if (!browserBudget || !bridge?.browserMem || !bridge.browserGuard) return
    let busy = false
    let on = true
    const step = async () => {
      if (busy) return
      busy = true
      const r = await unloadStep({ budgetMb: browserBudget, guests: guests.current, used: usedAt.current, current: () => wsNow.current, mem: bridge!.browserMem!, guard: bridge!.browserGuard! }).catch(() => null)
      busy = false
      if (!on) return
      if (r?.unload) setBrowsed(b => b.filter(id => id !== r.unload))
      const name = (id: string) => (w => (w ? wsName(w) : id))(viewRef.current?.workspaces.find(w => w.id === id))
      budgetSaid.current = r?.over && !r.unload ? `Over budget, nothing to unload: ${r.held.map(h => `${name(h.ws)} ${h.why}`).join('; ') || 'the pages left are the ones you used last'}` : ''
    }
    const t = setInterval(() => void step(), 15000)
    return () => ((on = false), clearInterval(t))
  }, [browserBudget])
  // a page's address and title: the workspace's (its sidebar name), once it settles
  const pageTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pageSeen = (id: string, url: string, title: string) => {
    clearTimeout(pageTimers.current[id])
    pageTimers.current[id] = setTimeout(() => void api.call('wsSet', { id, browser: url, ...(title.trim() && { name: title, auto: true }) }) /* auto: not over a name you gave it */.catch(() => {}), 400)
  }
  // Get started (panels.tsx Onboarding): shown once as Laki opens (seen), its steps done by hand (done) or by
  // themselves (onboardDone, kept as they happen); off: Don't show again, and no bar at the sidebar's foot
  const [onboard, setOnboard] = useState<{ done: string[]; seen?: boolean; off?: boolean }>(() => load('laki.onboard', { done: [] }))
  useEffect(() => store('laki.onboard', onboard), [onboard])
  const [seenSecs, setSeenSecs] = useState<string[]>([]) // Settings' sections opened since the app started
  const onboardDone = new Set([
    ...onboard.done,
    ...(view?.projects.some(p => !p.kind) ? ['project'] : []),
    ...(view?.workspaces.some(w => !w.archived && !view.projects.find(p => p.id === w.project)?.kind) ? ['workspace'] : []),
    ...(seenSecs.length ? ['settings'] : []),
    ...['actions', 'templates', 'presets', 'remote'].filter(x => seenSecs.includes(x)),
    ...(view?.workspaces.some(w => w.codespace !== undefined) ? ['experimental'] : []), // a codespace made; else seen through Go (below)
    ...(view?.widgets?.some(w => w.on) ? ['widgets'] : []), // an extension turned on, not the section only looked at
    ...(view?.projects.some(p => p.kind) ? ['shell'] : []),
    ...(((panelShown && panelTab === 'changes') || reviewOn) && ws?.stat && (ws.stat.files > 0 || ws.stat.dirty > 0) ? ['changes'] : []), // U3: a diff looked at
  ])
  // U3: the loop's steps a call does: an answer, a ship or an archive (achievements off or on)
  useEffect(() => api.onCall(method => (id => id && setOnboard(o => (o.done.includes(id) ? o : { ...o, done: [...o.done, id] })))(method === 'answer' ? 'answer' : method === 'ship' || method === 'wsArchive' ? 'ship' : '')), [])
  const onboardKey = [...onboardDone].sort().join()
  useEffect(() => {
    if (view && onboardDone.size > onboard.done.length) setOnboard(o => ({ ...o, done: [...onboardDone] })) // kept: a project removed later doesn't undo it
  }, [onboardKey])
  // what Get started ticks (a project there, a workspace, Settings seen) its achievement has too, quietly (no toast: it
  // was done before): the two lists agree
  useEffect(() => {
    const a = achRef.current
    if (!view || a.off) return
    const ids = [...onboardDone].filter(id => !a.got?.[id] && !a.hidden?.includes(id) && ACHIEVEMENTS.some(x => x.id === id && x.group === 'Getting started')) // the same step in both: a project, a workspace, Settings
    if (ids.length) achSet({ got: { ...a.got, ...Object.fromEntries(ids.map(id => [id, Date.now()])) } }).catch(() => {})
  }, [onboardKey, !!view])
  // ⌘F: a diff's find bar (Diff.tsx DiffFind) when the pointer was last in one (Changes, the full review), or the full
  // review covers the terminals; else the terminal's
  const lastDown = useRef<Element | null>(null)
  useEffect(() => {
    const f = (e: PointerEvent) => void (lastDown.current = e.target as Element)
    window.addEventListener('pointerdown', f, true)
    return () => window.removeEventListener('pointerdown', f, true)
  }, [])
  const findIn = () => {
    const last = lastDown.current?.closest?.<HTMLElement>('[data-find]')
    const host = last?.isConnected && last.offsetParent ? last : reviewOn ? document.querySelector<HTMLElement>('.full-review[data-find]') : null
    host?.dispatchEvent(new Event('laki-find'))
    return !!host
  }
  // U3: Get started never opens by itself: its bar at the sidebar's foot (from the first launch) does, ⌘K, laki://onboard
  // the workflows a workspace's Run workflow › and ⌘K offer: again as a file changes (Workflows on). Once the first view
  // is in (the socket is open: Workflows are on before the settings come), and quietly: a list in the background
  const [flowItems, setFlowItems] = useState<WorkflowItem[]>([])
  useEffect(() => void (flowsOn && view ? api.call<WorkflowItem[]>('flowList', {}).then(l => setFlowItems(l.filter(f => f.source !== 'builtin')), () => {}) : setFlowItems([])), [flowsOn, !view, view?.flowFiles])
  // a page seen ticks its step: Scheduled tasks, Workflows, Settings opened at Experimental
  useEffect(() => {
    const id = schedulesOf(dialog) !== undefined ? 'schedules' : flowsOf(dialog) ? 'workflows' : dialog && typeof dialog === 'object' && 'spot' in dialog && dialog.spot === 'Cloud workspaces' ? 'experimental' : undefined
    if (id) setOnboard(o => (o.done.includes(id) ? o : { ...o, done: [...o.done, id] }))
  }, [dialog])
  // the sidebar's + › Terminal or Browser: a new one in the Terminals or Browsers project (the first makes it), selected
  // a page's link to a new tab (url; front: target=_blank, else a middle click, ⌘-click or its menu): one more, selected or not
  const quickNew = async (kind: 'shells' | 'browsers', url?: string, front = true, at?: { project: string; place?: string }) => {
    const w = await call<WorkspaceView>('quickNew', { kind, ...(url && { url }), ...at }).catch(() => null) // the toast says why
    if (w && front) (showNew(w.id), setDialog(null))
  }
  // U4: Welcome's Install or Sign in: a terminal with the command typed (not run), `; exit` after it, so it ends as the
  // command does; as it exits, it goes and Welcome is back (its checks run again as it shows)
  const [fixTab, setFixTab] = useState<{ tab: string; ws: string; seen?: boolean } | null>(null) // seen: its tab in the view once (the socket's view can lag the state call)
  const welcomeRun = (cmd: string) => termType(`${cmd}; exit`, undefined, (tab, ws) => setFixTab({ tab, ws }))
  // a terminal (a project's, else Terminals') with a command typed, not run (Welcome's; F6's Add a server…, Remove…: the
  // agent's own CLI changes its config, never Laki)
  const termType = async (cmd: string, project?: string, opened?: (tab: string, ws: string) => void) => {
    const w = await call<WorkspaceView>('quickNew', { kind: 'shells', ...(project && { project }) }).catch(() => null)
    if (!w) return
    for (let i = 0; i < 50; i++) {
      const t = (await api.call<View>('state').catch(() => null))?.tabs.find(x => x.workspace === w.id)
      if (t) {
        opened?.(t.id, w.id)
        await call('send', { target: t.id, text: cmd, enter: false }).catch(() => {})
        break
      }
      await new Promise(r => setTimeout(r, 100))
    }
    setDialog(null)
    showNew(w.id)
  }
  useEffect(() => {
    if (!fixTab || !view) return
    const t = view.tabs.find(x => x.id === fixTab.tab)
    if (t && t.status !== 'exited') return void (fixTab.seen || setFixTab({ ...fixTab, seen: true }))
    if (!t && !fixTab.seen) return // not in this view yet
    setFixTab(null)
    if (view.workspaces.some(w => w.id === fixTab.ws)) void call('wsRm', { id: fixTab.ws }).catch(() => {}) // a shell's tab goes as it exits: its terminal's workspace too
    setWsId(null)
    setRailKind('projects')
  }, [view, fixTab])
  // U4: Try it on a sample repo: the project (made once), then New workspace with a task for it and the first agent
  const welcomeSample = async (agent?: string) => {
    const p = await call<Project>('sampleNew').catch(() => null)
    if (p) newWs(p.id, { prompt: 'Fix the failing test in cart.js and add one more test', ...(agent && view?.presets.some(x => x.name === agent && !x.off) && { preset: agent }) })
  }
  const quickRef = useRef(quickNew)
  quickRef.current = quickNew
  useEffect(() => {
    bridge?.onBrowserTab?.((url, front) => void quickRef.current('browsers', url, front))
  }, [])
  const newIn = (p: Project) => (p.kind ? quickNew(p.kind) : newWs(p.id)) // a project head's +
  // a project's or group's +: a workspace, or a terminal in the project's own folder (API 107; before: a workspace at once)
  const termsOk = hasCap(view, 'project.terminal')
  const termIn = (p: Project, place?: string) => quickNew('shells', undefined, true, { project: p.id, ...(place && { place }) })
  const termWhere = (p: Project) => `in ${p.host ? `${p.host}:` : ''}${shortPath(p.path)}`
  const newWord = (p: Project) => (p.kind === 'shells' ? 'New terminal' : p.kind === 'browsers' ? 'New browser' : 'New workspace')

  // keys: capture phase, before xterm.js sees them (keydown.ts' onKey, set at the end once there's a view)
  const keys = useRef<(e: KeyboardEvent, force?: KeyId, fixed?: boolean) => void>(() => {})
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e)
    bridge?.onBrowserKey?.(key => keys.current(new KeyboardEvent('keydown', { key, metaKey: true }), isKeyId(key) ? key : undefined, !isKeyId(key))) // a menu bar item's (an id, or a fixed key) or a Browsers page's, as if here
    window.addEventListener('keydown', f, true)
    return () => window.removeEventListener('keydown', f, true)
  }, [])
  useEffect(() => void bridge?.keys?.(settings.keys ?? {}), [JSON.stringify(settings.keys ?? {})]) // the menu bar's items show them

  // the actions, once: the ⋯ menus and the palette show the same ones
  const newTabIn = (w: WorkspaceView | null): Action[] => [
    { label: 'Shell', icon: 'terminal', hint: w?.id === ws?.id ? kh('newTab') : undefined, tip: 'A terminal in the workspace\'s folder', run: () => newTab('shell', undefined, w), cmd: () => newTab('shell', undefined, w, true) }, // cmd: ⌘-click or ⌘⏎, a tab of its own, never a split
    ...(view?.presets ?? []).filter(p => !p.off).map(p => ({ label: p.name, icon: 'agent', sub: p.agent === 'command' ? 'Command' : [AGENT_NAMES[p.agent], p.model].filter(Boolean).join(' · '), tip: `Starts ${p.name} in a new tab here (⌘-click: never in a split)`, run: () => newTab(p.name, undefined, w), cmd: () => newTab(p.name, undefined, w, true) }) as Action),
    { label: 'Command…', icon: 'terminal', tip: 'A tab that runs a command you type', run: () => (w && setWsId(w.id), setDialog('custom')) }, // the dialog is for the selected one
    // Recently closed: the tabs you closed here, newest first (ponytail: listed in the menu itself, no submenu)
    ...(w?.closed ?? []).map((c, i): Action => ({ label: `Reopen ${c.name}`, icon: 'undo', hint: i === 0 && w?.id === ws?.id ? kh('reopenTab') : undefined, sub: [c.kind === 'shell' ? 'Shell' : AGENT_NAMES[c.preset as Agent] ?? c.preset, ago(c.at)].filter(Boolean).join(' · '), tip: c.resumeId ? 'Back in a new tab, its chat resumed' : 'Back in a new tab', run: () => void reopenTab(w, i) })),
  ]
  const newTabActions = newTabIn(ws)
  // ⌘J and the Needs you list walk the same list (needsSorted): waiting first, the oldest first; then done, the newest
  // first, the stale ones last; the one after the tab in front (needNext: the card and row it's marked on)
  const needAfter = () => (need => need[(need.findIndex(t => t.id === tab?.id) + 1) % need.length])(needsSorted(needing.filter(t => order.some(w => w.id === t.workspace)), staleMin))
  const nextNeed = () => {
    earn('jump')
    const t = needAfter()
    if (!t) return toast('Nothing needs you')
    setDialog(null)
    selectTab(t)
  }
  // ⌘⇧A, the status bar's Artifacts › Show here: the strip of what its agents keep, over the status bar, or not
  const toggleArtifacts = () => (ws?.storage ? setGallery(g => (g === ws.id ? null : ws.id)) : toast('No artifacts here: its folder is made with its first agent'))
  // Send later: to one of the workspace's agents, or Laki AI (on); to: who it's for at first
  const canLater = !!ws && (aiOn(settings) || tabs.some(t => t.kind === 'agent' && t.status !== 'exited'))
  const sendLater = (to?: string, text?: string) => setDialog({ sendLater: ws?.id ?? '', ...(to && { to }), ...(text && { text }) })
  const wsActions: Action[] = !ws
    ? []
    : [
        ...(tab ? [{ label: 'Split right', icon: 'splitRight', tip: 'A new pane beside this one, in the same tab', run: () => split('right') } as Action, { label: 'Split down', icon: 'splitDown', tip: 'A new pane under this one, in the same tab', run: () => split('bottom') } as Action] : []),
        ...(ws.kind === 'worktree'
          ? [{ label: 'Fork workspace', icon: 'fork', key: 'f', tip: 'A new worktree off its branch\'s last commit, its agent\'s chat forked too', run: () => forkWs(ws) } as Action, { label: 'Archive workspace', icon: 'archive', key: 'a', tip: 'Removes its worktree, keeps the branch; restore it from the project\'s menu', run: () => archive(ws) } as Action]
          : []),
        ...(canLater ? [{ label: 'Send a message later…', icon: 'timer', key: 'l', hint: kh('later'), tip: 'Types a message into an agent at a time you pick, or once its turn ends', run: () => sendLater() } as Action] : []),
        { label: 'Rename workspace…', icon: 'pencil', key: 'r', tip: 'Its name in Laki; the branch and folder stay', run: () => setDialog({ renameWs: ws.id }) },
        ...(ws.browser === undefined ? [{ label: 'Copy path', icon: 'copy', key: 'c', hint: (ws.host ? `${ws.host}:` : '') + shortPath(ws.path), tip: (ws.host ? `${ws.host}:` : '') + ws.path, run: () => copy((ws.host ? `${ws.host}:` : '') + ws.path) } as Action] : []),
        { label: ws.pinned ? 'Unpin workspace' : 'Pin workspace to top', icon: 'pin', tip: ws.pinned ? 'Back under its project' : 'In the sidebar\'s Pinned, above every project', run: () => call('wsSet', { id: ws.id, pinned: !ws.pinned }) },
        rmItem(ws) as Action,
      ]
  // fold a project's workspaces away, or back; ids of removed projects go
  const fold = (id: string) => setFolded(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]).filter(x => x === 'needs' || view?.projects.some(p => p.id === x || p.seps?.some(s => s.id === x)))) // needs: the Needs you list

  const pinning = pinAsk && !connected
  if (!view && snap && !snapLate && !pinning && !locked && !problem) return (fromSnap.current = true), <SnapSkeleton s={snap} railW={railW} />
  if (!view)
    return (
      <div className={`splash ${pinning || locked ? 'pinning' : ''}`}>
        {pinning ? <PinForm left={pinAsk.left} /> : locked && connected ? <UnlockForm pin={locked.pin} /> : <Loading connected={connected} />}
        {problem && !connected && <div className="splash-problem">{problem}</div>}
      </div>
    )

  const schedulesFor = schedulesOf(dialog)
  const ports = ws ? portsOf(ws.ports, ws.tunnels).filter(p => p !== ws.port || !!project?.kind) : [] // $PORT has its own, always (a terminal: none, its ports as any)
  // ✕ beside a port something of the workspace listens on: stops it, once you say so
  const portStop = (ws: WorkspaceView, port: number) => {
    const p = ws.procs?.[port]
    if (!p) return null
    const stop = async () => {
      if (!(await ask(`Stop ${p.cmd} (pid ${p.pid}) on :${port}?`, { text: 'SIGTERM first, SIGKILL after 3 seconds if it is still running.', ok: 'Stop', danger: true }))) return
      call('portKill', { ws: ws.id, port }).catch(() => {})
    }
    return (
      <button className="port-stop" data-tip={`stop ${p.cmd} (pid ${p.pid})`} aria-label={`stop ${p.cmd} on port ${port}`} onClick={stop}>
        <Icon name="x" size={10} />
      </button>
    )
  }
  const nextTask = (view.schedules ?? []).filter(s => s.on && s.next).sort((a, b) => a.next! - b.next!)[0]
  const runs = view.runs ?? [] // newest first: the ones above the last read
  const seen = runs.findIndex(r => r.id === runsSeen)
  const runFailed = runs.slice(0, seen < 0 ? undefined : seen).some(r => !r.ok) // the clock gets a dot
  const labels = settings.sideLook?.labels !== false // words beside the sidebar's bottom buttons
  const portUp = !!ws?.ports.includes(ws.port)
  const label = (id: string) => {
    const t = byId(id)
    return (
      t && (
        <>
          <Glyph s={tabGlyph(t)} />
          <span>{t.name}</span>
        </>
      )
    )
  }
  // Collision radar: where a workspace's changes meet another live worktree's, or what landed on its base since it
  // branched (the daemon's scanOverlaps); one you hid stays hidden while it reads the same
  const radarKey = (w: WorkspaceView, c: Collision) => [w.id, c.ws ?? c.base, c.file, c.mine, c.theirs].join('|')
  const radarOf = (w: WorkspaceView) => (w.overlaps ?? []).filter(c => !radarHid.includes(radarKey(w, c)))
  // One next step (shared/nextStep.ts): the toolbar's button (⌘G) and a row's chip; a click does it
  const stepsOn = settings.nextStep !== false
  // a row's marks (Settings › Appearance › Sidebar rows); Show ›, in the sidebar's right clicks, turns each on or off
  const mark = (m: RowMark) => rowMarkOn(settings, m)
  const stepOf = (w: WorkspaceView) => nextStep(w, view!.tabs, { merge: allows(w, 'merge'), git: projOf(w)?.git !== false })
  const doStep = (w: WorkspaceView, s: Step, e?: React.MouseEvent) => {
    const at = () => (setWsId(w.id), setDialog(null))
    if (s.tab && ['answer', 'plan', 'check', 'working'].includes(s.id)) return selectTab({ id: s.tab, workspace: w.id })
    if (s.id === 'continue') return void call('send', { target: s.tab, text: 'continue' }).catch(() => {})
    if (s.id === 'conflict' || s.id === 'ci' || s.id === 'review') return void prFix(w, s.id)
    if (s.id === 'merge') return void prAct(w, 'merge')
    if (s.id === 'archive') return void archive(w)
    if (s.id === 'look') return at(), showPanel('changes')
    if (s.id === 'ship') return at(), setDialog('ship')
    if (s.id === 'wait' && w.pr) return openExternal(w.pr.url)
    at()
  }
  // the step as the first item of a workspace's ⋯ (the toolbar's, a row's and its right click), a line under it
  const stepItem = (w: WorkspaceView): MenuItem[] =>
    (st => (st ? [{ label: st.label, icon: STEP_ICON[st.id], hint: w.id === ws?.id ? kh('step') : undefined, tip: st.tip, run: () => doStep(w, st) } as MenuItem, null] : []))(stepsOn && !projOf(w)?.kind && !w.term ? (st => (st?.id === 'archive' && w.kind === 'worktree' ? undefined : st))(stepOf(w)) : undefined)
  // the tabs: in the top bar (the default), or a strip of their own under the terminals or beside them (Settings ›
  // Appearance; a phone keeps them on top)
  const tabsAt = (!narrow && (['bottom', 'left', 'right'] as const).find(x => x === settings.tabsAt)) || 'top' // an unknown value: top
  const ctxLook = settings.contextMeter === false ? undefined : settings.contextMeter === 'ring' || settings.contextMeter === 'status' ? settings.contextMeter : 'line' // Settings › Appearance: the context meter, and how its tab shows it
  const ctxOn = !!ctxLook
  const costsOn = settings.costs !== false // and what agents used
  const schedTip = nextTask ? `Scheduled tasks · next: ${nextTask.name ? stamp(nextTask.name, nextTask.next!) : nextTask.prompt.slice(0, 40)}, ${new Date(nextTask.next!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Scheduled tasks'
  const toSchedules = () => setDialog(d => (schedulesOf(d) === undefined ? 'schedules' : null))
  const toBoard = () => setDialog(d => (d === 'board' ? null : 'board'))
  const toSpecs = () => setDialog(d => (specsOf(d) ? null : { specs: '' }))
  const SPECS_TIP = 'Specs & Brainstorms: requirements to implement, ideas to explore with Laki AI'
  const toFlows = () => setDialog(d => (flowsOf(d) ? null : { workflows: '' }))
  const flowsAsk = (view?.flows ?? []).filter(r => r.status === 'waiting').length
  const FLOWS_TIP = `Workflows: blocks Laki runs for a task${flowsAsk ? ` · ${flowsAsk} ask${flowsAsk > 1 ? '' : 's'} you` : ''}`
  const calOn = settings.calendar !== false // Settings › General › Pages
  const toCal = () => setDialog(d => (d === 'calendar' ? null : 'calendar'))
  const calSoon = (view?.reminders ?? []).filter(r => !r.done && r.fired).length // rung, not ticked off
  const deskOn = settings.desk !== false // Settings › General › Pages
  const notesOn = settings.notes !== false // Settings › General › Pages
  const todosOn = settings.todoList !== false // Settings › General › Pages
  const toTodos = () => setDialog(d => (d === 'todos' ? null : 'todos'))
  const toDesk = () => setDialog(d => (d === 'desk' ? null : 'desk'))
  const toNotes = () => setDialog(d => (notesOf(d) ? null : { note: '' }))
  const toAi = () => setDialog(d => (d === 'ai' ? null : 'ai'))
  const AI_TIP = 'AI: ask Laki to start, check and steer your agents'
  const toSettings = () => setDialog(d => (settingsOf(d) ? null : 'settings'))
  const BOARD_TIP = 'Board: every workspace by where it is, and to-dos'
  const achHidden = achKept.hidden ?? []
  const achAll = ACHIEVEMENTS.filter(a => !achHidden.includes(a.id))
  const achN = achAll.filter(a => achKept.got?.[a.id]).length
  // each kind's tabs that need you (the Dock's rule) and whether one works, for its rail button
  const kinds = rail ? new Map(live.map(w => [w.id, kindOf(w)])) : null
  const railSays = (k: RailKind) => {
    const mine = view.tabs.filter(t => kinds?.get(t.workspace) === k)
    return { n: mine.filter(needsYou).length, busy: mine.some(t => spins(t)) }
  }
  // a rail button's color (its right click's swatches: settings.railColors, by its key); 'none' drops it
  const railColors = settings.railColors ?? {}
  const railColor = (key: string, c: string) => {
    const { [key]: _, ...rest } = railColors
    void call('settingsSet', { railColors: c === 'none' ? rest : { ...rest, [key]: c } }).catch(fail)
  }
  const tinted = (key: string) => (railColors[key] ? { className: 'rail-icon tinted', style: colorVar(railColors[key]) } : { className: 'rail-icon' })
  // a rail button: its icon, words (Labels), and a count or a dot on the icon
  const railButton = (key: string, icon: IconName, label: string, on: boolean, tip: string, run: () => void, mark?: ReactNode, menu?: (e: React.MouseEvent) => void) => (
    <button key={key} type="button" data-rail={key} data-key={isKeyId(key) ? key : undefined} className={`rail-kind nodrag ${on ? 'on' : ''}`} aria-pressed={on} aria-label={tip} data-tip={tip} aria-haspopup={menu ? 'menu' : undefined} onClick={menu ?? run} onPointerEnter={() => key in PRELOAD && void PRELOAD[key as keyof typeof PRELOAD]().catch(() => {}) /* E8: its page's code, before the click */}>
      <span {...tinted(key)}>
        <Icon name={icon} size={18} />
        {mark}
      </span>
      {railWords && <span className="rail-label">{label}</span>}
    </button>
  )
  // a kind's button: its count, or a dot while one works
  const kindButton = ([k, label, icon]: (typeof RAIL)[number]) => {
    const { n, busy } = railSays(k)
    const says = `${label}${n ? ` · ${n} need${n === 1 ? 's' : ''} you` : busy ? ' · at work' : ''}`
    return railButton(k, icon, label, railKind === k && !onPage, says, () => railTo(k), n > 0 ? <span className="rail-count"><Num value={n > 99 ? '99+' : n} /></span> : busy && <span className="rail-dot" />)
  }
  // the rail's quick access: workspaces, terminals and browsers pinned there (Pin to the rail), oldest pin first
  const railPins = rail ? live.filter(w => w.railPin).sort((a, b) => a.railPin! - b.railPin!).slice(0, RAIL_PINS) : []
  const pinMarks = initials(railPins.map(wsName))
  const pinButton = (w: WorkspaceView, i: number) => {
    const mine = view.tabs.filter(t => t.workspace === w.id)
    const n = mine.filter(needsYou).length
    const k = rawKind(w)
    const tip = `${wsName(w)}${k === 'projects' ? ` · ${projWords(w)}` : ''}${n ? ` · ${n} need${n === 1 ? 's' : ''} you` : ''} · right click: its menu`
    // never lit as the open one: its kind's button above is, and the list shows the row; a mouse click lets go of the
    // focus (a key pressed later would ring it, :focus-visible), Enter or Space keeps a keyboard user's place
    return (
      <button key={`pin:${w.id}`} type="button" className={`rail-kind rail-pin nodrag ${dropOn === w.id ? 'drop-on' : ''}`} {...dropProps(w)} aria-current={ws?.id === w.id && !onPage ? 'true' : undefined} aria-label={tip} data-tip={tip} onClick={e => (e.detail && e.currentTarget.blur(), setDialog(null), setWsId(w.id))} onContextMenu={e => (e.preventDefault(), wsTabMenu(e, wsMenu(w)))}>
        <span className="rail-icon" style={colorVar(tint(w))}>
          {w.icon ? isIconName(w.icon) ? <Icon name={w.icon} size={18} /> : <span className="rail-emoji">{w.icon}</span> : k === 'projects' ? <span className="rail-mark">{pinMarks[i]}</span> : <Icon name={k === 'shells' ? 'terminal' : 'globe'} size={18} />}
          {k === 'projects' && <ProjectMark p={projOf(w)} size={11} /> /* its project's, at the corner */}
          {n > 0 ? <span className="rail-count"><Num value={n} /></span> : mine.some(t => spins(t)) && <span className="rail-dot" />}
        </span>
        {railWords && <span className="rail-label">{wsName(w)}</span>}
      </button>
    )
  }
  // specs and brainstorms pinned there (settings.railPlans), after the workspaces: a click opens it on the Specs page
  const planPins = rail && specsOn ? (settings.railPlans ?? []).slice(0, RAIL_PINS - railPins.length) : [] // the same 5 places as the workspaces'
  const samePlan = (a: PlanPin, b: { project: string; kind: PlanKind; slug: string }) => a.project === b.project && a.kind === b.kind && a.slug === b.slug
  const pinPlan = (r: PlanPin, on: boolean) => {
    const was = settings.railPlans ?? []
    const had = was.find(x => samePlan(x, r))
    if (on && had?.title === r.title) return
    if (on && !had && railPins.length + was.length >= RAIL_PINS) return toast(`The rail holds ${RAIL_PINS} pins: unpin one first`)
    void call('settingsSet', { railPlans: on ? (had ? was.map(x => (x === had ? r : x)) : [...was, r]) : was.filter(x => x !== had) }).catch(fail)
  }
  const planButton = (p: PlanPin) => {
    const words = p.kind === 'spec' ? 'Spec' : 'Brainstorm'
    const tip = `${words}: ${p.title || 'Untitled'} · ${view.projects.find(x => x.id === p.project)?.name ?? ''} · right click: unpin, color`
    const key = `plan:${p.project}/${p.kind}/${p.slug}`
    return (
      <button key={`plan:${p.project}/${p.kind}/${p.slug}`} type="button" className="rail-kind rail-pin nodrag" aria-label={tip} data-tip={tip} onClick={e => (e.detail && e.currentTarget.blur(), setDialog({ specs: p.project, kind: p.kind, slug: p.slug }))} onContextMenu={e => (e.preventDefault(), openMenu(e, [{ label: 'Open', icon: (p.kind === 'spec' ? 'spec' : 'bulb'), run: () => setDialog({ specs: p.project, kind: p.kind, slug: p.slug }) }, { label: 'Unpin from the rail', icon: 'pin', run: () => pinPlan(p, false) }, { colors: TAB_COLORS, value: railColors[key], pick: c => railColor(key, c) }]))}>
        <span {...tinted(key)}>
          <Icon name={(p.kind === 'spec' ? 'spec' : 'bulb')} size={18} />
        </span>
        {railWords && <span className="rail-label">{p.title || 'Untitled'}</span>}
      </button>
    )
  }
  // the floating chat (Settings › AI's Chat button): Laki AI over any page but its own and those with a chat on them
  const aiFab = aiOn(settings) && settings.ai?.float !== false && !narrow && dialog !== 'ai' && dialog !== 'help' && !specsOf(dialog) && !settingsOf(dialog) && !extOf(dialog) /* its own chat */
  // what it tells the model with each ask: the page open, the workspace and tab, as they are now, and the tab's screen
  const whereNow = async () => {
    const page = dialog === null ? 'the workspace below (no page over it)' : typeof dialog === 'string' ? `the ${dialog} page` : `the ${Object.keys(dialog)[0]} page`
    // the selected workspace's facts, as Info shows them: where it is, its branch and base, its changes, its PR (checks,
    // review, conflicts), what listens there, its other tabs
    const w = ws && [
      `workspace "${wsName(ws)}" (id ${ws.id}) in project ${project?.name ?? ws.project}`,
      `${ws.kind === 'worktree' ? 'a worktree' : 'the folder itself'} at ${ws.host ? `${ws.host}:` : ''}${ws.path}`,
      ws.branch && `branch ${ws.branch}${ws.base ? ` off ${ws.base}` : ''}`,
      ws.stat && `changes: ${ws.stat.files} file${ws.stat.files === 1 ? '' : 's'} +${ws.stat.add} −${ws.stat.del}${ws.stat.dirty ? `, ${ws.stat.dirty} uncommitted` : ''}`,
      ws.pr && `PR #${ws.pr.number} "${ws.pr.title}" ${prState(ws.pr)} ${ws.pr.url}, checks ${ciText(ws.pr)}${ws.pr.review && REVIEW[ws.pr.review] ? `, ${REVIEW[ws.pr.review]}` : ''}${ws.pr.conflict ? ', merge conflicts' : ''}`,
      ws.ports.length && `listening on ${ws.ports.map(n => `localhost:${n}`).join(', ')}`,
      ws.storage && `its storage folder ${ws.storage}`,
      (ts => ts.length > 1 && `its tabs: ${ts.map(x => `"${x.name}" (${x.kind === 'agent' ? (x.preset ?? 'agent') : x.kind}, ${STATE_WORDS[x.status] ?? x.status})`).join(', ')}`)(tabs.filter(x => x.workspace === ws.id && x.status !== 'exited')),
    ].filter(Boolean).join(', ')
    const t = tab && [`tab "${tab.name}" (id ${tab.id}, ${tab.kind === 'agent' ? tab.preset ?? 'agent' : tab.kind}) ${STATE_WORDS[tab.status] ?? tab.status}`, tab.progress && `${tab.progress.pct}% done`, tab.last && `its last answer: ${tab.last.trim().replace(/\s+/g, ' ').slice(0, 400)}`].filter(Boolean).join(', ')
    const flow = flowsOf(dialog) && pageNow.workflow?.() // the Workflows page: the workflow open there, and its file
    if (flow) return `On the Workflows page, with ${flow}`
    const screen = tab && tab.status !== 'exited' ? await api.call<string>('screen', { target: tab.id, lines: 40, by: 'ai' }).catch(() => '') : '' // by: Laki AI looks (its glow)
    // the Desk: its tiles by id, so "change it" finds the one (Laki AI rewrites only ones it made)
    const desk = dialog === 'desk' && (view.widgets ?? []).filter(onDesk).map(x => `"${x.name}" (extension id ${x.id}${x.byAi ? ', made by Laki AI' : ''}${x.on ? '' : ', off'})`)
    return [`On ${page}`, desk && (desk.length ? `its tiles: ${desk.join(', ')}` : 'no tiles yet'), w && `selected: ${w}`, t, screen.trim() && `the tab's screen now (its last 40 lines):\n${screen.replace(/\s+$/gm, '').slice(-5000)}`].filter(Boolean).join('; ')
  }
  // the names Laki AI's answers may write in bold (made links): its own (MCP's state) and the one shown (a PR's title)
  const aiNames = view.workspaces.filter(w => !w.archived).flatMap(w => [...new Set([w.name || w.id, wsName(w)])].map(name => ({ id: w.id, name })))
  const shownWidgets = (view.widgets ?? []).map(w => inWs(w, wsHere)) // a per-workspace one's instance in the workspace on screen
  const ownWidgets = shownWidgets.filter(w => (!w.project || w.project === ws?.project) && !(w.on && w.hidden)) // a repo's (.laki/extensions): only while a workspace of its project is selected; hidden: its data says so
  // the tab bar's ⋯: One next step first; on a phone, the top bar's extensions too (no room for their strip), each as
  // its button's click
  const wsMore = (extra: MenuItem[] = []): MenuItem[] => [...(ws ? stepItem(ws) : []), ...extra, ...(narrow && ws?.kind === 'worktree' && !(stepsOn && stepOf(ws)?.id === 'ship') ? [{ label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') } as MenuItem] : []), ...(tops => (narrow && tops.length ? [...wsActions, { head: 'Extensions' }, ...tops.map(w => ({ label: w.name, sub: w.label ?? w.badge, run: () => extClick(w, widgetApi) }))] : wsActions))(ownWidgets.filter(w => w.on && placesOf(w).includes('top')))]
  const onPage = schedulesFor !== undefined || dialog === 'board' || dialog === 'achievements' || (dialog === 'calendar' && calOn) || (dialog === 'desk' && deskOn) || (notesOn && !!notesOf(dialog)) || (todosOn && dialog === 'todos') || (dialog === 'bird' && settings.birdView !== false) || dialog === 'ai' || !!specsOf(dialog) || !!flowsOf(dialog) || settingsOf(dialog) // the rail's lit button: the page over the main area, else the list's kind
  const listOff = rail && sideOpen && (schedulesFor !== undefined || dialog === 'board' || (calOn && dialog === 'calendar') || (deskOn && dialog === 'desk') || (notesOn && !!notesOf(dialog)) || (todosOn && dialog === 'todos') || dialog === 'ai' || (specsOn && !!specsOf(dialog)) || (flowsOn && !!flowsOf(dialog))) // the rail's Schedule and Board: a page over all but the rail
  // the list as a strip: a name each, written down it (no filter, a page over it or a phone: the list)
  const strip = rail && sideOpen && !listOff && !find && railKind !== 'projects' ? strips[railKind] : undefined
  const stripMenu = (at: 'left' | 'right'): MenuItem[] => [
    { label: 'Show the list', icon: 'sidebar', run: () => setStrip(railKind) },
    { label: at === 'left' ? 'Move it to the right' : 'Move it to the left', icon: at === 'left' ? 'chevronsRight' : 'chevronsLeft', run: () => setStrip(railKind, at === 'left' ? 'right' : 'left') },
  ]
  const stripNeeds = strip && new Set(needing.map(t => t.workspace)) // the Dock's list: its rows' dots
  const stripBar = strip && (
    <nav className={`side-strip ${strip}`} aria-label={railKind === 'shells' ? 'Terminals' : 'Browsers'} onContextMenu={e => (e.preventDefault(), openMenu(e, stripMenu(strip)))}>
      <span className="strip-drag drag" />
      <IconButton icon={strip === 'left' ? 'chevronsRight' : 'chevronsLeft'} title="Show the list · right click: move the strip to the other side" onClick={() => setStrip(railKind)} />
      {order
        .filter(w => kindOf(w) === railKind)
        .map(w => (
          <button key={w.id} type="button" className={`strip-ws ${w.id === ws?.id && !onPage ? 'sel' : ''}`} style={colorVar(tint(w))} data-tip={wsName(w)} onClick={() => (setDialog(null), setWsId(w.id))} onContextMenu={e => (e.preventDefault(), e.stopPropagation(), wsTabMenu(e, wsMenu(w)))}>
            <span className="fr-vert">{wsName(w)}</span>
            {stripNeeds && stripNeeds.has(w.id) && <i role="img" aria-label="needs you" />}
          </button>
        ))}
      <IconButton icon="plus" title={railKind === 'shells' ? 'New terminal' : 'New browser'} onClick={() => railKind !== 'projects' && quickNew(railKind)} />
    </nav>
  )
  // back and forward's buttons: the rail's top, else the sidebar's head; a right click lists where each goes
  const histMenu = (e: React.MouseEvent, by: -1 | 1) => {
    e.preventDefault()
    const h = hist.current
    const js = by < 0 ? h.at.slice(0, h.i).map((_, j) => j).reverse() : h.at.slice(h.i + 1).map((_, j) => h.i + 1 + j)
    if (js.length) openMenu(e, [{ head: by < 0 ? 'Back to' : 'Forward to' }, ...js.map(j => ({ label: placeName(h.at[j]), icon: (h.at[j].d === null ? 'terminal' : 'file') as IconName, run: () => travel(j) }))])
  }
  const histAt = hist.current
  const histNav = historyOn && (
    <span className="hist-nav nodrag">
      <IconButton icon="chevronLeft" keyId="back" title={kt(histAt.at[histAt.i - 1] ? `Back to ${placeName(histAt.at[histAt.i - 1])}; right click: more` : 'Back', 'back')} disabled={histAt.i < 1} onClick={() => travel(histAt.i - 1)} onContextMenu={e => histMenu(e, -1)} />
      <IconButton icon="chevronRight" keyId="forward" title={kt(histAt.at[histAt.i + 1] ? `Forward to ${placeName(histAt.at[histAt.i + 1])}` : 'Forward', 'forward')} disabled={histAt.i >= histAt.at.length - 1} onClick={() => travel(histAt.i + 1)} onContextMenu={e => histMenu(e, 1)} />
    </span>
  )
  // the rail's pages after Projects, then the other kinds; with words under the icons and more than RAIL_FIT buttons,
  // the least used ones (RAIL_MORE's order) go into ⋯ More, a menu, its count their counts', lit while one is open
  type RailPage = { key: string; icon: IconName; label: string; on: boolean; tip: string; run: () => void; mark?: ReactNode; n?: number } | { key: string; kind: (typeof RAIL)[number] }
  const railPages: RailPage[] = [
    { key: 'board', icon: 'board', label: 'Board', on: dialog === 'board', tip: BOARD_TIP, run: toBoard },
    { key: 'schedules', icon: 'clock', label: 'Schedule', on: schedulesFor !== undefined, tip: `${schedTip}${runFailed ? ' · a run failed' : ''}`, run: toSchedules, mark: runFailed && <span className="rail-dot bad" /> },
    ...(specsOn ? [{ key: 'specs', icon: 'spec' as const, label: 'Specs', on: !!specsOf(dialog), tip: SPECS_TIP, run: toSpecs }] : []),
    ...(flowsOn ? [{ key: 'workflows', icon: 'flow' as const, label: 'Workflows', on: !!flowsOf(dialog), tip: FLOWS_TIP, run: toFlows, n: flowsAsk }] : []),
    ...(deskOn ? [{ key: 'desk', icon: 'desk' as const, label: 'My Desk', on: dialog === 'desk', tip: 'My Desk: your extensions as tiles', run: toDesk }] : []),
    ...(notesOn ? [{ key: 'notes', icon: 'note' as const, label: 'Notes', on: !!notesOf(dialog), tip: 'Notes: yours, for any project', run: toNotes }] : []),
    ...(todosOn ? [{ key: 'todos', icon: 'listChecks' as const, label: 'To-dos', on: dialog === 'todos', tip: 'To-dos: your checklist', run: toTodos }] : []),
    ...(calOn ? [{ key: 'calendar', icon: 'calendar' as const, label: 'Calendar', on: dialog === 'calendar', tip: `Calendar: scheduled tasks and reminders${calSoon ? ` · ${calSoon} rang` : ''}`, run: toCal, n: calSoon }] : []),
    ...RAIL.slice(1).filter(([k]) => railOf(k) === k).map(kind => ({ key: kind[0], kind })),
  ]
  // the user's order and the ones they put into More (Settings › Appearance › Rail), then the ones that don't fit
  const railHide = settings.railHide ?? []
  // D7: a phone at answer only: the pages whose work it may do (the Board's and the Calendar's reminders, Laki AI)
  const railOk = (x: { key: string }) => view.remote?.level !== 'answer' || ['board', 'calendar', 'ai'].includes(x.key)
  const railShown = railSorted(railPages.filter(railOk), settings.railOrder).filter(x => !railHide.includes(x.key))
  const over = (o => (o.length > 1 ? o : []))(railWords && railShown.length + 1 > RAIL_FIT ? RAIL_MORE.filter(k => railShown.some(x => x.key === k)).slice(0, railShown.length + 1 - (RAIL_FIT - 1)) : []) // one alone: More would save no room
  const railKept = railShown.filter(x => !over.includes(x.key))
  type RailRun = Extract<RailPage, { run: () => void }>
  const kindPage = ([k, label, icon]: (typeof RAIL)[number]): RailRun => (({ n, busy }) => ({ key: k, icon, label, on: railKind === k && !onPage, tip: `${label}${busy ? ' · at work' : ''}`, run: () => railTo(k), n }))(railSays(k))
  const aiPage: RailRun = { key: 'ai', icon: 'ai', label: 'AI', on: dialog === 'ai', tip: AI_TIP, run: toAi }
  const railMore = [...railSorted(railPages.filter(railOk), settings.railOrder).filter(x => railHide.includes(x.key) || over.includes(x.key)), ...(aiOn(settings) && railHide.includes('ai') ? [aiPage] : [])].map(x => ('kind' in x ? kindPage(x.kind) : x))
  // a right click on the rail: put that button into More (or back), or the whole list in Settings
  const railMenu = (e: React.MouseEvent) => {
    const key = (e.target as Element).closest<HTMLElement>('[data-rail]')?.dataset.rail
    const item = RAIL_ITEMS.find(x => x.key === key)
    e.preventDefault()
    openMenu(e, [
      ...(key ? [{ head: 'Color' }, { colors: TAB_COLORS, value: railColors[key], pick: (c: string) => railColor(key, c) }, null] : []),
      ...(item ? [{ label: `Move ${item.label} into ⋯ More`, icon: 'more' as const, run: () => void call('settingsSet', { railHide: [...railHide, item.key] }).catch(() => {}) }] : []),
      { label: 'Customize the rail…', icon: 'gear', sub: 'which buttons show, their order', run: () => setDialog({ section: 'layout', spot: 'Rail' }) },
    ])
  }
  // the rail stays while Projects' sidebar is open: a kind whose list is hidden (Terminals, Browsers) keeps it
  const railUp = rail && (sideOpen || (sideOpens.projects ?? true))
  const wsTint = settings.wsTint && ws?.color && ws.color !== 'none' ? ws.color : undefined // the open workspace's color in the glass (none on a page: .main[data-pages])
  const railBar = railUp && (
    <nav className="rail drag" aria-label="Projects, the board, scheduled tasks, terminals, browsers and settings" data-bare={railWords ? undefined : ''} style={{ width: railW }} onContextMenu={e => !e.defaultPrevented && railMenu(e)}>
      {histNav}
      {kindButton(RAIL[0])}
      {railKept.map(x => ('kind' in x ? kindButton(x.kind) : railButton(x.key, x.icon, x.label, x.on, x.tip, x.run, x.n ? <span className="rail-count"><Num value={x.n} /></span> : x.mark)))}
      {railMore.length > 0 &&
        railButton('more', 'more', 'More', railMore.some(x => x.on), `More: ${railMore.map(x => x.label).join(', ')}`, () => {}, (n => (n ? <span className="rail-count"><Num value={n} /></span> : undefined))(railMore.reduce((a, x) => a + (x.n ?? 0), 0)), e =>
          openMenu(e, [
            ...railMore.map(x => ({ label: x.label, icon: x.icon, sub: x.tip, run: x.run, ...(x.on && { hint: 'ON' }), ...(x.n ? { pill: String(x.n), tone: 'warn' as const } : {}) })),
            ...(railHide.length ? [{ label: 'Show them all on the rail', icon: 'eye' as const, foot: true, run: () => void call('settingsSet', { railHide: [] }).catch(() => {}) }] : []),
            { label: 'Customize the rail…', icon: 'gear', foot: true, run: () => setDialog({ section: 'layout', spot: 'Rail' }) },
          ]),
        )}
      {(railPins.length > 0 || planPins.length > 0) && <span className="rail-sep" />}
      {railPins.map(pinButton)}
      {planPins.map(planButton)}
      <WidgetButtons widgets={ownWidgets} api={widgetApi} places={['rail']} look="rail" words={railWords} colors={railColors} />
      <span className="spacer" />
      {settings.devMode === true && railButton('picker', 'target', 'Pick', picking, `Pick an element: what it is, to copy into a prompt (development mode)${pickKey ? ` · ${pickKey}` : ''}`, () => setPicking(p => !p))}
      {aiOn(settings) && !railHide.includes('ai') && railButton('ai', 'ai', 'AI', dialog === 'ai', AI_TIP, toAi)}
      {railButton('settings', 'gear', 'Settings', settingsOf(dialog), kt('Settings', 'settings'), toSettings)}
    </nav>
  )
  // the status bar, full width (Zed's way): one bar under the sidebar and the main area, over every page too, the
  // sidebar's foot buttons first (with their words) and AI and Settings at its end; a phone's under the main area.
  // Off (Settings › Appearance › Status bar): none, its foot buttons at the sidebar's foot; a lost connection still
  // says so, as a phone's bar
  const noBar = settings.statusBar === false
  const wideBar = !narrow && !noBar
  const pageHere = dialog !== null && isPlace(dialog) && view ? placeName({ d: dialog, ws: ws?.id ?? null }) : ''
  const pageBar = wideBar && !!pageHere // a page over the workspace: the bar says only what isn't the workspace's
  // the sidebar's foot buttons (Schedule, Board… without the rail; Video, Meme, Timer, its extensions, Settings), there
  // or first in the wide status bar (bar: without AI and Settings, which go at its end); words: their labels
  const footButtons = (words: boolean, bar = false) => (
    <>
          {!rail && ( // the rail layout has them on its rail
            <>
              <IconButton icon="clock" title={schedTip} on={schedulesFor !== undefined} className={runFailed ? 'dot' : ''} label={words ? 'Schedule' : undefined} onClick={toSchedules} />
              <IconButton icon="board" title={BOARD_TIP} label={words ? 'Board' : undefined} on={dialog === 'board'} onClick={toBoard} />
              {specsOn && <IconButton icon="spec" title={SPECS_TIP} label={words ? 'Specs' : undefined} on={!!specsOf(dialog)} onClick={toSpecs} />}
              {flowsOn && <IconButton icon="flow" title={FLOWS_TIP} label={words ? 'Workflows' : undefined} on={!!flowsOf(dialog)} className={flowsAsk ? 'dot' : ''} onClick={toFlows} />}
              {aiOn(settings) && !bar && <IconButton icon="ai" title={AI_TIP} label={words ? 'AI' : undefined} on={dialog === 'ai'} onClick={toAi} />}
            </>
          )}
          {/* Video, Meme and Timer under ⋯ (each still off in Settings › Appearance); one in use shows as its own button */}
          {!!video && <IconButton icon="youtube" title="The video you're watching" label={words ? 'Video' : undefined} on onClick={() => setDialog('video')} />}
          {timers.length + watches.length > 0 && <IconButton icon="timer" title="Timers: another one, or a stopwatch" label={words ? 'Timer' : undefined} on onClick={e => openMenu(e, startMenu())} />}
          {(extras => extras.length > 0 && <IconButton icon="more" title="More: Video, Meme, Timer" on={dialog === 'fun'} onClick={e => openMenu(e, extras)} />)([
            ...(settings.videoButton !== false && !video ? [{ label: 'Video', icon: 'youtube', tip: 'Watch a YouTube video while you work (off: Settings › Appearance)', run: () => setDialog('video') } as MenuItem] : []),
            ...(settings.fun !== false ? [{ label: 'Meme', icon: 'smile', tip: 'A random meme from Reddit, for a break (off: Settings › Appearance)', run: () => setDialog(d => (d === 'fun' ? null : 'fun')) } as MenuItem] : []),
            ...(settings.timerButton !== false && timers.length + watches.length === 0 ? [{ label: 'Timer', icon: 'timer', tip: 'A countdown, then a sound and a dialog or a notification (and the video paused, played or closed, if you like); or a stopwatch (off: Settings › Appearance)', items: startMenu() } as MenuItem] : []),
          ])}
          <WidgetButtons widgets={ownWidgets} api={widgetApi} places={rail ? ['foot'] : ['foot', 'rail'] /* no rail: its widgets here */} look="foot" words={words} />
          {!rail && !bar && (
            <>
              <span className="spacer" />
              <IconButton icon="gear" title={kt('Settings', 'settings')} keyId="settings" label={words ? 'Settings' : undefined} on={settingsOf(dialog)} onClick={toSettings} />
            </>
          )}
    </>
  )
  const statusBar = view && !(noBar && connected) && (ws?.browser === undefined || !connected || wideBar) && ( // a browser page: none, unless something's wrong (the wide bar: always)
        <div className={`status ${wideBar ? 'wide' : ''}`}>
          {wideBar && <span className="sb-foot">{footButtons(labels, true)}</span>}
          {/* V11: two groups, each a capsule over the bar (empty: none drawn) */}
          <span className="sb-group capsule">
          {ws && ws.browser === undefined && !pageBar && ( // a Browsers page: no port, branch or folder of its own
            <>
              {ctxOn && tab?.context && (
                // the focused tab's context: how full, so you compact or start a new chat in time
                <span className="sb-ctx" role="img" aria-label={`${tab.name}'s context: ${ctxPct(tab.context)}%, ${levelWord(ctxPct(tab.context))}`} data-tip={`${tab.name}'s context (${levelWord(ctxPct(tab.context))}): ${ctxText(tab.context)}${costsOn && tab.usage ? ` · its chat used ${usageText(tab.usage)} at API prices` : ''} · /compact or a new chat before it fills`}>
                  <span className={`usage-bar ${level(ctxPct(tab.context))}`}>
                    <i style={{ width: `${ctxPct(tab.context)}%` }} />
                  </span>
                  <Num value={`${ctxPct(tab.context)}%`} />
                </span>
              )}
              {tab?.kind === 'agent' && tab.workspace === ws.id && settings.turnChanges !== false && <TurnButton key={tab.id} tab={tab} api={turnApi(ws.id)} onMenu={openMenu} /> /* F1: the focused agent's kept turns */}
              <BgButton tabs={view.tabs.filter(t => t.workspace === ws.id && t.preset === 'claude')} api={{ bgOutput: readerApi.bgOutput!, send: readerApi.send }} />
              {git && (
                // short (no branch prefix, cut), all of it on hover; a click shows it whole, its base too
                <button
                  className={`sb-branch ${branchFull ? 'full' : ''}`}
                  data-tip={`${ws.kind === 'worktree' ? `${ws.branch} ← ${ws.base}` : `${ws.branch}, the repo itself`} · click: ${branchFull ? 'shorter' : 'all of it'}`}
                  onClick={() => setBranchFull(f => !f)}
                >
                  <Icon name="fork" size={11} />
                  {branchFull ? ws.branch : shortBranch(ws.branch)}
                  {branchFull && ws.kind === 'worktree' && <span className="muted"> ← {ws.base}</span>}
                </button>
              )}
              {git && !!ws.stat?.behind && (
                // F8: its base has commits it hasn't (as this clone has the base: no fetch): Update merges it in, or rebases
                <button className="sb-behind" data-tip={`${ws.stat.behind} commit${ws.stat.behind > 1 ? 's' : ''} behind ${ws.base}${ws.stat.clean ? ': merging it in is clean' : ws.stat.clean === false ? ': merging it in conflicts' : ''} · click: update`} onClick={e => openMenu(e, behindMenu(ws))}>
                  ↓{ws.stat.behind}
                </button>
              )}
              {ws.codespace !== undefined && (
                // a cloud workspace: its codespace and its state (why it failed, cut: all of it on hover)
                <button className="sb-flow" data-status={ws.csState === 'Failed' ? 'failed' : ws.csState === 'Available' ? undefined : 'waiting'} data-tip={`Codespace ${ws.codespace || '(being made)'}: ${csWord(ws.csState)}${ws.csError ? ` · ${ws.csError}` : ''} · click: your codespaces on GitHub`} onClick={() => openExternal('https://github.com/codespaces')}>
                  <span className="sb-flow-icon">
                    <Icon name="cloud" size={12} />
                  </span>
                  <span className="sb-flow-name">
                    codespace<span className="muted"> · {csWord(ws.csState)}{ws.csState === 'Failed' && ws.csError ? `: ${ws.csError}` : ''}</span>
                  </span>
                </button>
              )}
              {(pj =>
                pj?.cfgWait && (
                  // its repo's .laki.json, not trusted as it is: its setup, scripts and env wait for you
                  <button className="sb-flow" data-status="waiting" data-tip="This repo's .laki.json isn't trusted yet: its setup, scripts and env wait · click: look at it" onClick={() => cfgSheet(pj)}>
                    <span className="sb-flow-icon">
                      <Icon name="shieldAlert" size={11} />
                    </span>
                    <span className="sb-flow-name">.laki.json waits for you</span>
                  </button>
                ))(view.projects.find(x => x.id === ws.project))}
              {(f =>
                f && (
                  // the workflow run that made this workspace, or sent the focused tab its last block: a click opens it
                  <button className="sb-flow" data-status={f.status} data-tip={`Workflow run: ${f.name} · ${f.status}${f.block ? ` at ${f.block}` : ''} · click: open it`} onClick={() => setDialog({ workflows: '', run: f.id })}>
                    <span className="sb-flow-icon">
                      <Icon name={f.status === 'running' ? 'gear' : 'flow'} size={12} />
                    </span>
                    <span className="sb-flow-name">
                      {f.name}
                      {f.block && ['running', 'waiting', 'paused'].includes(f.status) && <span className="muted"> · {f.block}</span>}
                    </span>
                  </button>
                ))(flowsOn ? ([tab?.flow, ws.flow].map(id => id && view.flows?.find(r => r.id === id)).find(Boolean) || view.flows?.find(r => r.ws === ws.id && !FLOW_ENDED.includes(r.status))) : undefined)} {/* the tab's run gone (past the 100 kept): the workspace's; else one going in it (a workspace you picked) */}
              <PRStatus w={infoOf(ws)} face={!ws.pr?.mine || settings.ownAvatar !== false} onOpen={openExternal} onToggle={(k, v) => setAuto(ws, k, v)} onMenu={e => openMenu(e, prMenu(ws))} />
              {attachable(ws) && ws.kind !== 'local' && (
                <button className="pr pr-attach" data-tip={`No PR found for ${ws.branch}: attach one by its URL or number`} onClick={() => setDialog({ attachPr: ws.id })}>
                  + PR
                </button>
              )}
              {ws.setup && <span className="warn-soft">setup running…</span>}
            </>
          )}
          {!!ws?.artifacts && ws.storage && !pageBar && ( // the files its agents keep for you ($LAKI_STORAGE_FOLDER): shown here; Finder and Files from the strip's ⋯
            <button
              className={`listen port-main ${gallery === ws.id ? 'on' : ''}`}
              data-tip={`${shortPath(ws.storage)}: what its agents keep for you ($LAKI_STORAGE_FOLDER) · ⌘⇧A`}
              onClick={toggleArtifacts}
            >
              Artifacts: {ws.artifacts}
            </button>
          )}
          </span>
          <span className="spacer" />
          <span className="sb-group capsule">
          {/* U3: the right end: the ports, then the plan's limits; left of the spacer what the open work is (branch, PR, checks) */}
          {ws && ws.browser === undefined && !pageBar && (
            <>
              {!project?.kind && ( // a terminal in your home folder: no $PORT of its own to show
              <span className="port-item">
                <button
                  className={`listen ${portUp ? '' : 'port-main'}`}
                  data-tip={`$PORT · ${portUp ? 'listening · ' : ''}open http://localhost:${ws.port}`}
                  onClick={() => openPort(ws.port)}
                >
                  $PORT {ws.port}
                  {ws.portNames?.[ws.port] && <span className="port-name">{ws.portNames[ws.port]}</span>}
                </button>
                <TunnelButton key={ws.id} port={ws.port} tunnel={ws.tunnels?.find(t => t.port === ws.port)} api={tunnelApi(ws)} />
                {portStop(ws, ws.port)}
              </span>
              )}
              {ports.map(port => (
                <span key={`${ws.id}:${port}`} className="port-item">
                  <button className="listen" data-tip={ws.ports.includes(port) ? `listening · open http://localhost:${port}` : 'not listening now'} onClick={() => openPort(port)}>
                    ↗{port}
                    {ws.portNames?.[port] && <span className="port-name">{ws.portNames[port]}</span>}
                  </button>
                  <TunnelButton port={port} tunnel={ws.tunnels?.find(t => t.port === port) /* an older daemon has none */} api={tunnelApi(ws)} />
                  {portStop(ws, port)}
                </span>
              ))}
            </>
          )}
          {tracked.length > 0 && ws?.browser === undefined && <UsageButton key={tracked.join()} models={geminiModels} load={() => api.call<AgentUsage[]>('usage').then(limits)} onDays={() => setDialog('usage')} onUse={(agent, id) => call('settingsSet', { accountUse: { ...settings.accountUse, [agent]: id } }).catch(() => {})} today={costsOn && view.today ? { ...view.today, ws: view.today.ws.map(w => ({ ...w, name: (x => (x ? wsName(x) : 'a removed workspace'))(view.workspaces.find(x => x.id === w.ws)) })) } : undefined} /> /* remounts as agents are turned on or off */}
          {view.dnd && ( // U8: Do not disturb: until when; a click ends it now (its digest shows)
            <button className="sb-rec" data-tip="Do not disturb: no notifications, sounds or phone pushes, but an important workspace's ask · click: end now, and see what happened meanwhile" onClick={() => void call('dndSet', { off: true }).catch(() => {})}>
              <Icon name="moon" size={11} />
              until {new Date(view.dnd.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </button>
          )}
          {settings.recording && ( // Recording mode: private workspaces hidden until this is clicked
            <button className="sb-rec" data-tip="Recording mode: private workspaces and projects are hidden (they keep running). Click to show them" onClick={() => void call('settingsSet', { recording: false }).catch(() => {})}>
              <Icon name="lock" size={11} />
              Recording
            </button>
          )}
          {view.remote && ws?.browser === undefined && (
            <button
              className={`remote-badge ${view.remote.url ? '' : 'starting'} ${view.remote.open ? 'open' : ''} ${view.remote.check?.ok === false ? 'unreachable' : ''}`}
              data-tip={`${view.remote.check?.ok === false ? `Not reachable from outside (${view.remote.check.what}): ${view.remote.check.why} · ` : ''}${view.remote.open ? 'Remote access for anyone with the link (no email): Settings › Remote access' : `Remote access for ${view.remote.mail}: Settings › Remote access`}`}
              onClick={() => setDialog({ section: 'remote' })}
            >
              {!view.remote.url ? 'Remote starting…' : view.remote.open ? 'Remote: open to anyone with the link' : view.remote.until ? `Remote until ${new Date(view.remote.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Remote on'}
            </button>
          )}
          {!connected && <span className="warn" data-tip={problem}>{problem ? 'not connected: hover for why' : 'reconnecting…'}</span>}
          {upd?.latest && ( // a newer release: here until you update (Settings › General › Updates: its notes, Update)
            <button className={`sb-update ${upd.status === 'ready' ? 'sb-ready' : ''}`} data-tip={`Laki ${upd.version} → ${upd.latest.version}: what's new and Update in Settings › Updates`} onClick={() => setDialog({ section: 'general', spot: 'Updates' })}>
              <Icon name="download" size={11} />
              {view?.updateIdle ? 'Updates when idle' : upd.status === 'ready' ? 'Restart to update' : upd.status === 'downloading' ? `Downloading ${upd.latest.version}…` : `Update to ${upd.latest.version}`}
            </button>
          )}
          <WidgetStrip widgets={ownWidgets} api={widgetApi} place="status" />
          {!achKept.off && achN > 0 /* none yet: no 0/54 from the first second (⌘K and Settings › Achievements open it) */ && (
            <button className={`sb-trophy ${dialog === 'achievements' ? 'on' : ''}`} aria-label={`Achievements: ${achN} of ${achAll.length}`} data-tip={`Achievements: ${achN} of ${achAll.length} · click: what to try next`} onClick={() => setDialog(d => (d === 'achievements' ? null : 'achievements'))}>
              <Icon name="trophy" size={11} />
              {achN}/{achAll.length}
              {achMore > 0 && <b className="sb-new" data-tip={`${achMore} more unlocked`}>+{achMore}</b>}
            </button>
          )}
          {aiFab && aiDock && (
            // the AI button minimized: here until its right click puts it back
            <button
              className={`sb-ai ${aiFloat ? 'on' : ''} ${fly}`}
              data-tip={`${aiFloat ? 'Close Laki AI (Esc)' : 'Ask Laki AI about what is on screen'} · right click: float the button again`}
              onClick={() => setAiFloat(o => !o)}
              onContextMenu={e => openMenu(e, [{ label: 'Float the button again', icon: 'popOut', run: () => dock(false) }])}
            >
              <Icon name="ai" size={11} />
              AI
            </button>
          )}
          </span>
          {wideBar && !rail && ( // no rail: its AI and Settings at the end
            <span className="sb-foot">
              {aiOn(settings) && <IconButton icon="ai" title={AI_TIP} label={labels ? 'AI' : undefined} on={dialog === 'ai'} onClick={toAi} />}
              <IconButton icon="gear" title={kt('Settings', 'settings')} keyId="settings" label={labels ? 'Settings' : undefined} on={settingsOf(dialog)} onClick={toSettings} />
            </span>
          )}
        </div>
  )

  // what App's parts read (appCtx.ts), built after everything in it is
  const appBase: AppBase = {
    budgetSaid, accountsOf, achAll, achHidden, achKept, achN, achRef, achSet, addTimer, aiDock, aiNames, allows, anchor, apps,
    archive, artMenu, artPage, artView, asFile, attachable, bgUrl, busyWith, byId, call, calOn, canLater, cfgSheet,
    checking, closePage, closePreview, closeTabs, reopenTab, stopAllAsk, copy, copyTab, costsOn, ctxLook, ctxOn, deskOn, devRunning, devTab,
    dialog, dock, done, doStep, dropAgent, dropOn, dropProps, earn, editor, editorName, editScripts, extCfg,
    extInserts, extItems, extMenus, extModal, extOn, extRun, extWs, fail, find, findIn, fitFoot, floated, floatTab,
    flowItems, flowMenu, flowsHere, flowsOn, fold, folded, fontSize, footButtons, forkWs, full, gallery, gated, git,
    going, group, groupMoves, groups, held, hereCtx, hist, histNav, historyOn, hotkey, quickKey, tellKey, talkKey, inBrowser, info, inReader,
    inViewer, isTerm, kb, keyText, kh, kindOf, kt, labels, laterCancel, laterChange, laterNow, layoutsOn, layoutWait,
    listOff, live, made, making, mark, markUnread, moveWs, narrow, needAfter, needing, needsYou, newFor, newImages,
    newIn, newInit, newTab, newTabActions, newWord, newWs, nextNeed, notesOn, onboard, onboardDone, openFile, openIn,
    openInItems, openMenu, wsTabMenu, openPort, openProject, openReview, order, overlapsAt, own, ownWidgets, pageZoom, panelApi,
    panelOpen, panelShown, panelTab, panelW, peek, peekBox, peekStat, peekTimer, picked, picking, pickKey, pinned,
    pinPlan, placeName, notices, answerNotice, pops, prAct, previewed, prFix, prMenu, project, projOf, quickNew, termType, radarKey, radarOf, rail,
    railBar, railKind, railOf, rawKind, readerOn, readSwitch, onePane, refreshPR, reply, replyTo, restart, restore, revealArt, reviewOn,
    reviewSeen, reviewTab, ring, rmItem, rmWs, roleTabs, rows, run, runFlow, runMenu, runScript, samePlan,
    schedulesFor, selectGroup, selectTab, sendLater, setAiFloat, setArtsIn, setArtView, setDialog, setExtModal,
    setFind, setFinds, setFolded, setGallery, setGroups, setMaking, setNewFor, setNewImages, setNewInit, setOnboard,
    setOverlapsAt, setPanelOpen, setPanelTab, setPanelW, setPeek, setPicked, setPicking, setPops, setRadarHid,
    setRead, setReply, setReveal, setRunsSeen, setSeenSecs, setSharing, setShown, setSideOpen, setStrip, setTimer,
    setTimers, settings, settingsKey, setVideo, setWatch, setWsId, sharing, shotKey, showInfo, shown, showNew,
    shownWidgets, showPanel, sideOpen, sideW, sortedRows, sortItems, specsOn, split, stale, staleMin, start, statKey,
    stepItem, stepOf, stepsOn, strip, tab, tabByWs, tabsAt, targets, termIn, termsOk, termWhere, timers, tint, toast,
    todosOn, toggleArtifacts, toggleFull, togglePanel, toSettings, touch, travel, video, view, waits, watches,
    whereNow, wideBar, widgetApi, ws, wsActions, wsAt, wsHere, wsMore, zoom,
  }
  const parts = { ...appBase, ...menusOf(appBase), ...layoutOf(appBase) }
  const app: AppCtx = { ...parts, ...sideOf(parts) }
  const { wsMenu, tabMenu, fileMenu, applyLayout, peekCard } = app
  keys.current = (e, force, fixed) => onKey(app, e, force, fixed)
  return (
    <div style={{ ...(rail && { '--rail-w': `${railW}px` }), '--page-zoom': (fontSize / FONT_SIZE) * pageZoom, '--page-own': own } as CSSProperties /* the list pages' size (styles.css), as Settings'; the open page's own */} className={`app ${sideOpen || railUp ? '' : 'side-closed'} ${rail ? 'rail-on' : ''} ${listOff || (railUp && !sideOpen) ? 'list-off' : ''} ${narrow ? 'narrow' : ''} ${bridge && /Mac/.test(navigator.userAgent) ? 'electron' : ''} ${settings.dimPanes !== false ? 'dim-panes' : ''} ${full ? 'full' : ''} ${wideBar ? 'wide-status' : ''} ${strip ? `strip-${strip}` : ''} ${fromSnap.current ? 'from-snap' : ''}`} data-pad={settings.termPad} data-inset={settings.paneInset ? '' : undefined} {...(dz => dz && !narrow && !full && { 'data-design': settings.design, 'data-dz': dz })(designTraits(settings.design)) /* Appearance › Design: none on a phone or in full screen */}>
      {railBar}
      {(sideOpen || video) && <Sidebar app={app} /> /* hidden, not gone, while a video plays */}
      {strip === 'left' && stripBar}
      {sideOpen && !listOff && !strip && (narrow ? <div role="presentation" className="side-backdrop" onClick={() => setSideOpen(false)} /> : <SideHandle width={sideW} onWidth={setSideW} init={SIDE} at={(rail ? railW : 0) + (settings.design === 'frosted' ? 8 : 0) /* its frame's padding (looks.css --f-gap) */} />)}

      <main className={`main ${wsTint ? 'ws-tint' : ''}`} style={wsTint ? ({ '--ws': `var(--tc-${wsTint})` } as CSSProperties) : undefined /* Extras › Tint with the workspace's color: styles.css' --ws */}>
        {full && <IconButton icon="minimize" title={kt('Exit full screen', 'full')} className="full-exit" onClick={() => toggleFull(false)} />}
        <TabBar app={app} />
        {connected && staleDaemon(view) && <StaleDaemon restart={restartDaemon} />}
        {hung === 'yes' && (
          <div className="stale-bar soft" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>The daemon isn't answering.</b>{view.settings.ptyHost && !view.ptyHostOff && ' If you restart it, your terminals stay.'}
            </span>
            <button onClick={() => void bridge?.restartDaemon?.(true).then(ok => (ok ? setHung('no') : fail(new Error("the daemon didn't stop")))).catch(fail)}>Restart the daemon</button>
            <button onClick={() => setHung('waited')}>Wait</button>
          </div>
        )}
        {connected && view.trouble && view.trouble.at > troubleSeen && (
          <div className="stale-bar soft" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>Something went wrong inside Laki's daemon</b> ({view.trouble.n === 1 ? 'an error' : `${view.trouble.n} errors`} since it started; the last: {view.trouble.last}). It goes on running; a restart keeps your terminals.
            </span>
            <CopyDiagnostics />
            <button onClick={() => void restartDaemon().catch(fail)}>Restart the daemon</button>
            <IconButton icon="x" title="Dismiss" onClick={() => setTroubleSeen(view.trouble!.at)} />
          </div>
        )}
        {connected && view.diskFull && (
          <div className="stale-bar" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>The disk is full.</b> Laki can't save its state ({Math.round(view.diskFull.free / 1e6)} MB free): it keeps it in memory and saves once there's room. Don't quit Laki until then.
            </span>
            <button onClick={() => setDialog({ section: 'resources' })}>What Laki holds</button>
          </div>
        )}
        {connected && view.newerData && (
          <div className="stale-bar" role="alert">
            <Icon name="alertCircle" size={16} />
            <span>
              <b>This data was written by a newer Laki.</b> This one may not keep what it added: a copy is in Laki's data folder as state.json.v{view.newerData}. Update Laki to the version you used last.
            </span>
          </div>
        )}
        {connected && view.whenDone && (
          <div className="stale-bar soft" role="alert">
            <Icon name={view.whenDone.act === 'lock' ? 'lock' : view.whenDone.act === 'sleep' ? 'moon' : 'power'} size={16} />
            <span>
              <b>Everything is done.</b> The Mac {WHEN_DONE_WORDS[view.whenDone.act]} in <Countdown to={view.whenDone.at} />.
            </span>
            <button onClick={() => void api.call('settingsSet', { whenDone: 'off' })}>Cancel</button>
          </div>
        )}
        {connected && !staleDaemon(view) && oldSkills.length > 0 && (
          <div className="stale-bar soft" role="status">
            <Icon name="import" size={16} />
            <span>
              <b>Laki's skill is out of date in {[...new Set(oldSkills.map(r => r.name))].join(', ')}.</b> Its agents read older commands and paths than this Laki's.
            </span>
            <button onClick={() => void updateSkills()}>Update</button>
            <button className="ghost" onClick={() => ((skillsLater.current = true), setOldSkills([]))}>
              Not now
            </button>
          </div>
        )}
        {glow && <PeekGlow key={glow.n} tab={glow.tab} onDone={() => setGlow(null)} />}
        {locked && connected && (
          // D6: locked again after its idle minutes: nothing comes until it unlocks, so nothing of it shows
          <div className="splash pinning lock-over">
            <UnlockForm pin={locked.pin} />
          </div>
        )}
        {keyOffer && (
          <div className="stale-bar soft" role="status">
            <Icon name="fingerprint" size={16} />
            <span>
              <b>Unlock Laki here with Face ID or Touch ID?</b> A passkey of this device's: each time you open Laki here, and after a while without using it.
            </span>
            <button onClick={() => void passkeySetUp().then(() => (setKeyOffer(false), toast('Passkey set up: this device unlocks with it')), e => (passkeyReady('passkeyOptions'), !/NotAllowed|cancel/i.test(String(e?.name ?? e?.message)) && toast(String(e?.message ?? e))))}>Set up</button>
            <button className="ghost" onClick={() => setKeyOffer(false)}>
              Not now
            </button>
          </div>
        )}
        {connected && news.length > 0 && <WhatsNew version={appVersion} lines={news} onTry={setLink} onAll={() => (newsSeen(), setDialog({ section: 'notes' }))} onClose={newsSeen} />}
        <div className="body">
          {tabsAt === 'left' && <TabStrip app={app} />}
          <div className="term-wrap" data-review={reviewOn && ws ? '' : undefined}>
            {group ? (
              <Panes
                head={readSwitch}
                layout={group}
                active={tab?.id ?? null}
                drag={drag}
                label={label}
                color={id => colorOf(byId(id))}
                onMenu={(e, id) => wsTabMenu(e, tabMenu([id]))}
                ghost={drag && (() => { // a pill: the tab's glyph and names, as in the tab bar
                  const ts = (drag.whole ? tabsOf(groups.find(g => tabsOf(g).includes(drag.tab)) ?? null) : [drag.tab]).map(byId).filter((t): t is TabView => !!t)
                  return ts.length > 1 ? <><Glyph s={rollup(ts)} /><span>{ts.map(t => t.name).join(' · ')}</span></> : label(drag.tab)
                })()}
                render={id => floated.includes(id) ? (
                  <div className="floated">
                    <span>In a window of its own, over every app</span>
                    <div className="row">
                      <button onClick={() => floatTab(id)}>Show it</button>
                      <button onClick={() => floatTab(id, false)}>Bring it back</button>
                    </div>
                  </div>
                ) : (
                  <>
                  <Term
                    key={transparent() ? 'clear' : 'solid' /* xterm takes allowTransparency only as it opens */}
                    tab={id}
                    active={id === tab?.id && !dialog && !reviewOn && !inReader(id)}
                    findSeq={finds[id] ?? 0}
                    fontSize={narrow ? Math.min(sizeOf(id), 11) : sizeOf(id) /* ponytail: a phone's own size, not a setting */}
                    fontFamily={settings.fontFamily}
                    copyOnSelect={settings.copyOnSelect !== false}
                    editKeys={settings.editKeys !== false}
                    theme={theme}
                    look={termLook(settings)}
                    onFile={path => openPath(id, path)}
                    onReply={replyTo(id).length ? (text, at) => setReply({ tab: id, text, ...at }) : undefined}
                    onSelection={selectionTo(id)}
                    onCode={openCode(id)}
                    codeTo={settings.fileClick === 'editor' ? 'editor' : 'preview'}
                    image={peekImage(id)}
                    text={peekText(id)}
                    cwd={view?.workspaces.find(x => x.id === byId(id)?.workspace)?.path}
                  />
                  {inReader(id) && <Reader tab={byId(id)!} api={readerApi} active={id === tab?.id && !dialog && !reviewOn} look={{ tools: settings.readerTools, scroll: settings.readerScroll, times: settings.readerTimes }} />}
                  </>
                )}
                foot={id =>
                  (t =>
                    t && (
                      <>
                        <SecretStrip tab={t} onGive={(id, value) => call('secretGive', value === undefined ? { id, refuse: true } : { id, value })} />
                        <WorkerAsks asks={workerAsks(t.id)} onAnswer={(tab, n, label) => call('answer', { tab, n, label })} onOpen={(w, id) => (setReveal(r => [...r, w]), selectTab({ id, workspace: w }))} />
                        <ShowStrip tab={t} onClose={() => void call('showDone', { tab: t.id }).catch(() => {})} onCopy={copy} />
                        {(noBar || full) && t.kind === 'agent' && settings.turnChanges !== false && <TurnStrip tab={t} api={turnApi(t.workspace)} /> /* the status bar's Turns, when there's none (off, or full screen hides it) */}
                        <PlanStrip tab={t} onAnswer={n => call('answer', { tab: t.id, n })} onSend={text => void call('send', { target: t.id, text, whenIdle: true }).catch(() => {})} />
                        {t.queue?.length ? <QueueStrip tab={t} onSave={(q, was) => queueSave(t, q, was)} onRemove={i => queueRemove(t, i)} onNow={() => void call('queueNow', { tab: t.id }).catch(() => {})} onResume={() => void call('queueResume', { tab: t.id }).catch(() => {})} onClear={() => queueRemove(t)} /> : null}
                        {(c => c && c.tab === t.id && !checkHid.includes(`${t.workspace}:${c.at}`) && <CheckStrip tab={t} check={c} onAgain={() => void call('checkAgain', { ws: t.workspace }).catch(() => {})} onStop={() => void call('checkStop', { ws: t.workspace }).catch(() => {})} onSend={text => void call('send', { target: t.id, text, whenIdle: true }).then(() => (setCheckHid(h => [...h, `${t.workspace}:${c.at}`]), toast(`Sent to ${t.name}`)), () => {})} onHide={() => setCheckHid(h => [...h, `${t.workspace}:${c.at}`])} />)(view.workspaces.find(x => x.id === t.workspace)?.check)}
                        {(a => a && notInstalled(t) && (
                          <InstallStrip
                            agent={a}
                            onCopy={copy}
                            onInstall={cmd => void call<{ id: string }>('tabNew', { ws: t.workspace, kind: 'shell' }).then(sh => call('send', { target: sh.id, text: cmd, enter: false })).catch(fail)}
                            onAgain={() => void call('input', { tab: t.id, data: '\r' }).catch(fail)}
                          />
                        ))(tabAgent(t, view?.presets))}
                        {!hookHid.includes(t.id) && <HookStrip tab={t} onCopy={copy} onHide={() => setHookHid(h => [...h, t.id])} />}
                        {/* Send later's for this tab: its timers, also over the sidebar's foot */}
                        <LaterStrip tab={t} later={timers.filter(x => x.then === 'send' && x.tab === t.id)} onNow={ring} onEdit={x => setDialog({ sendLater: t.workspace, edit: x })} onCancel={x => setTimer(x, () => null)} />
                      </>
                    ))(byId(id))
                }
                onFocus={id => id !== tab?.id && selectTab(id)}
                hoverFocus={settings.hoverFocus !== false}
                onClose={id => byId(id) && closeTabs([byId(id)!])}
                onResize={(path, at) => setGroups(groups.map(g => (g === group ? resize(g, path, at) : g)))}
                startDrag={(e, id) => start(e, id, false)}
              />
            ) : (
              <div className="empty">
                {ws ? (
                  ws.browser === undefined && <Ready name={wsName(ws)} branch={ws.kind === 'worktree' ? ws.branch : undefined} project={view.projects.find(p => p.id === ws.project)?.name} actions={newTabActions.filter(x => x.label !== 'Command…')} later={ws.pending && { title: `${ws.pending.agent} ${pendingWords(ws.pending, true).replace(/^S/, 's')}`, prompt: ws.pending.prompt, failed: ws.pending.failed, onStart: () => laterNow(ws), onChange: () => void laterChange(ws), onCancel: () => void laterCancel(ws) }} />
                ) : (
                  view.projects.some(p => !p.kind) || railKind !== 'projects' ? ( /* U4: Welcome until a project of yours, a Terminals tab of its own aside */
                    <>
                      {/* none picked: a fresh start, or the last of this rail kind went (the rail stays on it) */}
                      <p>{railKind === 'shells' ? 'No terminals open.' : railKind === 'browsers' ? 'No pages open.' : live.length ? 'No workspace selected.' : 'No workspaces yet.'}</p>
                      {railKind === 'shells' || railKind === 'browsers' ? <button className="primary" onClick={() => void quickNew(railKind)}>{railKind === 'shells' ? 'New terminal' : 'New browser'}</button> : <button className="primary" onClick={() => newWs()}>New workspace  ⌘N</button>}
                      <StarLaki />
                    </>
                  ) : (
                    <Welcome onOpen={openProject} onSsh={() => setDialog('project')} onClone={() => setDialog('clone')} check={() => api.call<Doctor>('doctor')} onRun={welcomeRun} onSample={hasCap(view, 'sample') ? welcomeSample : undefined} />
                  )
                )}
              </div>
            )}
            {browsed.flatMap(id => {
              const w = live.find(x => x.id === id)
              return w?.browser !== undefined ? [<BrowserPane key={id} onGuest={g => (g ? guests.current.set(id, g) : guests.current.delete(id))} url={w.browser} hidden={id !== ws?.id || !!dialog} onPage={(url, title) => pageSeen(id, url, title)} onOpen={openExternal} onShot={r => (r.error ? toast(`No screenshot: ${r.error}`) : r.path ? toast(`Saved to Downloads: ${r.path.split('/').pop()}`, () => void bridge?.openPath?.(r.path!), 'Open', true) : done('Screenshot copied'))} />] : []
            })}
            {reviewOn && ws && <Suspense fallback={null}><FullReview key={ws.id} ws={ws.id} base={ws.base} branch={ws.branch} pr={ws.pr} linked={ws.prLinked} empty={!ws.stat?.files} worktree={ws.kind === 'worktree'} api={reviewApi(ws)} stat={statKey} onOpen={openExternal} onTight={() => setReviewTight(true)} /></Suspense>}
          </div>
          {tabsAt === 'right' && <TabStrip app={app} />}
          {previewed && ws && (
            <div className={`pv-wrap ${previewW ? 'sized' : ''}`} style={previewW ? { width: previewW } : undefined}>
              <PanelHandle onWidth={w => setPreviewW(w || null)} init={0} />
              {wsFiles.length > 1 && (
                <div className="pv-tabs" role="tablist" aria-label="Open files">
                  {wsFiles.map(f => (
                    <div key={fileKey(f)} role="tab" aria-selected={f === previewed} className={`pv-tab ${f === previewed ? 'on' : ''}`} data-tip={`${f.ext ? `${view.widgets?.find(x => x.id === f.ext)?.name ?? f.ext} · ` : ''}${f.storage ? `Artifacts › ${f.path}` : f.path}`} onClick={() => setShownFile(m => ({ ...m, [ws.id]: fileKey(f) }))} onAuxClick={e => e.button === 1 && void closeFile(f)}>
                      {(x => (x ? <ExtGlyph w={x} size={12} /> : <Icon name="file" size={12} />))(f.ext && view.widgets?.find(x => x.id === f.ext))}
                      <span className="pv-tab-name">{f.path.split('/').pop()}</span>
                      {edited(f.edit) && <span className="pv-dirty" aria-label="unsaved" />}
                      <IconButton icon="x" title="Close" className="pv-tab-x" onClick={e => (e.stopPropagation(), void closeFile(f))} />
                    </div>
                  ))}
                </div>
              )}
            {previewed.ext ? (
              // a file opener's full view, its data what its action on this file kept
              // ponytail: one data per extension (per workspace): two files' tabs of one opener show the last one run
              (w => (
                <div className="preview">
                  <div className="pv-head">
                    {w ? <ExtGlyph w={w} /> : <Icon name="panel" />}
                    <span className="pv-path" data-tip={previewed.path}>
                      {w?.name ?? previewed.ext} <span className="muted">{previewed.path}</span>
                    </span>
                    {w && <span className="muted small pv-wide">{extStatus(w)}</span>}
                    <IconButton icon="x" title={kt('Close', 'closeTab')} onClick={closePreview} />
                  </div>
                  <div className="pv-body pv-ext">{w ? <WidgetBody w={w} full api={widgetApi} /> : <div className="muted small pad">That extension is gone (or off).</div>}</div>
                </div>
              ))((x => (x?.on ? inWs(x, ws.id) : undefined))(view.widgets?.find(x => x.id === previewed.ext)))
            ) : (
            <FilePreview
              key={previewed.n}
              path={previewed.path}
              line={previewed.line}
              load={() => api.call<FileContent>('fileRead', { ws: ws.id, path: previewed.path, storage: previewed.storage, media: true })}
              onOpen={() => (previewed.storage ? panelApi(ws).artifacts?.open(previewed.path) : panelApi(ws).openFile(previewed.path))}
              onDefault={() => openIn('default', { ws: ws.id, file: previewed.path, storage: previewed.storage })}
              onEditor={previewed.storage ? () => openIn('editor', { ws: ws.id, file: previewed.path, storage: true }) : undefined}
              onReveal={() => openIn('finder', { ws: ws.id, file: previewed.path, storage: previewed.storage })}
              openLabel={previewed.storage ? 'Open' : undefined}
              readOnly={previewed.storage}
              onClose={closePreview}
              edit={previewed.edit}
              onEdit={edit => setOpenFiles(l => l.map(x => (x.ws === previewed.ws && fileKey(x) === fileKey(previewed) ? { ...x, edit } : x)))}
              save={(text, was, force) => api.call('fileWrite', { ws: ws.id, path: previewed.path, text, was, force })}
            />
            )}
            </div>
          )}
          {panelShown && !(reviewOn && reviewTight) && ws && ( // the right panel: Info, Files, Changes, Review, Preview (U6: not beside a Review tab too narrow for its diff)
            <SidePanel
              w={infoOf(ws)}
              git={git}
              tab={panelTab}
              onTab={setPanelTab}
              api={panelApi(ws)}
              sim={project?.config?.simulator ?? settings.simulator === true} /* the project's own over Settings' */
              turn={view.tabs.some(t => t.workspace === ws.id && t.changes)}
              width={panelW}
              onWidth={setPanelW}
              onClose={() => setPanelOpen(false)}
              onOpen={openExternal}
              onToggle={(k, v) => setAuto(ws, k, v)}
              onFix={what => prFix(ws, what)}
              onLog={c => ciLog(ws, c)}
              onAct={(act, method) => prAct(ws, act, method)}
              onLabel={labelApi(ws)}
              root={artsIn === ws.id ? 'artifacts' : 'ws'}
              onRoot={(r: FilesRoot) => setArtsIn(r === 'artifacts' ? ws.id : null)}
              ext={ownWidgets.filter(w => w.on && placesOf(w).includes('panel')).map(w => ({ id: `ext:${w.id}` as const, label: w.name, icon: <ExtGlyph w={w} size={14} />, body: <WidgetPanel w={w} api={widgetApi} /> }))}
              side={(t => t && <SideChat key={t.id} tab={t} onSent={done} />)(tab?.kind === 'agent' && tab.workspace === ws.id ? tab : view.tabs.find(t => t.workspace === ws.id && t.kind === 'agent'))}
              info={
                <InfoTab
                w={infoOf(ws)}
                onOpen={url => void openKeptLink(url).catch(fail) /* its .url links too: a file:/// one */}
                onToggle={(k, v) => setAuto(ws, k, v)}
                onFix={what => prFix(ws, what)}
                onLog={c => ciLog(ws, c)}
                onAct={(act, method) => prAct(ws, act, method)}
                onLabel={labelApi(ws)}
                onRename={() => setDialog({ renameWs: ws.id })}
                onAttach={attachable(ws) ? () => setDialog({ attachPr: ws.id }) : undefined}
                onCopy={copy}
                onWs={id => (setReveal(r => [...r, id]), setWsId(id))}
                onTab={(w, t) => (setReveal(r => [...r, w]), selectTab({ id: t, workspace: w }))}
                onPrimary={url => call('prAttach', { ws: ws.id, pr: url }).then(r => done(`PR #${(r as { number: number }).number} is this workspace's PR`), () => {})}
                onUnrelate={url => call('wsSet', { id: ws.id, unrelate: url }).catch(() => {})}
                onDetach={() => detachPr(ws)}
                sees={(['claude', 'codex'] as const).filter(a => !ws.host && view.tabs.some(t => t.workspace === ws.id && tabAgent(t, view.presets) === a))}
                onSees={a => setDialog({ sees: a, in: ws.project })}
                onStorage={bridge?.openPath && ws.storage ? () => void bridge!.openPath!(ws.storage!).then(r => r === 'missing' && toast('Nothing kept yet: its folder is made with its first tab')) : undefined}
                />
              }
            />
          )}
        </div>
        {tab?.ask && !tab.planAsk /* its plan card has them */ && !(inReader(tab.id) && !reviewOn && !(narrow && (panelOpen || previewed))) /* the Reader's own card has them, unless the review or a phone's panel is over it */ && (
          // the waiting agent's menu as buttons (a phone's thumb, or no reaching for arrows): the daemon moves and presses ⏎
          <AskWrap key={`${tab.id}:${tab.ask.what}`} diff={tab.ask.diff}>{chip => (
          <div className="ask-bar">
            {tab.ask!.tool ? (
              // claude's permission ask (PermissionRequest): the tool and what it touches, the change it makes (chip)
              <>
                <span className="tag ask-tool">{tab.ask!.tool}</span>
                <span className="ask-what mono" data-tip={tab.ask!.what}>{tab.ask!.what}</span>
                {chip}
              </>
            ) : (
              <span className="muted">{tab.name} asks:</span>
            )}
            {tab.ask!.options.map(o => {
              const label = optLabel(tab.ask!, o)
              return (
                <button key={o.n} className={o.n === tab.ask!.options[0].n ? 'primary' : ''} data-tip={o.label} onClick={() => call('answer', { tab: tab.id, n: o.n, label: o.label }).catch(() => {})}>
                  {o.n}. {label.length > 48 ? `${label.slice(0, 46)}…` : label}
                </button>
              )
            })}
            {!view.managed?.allowRules && ruleFrom(tab.ask) && (
              <button className="link small" data-tip="A rule of the project's: the same ask from any agent here is answered Allow (Settings › the project › Auto-answer rules)" onClick={() => void alwaysAllow(tab).catch(() => {})}>
                Always allow here
              </button>
            )}
          </div>
          )}</AskWrap>
        )}
        {touch && tab && !(narrow && (panelOpen || previewed)) /* not under a panel */ && (
          <KeyBar onKey={data => api.send('input', { tab: tab.id, data: xterms.get(tab.id)?.modes.applicationCursorKeysMode ? data.replace(/^\x1b\[([ABCD])$/, '\x1bO$1') : data })} />
        )}
        {tabsAt === 'bottom' && <TabStrip app={app} />}
        <Pages app={app} />
        {!wideBar && statusBar}
        {aiFab && (
          <>
            {aiFloat && (
              <AiFloat>
                <Suspense fallback={null}>
                <AiPage compact settings={settings.ai ?? {}} workspaces={aiNames} onClose={() => setAiFloat(false)} context={whereNow} inserts={extInserts(hereCtx())} complete={completeOf(view, { project: extWs(ws)?.project })} />
                </Suspense>
              </AiFloat>
            )}
            {!aiDock ? (
              <FabCorner key={ws?.id ?? ''} className={`ai-fab-wrap ${fly}`}>
                <button type="button" className={`ai-fab ${aiFloat ? 'on' : ''}`} aria-label={aiFloat ? 'Close Laki AI' : 'Ask Laki AI'} data-tip={aiFloat ? 'Close (Esc)' : 'Ask Laki AI about what is on screen'} onClick={() => setAiFloat(o => !o)} onContextMenu={e => openMenu(e, [{ label: noBar ? 'Minimize' : 'Minimize to the status bar', icon: 'minimize', run: () => dock(true) }])}>
                  <Icon name={aiFloat ? 'x' : 'ai'} size={17} />
                </button>
                {!aiFloat && (
                  <button type="button" className="ai-fab-min" aria-label={noBar ? 'Minimize' : 'Minimize to the status bar'} data-tip={noBar ? 'Minimize: a small AI pill here' : 'Minimize to the status bar'} onClick={() => dock(true)}>
                    <Icon name="minus" size={10} />
                  </button>
                )}
              </FabCorner>
            ) : (
              noBar && ( // minimized with no status bar to hold it: a small pill in the button's corner, like the Terminal | Reader switch
                <FabCorner key={ws?.id ?? ''} className="ai-mini-wrap">
                  <button type="button" className={`ai-mini ${aiFloat ? 'on' : ''}`} data-tip={`${aiFloat ? 'Close Laki AI (Esc)' : 'Ask Laki AI about what is on screen'} · right click: float the button again`} onClick={() => setAiFloat(o => !o)} onContextMenu={e => openMenu(e, [{ label: 'Float the button again', icon: 'popOut', run: () => dock(false) }])}>
                    <Icon name="ai" size={11} />
                    AI
                  </button>
                </FabCorner>
              )
            )}
          </>
        )}
      </main>
      {strip === 'right' && stripBar}
      {wideBar && statusBar}

      {menu}
      <Tips />
      {peek && (w => w && peekCard(w))(live.find(w => w.id === peek.id))}
      <AskHost />
      <VoiceBar />
      {dropping && <div className="drop-overlay">Drop a folder to add it as a project</div>}
      {unlocked.length > 0 && (
        <button className={`ach-toast ${note ? 'up' : ''}` /* over a toast at the same time (an archive's Undo) */} aria-live="polite" onClick={() => (setUnlocked([]), setDialog('achievements'))}>
          <Icon name="trophy" size={14} />
          <span>
            Unlocked: <b>{ACHIEVEMENTS.find(a => a.id === unlocked.at(-1))?.title}</b>
            {unlocked.length > 1 && ` and ${unlocked.length - 1} more`}
          </span>
          <span className="muted small">{achN}/{achAll.length}</span>
        </button>
      )}
      {!bridge && <Outbox name={id => view.tabs.find(t => t.id === id)?.name ?? 'a tab'} />}
      {note && (
        <div className={`toast ${note.undo ? 'has-undo' : ''} ${note.ok || note.busy ? 'ok' : ''} ${note.err ? 'err' : ''}`} role={note.err ? 'alert' : 'status'}>
          {note.ok && <Icon name="check" size={14} />}
          {note.busy && <Glyph s="running" />}
          <span>{note.text}</span>
          {note.undo && (
            <button className="toast-undo" onClick={() => (setNote(null), note.undo!())}>
              {note.label ?? 'Undo'}
            </button>
          )}
        </div>
      )}
      <Dialogs app={app} />
    </div>
  )
}
