// ⌘K: the palette (Palette) and what App puts in it (paletteItems: built as it shows, from what appCtx.ts says it reads)
import type { AppCtx } from './appCtx'
import { type IconName, type MenuItem, Icon, ON, ProjectMark } from './ui'
import { type ReactNode, useState, useMemo, useRef, useEffect } from 'react'
import { type PalKind, paletteGroups, fuzzy, PAL_RECENT, needsSorted, prNo, rowFact } from './text'
import { Glyph, rollup } from './Glyph'
import { Modal } from './panels'
import { type Action, wsName } from './appCtx'
import { aiOn, HOME_ACCOUNT, AGENT_NAMES } from '../../shared/types'
import { cmdMap, keyShow } from '../../shared/keys'
import { LAYOUT_PRESETS } from '../../shared/layout'
import { api, bridge, openExternal } from './api'
import { tabGlyph, prNum, appIcon, SCRIPT_ICONS } from './appCtx'

export type PaletteItem = { id?: string; label: string; hint?: string; glyph?: string; icon?: IconName; mark?: ReactNode; run: () => void; kind?: PalKind; more?: () => MenuItem[]; find?: string[] } // mark: before the hint (its project's); kind: its group (text.ts paletteGroups; none: an action); more: ⇥'s actions (its ⋯ menu); find: links a pasted one matches (a workspace's PRs)

export { fuzzy } from './text' // the palette's matching

// what the palette ran last (labels, newest first; localStorage laki.recent): first in it, and ahead when they match
const recent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('laki.recent') ?? '[]')
  } catch {
    return []
  }
}

// ⌘K: groups under headings (text.ts paletteGroups). ⇥ on a workspace or a tab shows its own actions in here (its ⋯
// menu, the same items), filtered as you type; Esc or ⇧⇥ goes back, a submenu goes in with ⇥ or ⏎
type Step = { title: string; items: MenuItem[]; q: string; i: number } // an actions list, and where the one under it was
const acts = (xs: MenuItem[]) => xs.filter((m): m is Extract<MenuItem, { label: string }> => !!m && 'label' in m)
export function Palette({ items, onClose, forName }: { items: PaletteItem[]; onClose: () => void; forName?: string }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [steps, setSteps] = useState<Step[]>([])
  const ran = useMemo(recent, [])
  const groups = useMemo(() => paletteGroups(items, q, ran, forName), [items, q, ran, forName])
  const step = steps.at(-1)
  const shown = step ? acts(step.items).filter(m => fuzzy(q, `${m.label} ${m.sub ?? ''}`) > 0) : []
  const list: (PaletteItem | (typeof shown)[number])[] = step ? shown : groups.flatMap(g => g.items)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => void ref.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }), [i, steps.length])
  const pick = (x?: PaletteItem) => {
    if (!x) return
    try {
      localStorage.setItem('laki.recent', JSON.stringify([x.label, ...recent().filter(l => l !== x.label)].slice(0, PAL_RECENT)))
    } catch {}
    onClose()
    x.run()
  }
  const into = (title: string, xs: MenuItem[]) => (setSteps(s => [...s, { title, items: xs, q, i }]), setQ(''), setI(0))
  const back = () => step && (setSteps(s => s.slice(0, -1)), setQ(step.q), setI(step.i))
  const runAct = (m?: (typeof shown)[number], deeper = false) => {
    if (!m) return
    if (m.items) return into(m.label, m.items)
    if (deeper) return
    onClose()
    m.run()
  }
  const row = (x: PaletteItem | (typeof shown)[number], n: number) => {
    const p = x as PaletteItem
    const m = x as (typeof shown)[number]
    return (
      <div key={x.label + n} className={`palette-item ${n === i ? 'sel' : ''} ${step && m.danger ? 'danger' : ''}`} onMouseMove={() => setI(n)} onClick={() => (step ? runAct(m) : pick(p))}>
        <span className="pg">{x.icon ? <Icon name={x.icon} /> : !step && p.glyph && <Glyph s={p.glyph} />}</span>
        <span className="pl">{x.label}</span>
        <span className="ph muted">
          {x.mark}
          {step ? (m.items ? '›' : m.sub ?? (m.hint === ON ? '✓' : m.hint)) : p.hint}
        </span>
        {!step && p.more && n === i && <span className="palette-tab">⇥</span>}
      </div>
    )
  }
  let n = 0
  return (
    <Modal title="Go to" onClose={onClose} wide loose>
      {step && (
        <div className="palette-crumb">
          <button className="ghost" onClick={back} aria-label="Back">
            <Icon name="chevronLeft" size={12} />
          </button>
          {steps.map(s => s.title).join(' › ')}
        </div>
      )}
      <input
        className="palette-input"
        value={q}
        autoFocus
        placeholder={step ? `What to do with ${step.title}…` : 'Workspace, tab or action…'}
        onChange={e => {
          setQ(e.target.value)
          setI(0)
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') setI(n => Math.min(n + 1, list.length - 1))
          else if (e.key === 'ArrowUp') setI(n => Math.max(n - 1, 0))
          else if (e.key === 'Enter') step ? runAct(list[i] as (typeof shown)[number]) : pick(list[i] as PaletteItem)
          else if (e.key === 'Tab' && e.shiftKey) back()
          else if (e.key === 'Tab') step ? runAct(list[i] as (typeof shown)[number], true) : (x => x?.more && into(x.label, x.more()))(list[i] as PaletteItem)
          else if (e.key === 'Escape' && step) back()
          else return
          e.preventDefault()
        }}
      />
      <div className="palette-list" ref={ref}>
        {step
          ? shown.map(m => row(m, n++))
          : groups.map(g => (
              <div key={g.head} className="palette-group" role="group" aria-label={g.head}>
                <div className="palette-head">{g.head}</div>
                {g.items.map(x => row(x, n++))}
              </div>
            ))}
        {!list.length && <div className="muted pad">Nothing matches.</div>}
      </div>
      <div className="palette-foot muted">{step ? '⏎ run · ⇧⇥ or esc back' : '⏎ open · ⇥ actions · esc close'}</div>
    </Modal>
  )
}

// ⌘K's items: for the workspace you're in first, then every workspace, tab and action
export function paletteItems(app: AppCtx): PaletteItem[] {
  const { accountsOf, achKept, aiDock, allows, call, canOverlap, checkOverlaps, closePreview, closeTabs, copyTab, devRunning, devTab, dock, editor, editScripts, extMenus, extRun, find, floated, floatTab, flowItems, flowMenu, flowsHere, flowsOn, full, gallery, git, hereCtx, keyText, kh, layoutMenu, live, needing, newTabActions, newWs, nextNeed, openIn, openPort, openProject, order, prAct, previewed, prFix, project, projOf, quickNew, restore, run, runFlow, runScript, selectTab, sendLater, setDialog, setFind, setFolded, setOnboard, setSharing, setSideOpen, setTimers, settings, setVideo, setWsId, showInfo, showPanel, sideOpen, specsOn, staleMin, tab, tabMenu, targets, timers, toast, toggleArtifacts, toggleFull, video, view, ws, wsActions, wsMenu } = app
  const items: PaletteItem[] = []
  const cmds = cmdMap(settings.cmdKeys)
  const a = (x: Action & { id?: string }) => items.push({ ...x, hint: (x.id && cmds[x.id] && keyShow(cmds[x.id])) || (x.hint ?? 'action') }) // id: a key can be given it (Settings › Keys)
  // For <workspace>: its next step, only the ones that apply
  if (ws) {
    const wt = view!.tabs.filter(t => t.workspace === ws.id)
    const f = (x: Action) => items.push({ ...x, kind: 'for' })
    const asks = wt.find(t => t.status === 'waiting')
    if (asks) f({ label: `Answer ${asks.name}: ${asks.ask?.question || asks.ask?.options.map(o => o.label).join(' / ') || 'it waits for you'}`, icon: 'bell', run: () => selectTab(asks) })
    const failed = wt.find(t => t.failed)
    if (failed) f({ label: `Continue ${failed.name}: ${failed.failed}`, icon: 'run', run: () => void call('send', { target: failed.id, text: 'continue' }).catch(() => {}) })
    const pr = ws.pr?.state === 'OPEN' ? ws.pr : undefined
    if (pr?.checks === 'fail') f({ label: `Fix CI: send ${prNo(pr)}'s failing checks to the agent`, icon: 'ciFail', run: () => void prFix(ws, 'ci') })
    if (pr?.conflict) f({ label: `Resolve conflicts with ${pr.base ?? 'the base'}`, icon: 'conflict', run: () => void prFix(ws, 'conflict') })
    if (pr && !pr.draft && pr.checks === 'pass' && !pr.conflict && pr.ready !== false && allows(ws, 'merge')) f({ label: `Merge ${prNo(pr)}…`, icon: 'pr', run: () => prAct(ws, 'merge') })
    if (ws.kind === 'worktree' && !ws.pr && (ws.stat ? ws.stat.files > 0 || ws.stat.dirty > 0 : wt.some(t => t.kind === 'agent' && t.last))) f({ label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') })
    if (git && wt.some(t => t.kind === 'agent' && t.done && t.status === 'idle')) f({ label: 'Review changes: the agent is done', icon: 'changes', run: () => showPanel('changes') })
  }
  // Needs you: every other tab of needsYou, in its order
  for (const t of needsSorted(needing, staleMin)) {
    const w = t.workspace !== ws?.id && live.find(w => w.id === t.workspace)
    if (w) items.push({ label: t.status === 'waiting' ? `Answer ${wsName(w)}: ${t.ask?.question || t.ask?.options[0]?.label || 'it waits for you'}` : t.failed ? `${wsName(w)} stopped: ${t.failed}` : `${wsName(w)} is done`, hint: t.name, glyph: tabGlyph(t), kind: 'needs', mark: <ProjectMark p={projOf(w)} />, run: () => selectTab(t) })
  }
  if (ws) a({ label: 'Find files…', icon: 'search', hint: kh('files'), run: () => setDialog('files') })
  for (const w of order) items.push({ kind: 'ws', more: () => wsMenu(w), label: wsName(w), hint: [(f => f.kind !== 'branch' && f.text)(rowFact(w, view!.tabs.filter(t => t.workspace === w.id))), w.branch || 'folder', prNum(w)].filter(Boolean).join(' · '), glyph: rollup(view!.tabs.filter(t => t.workspace === w.id)), mark: <ProjectMark p={projOf(w)} />, find: [w.pr?.url, w.prUrl, w.issue?.url, ...(w.related ?? [])].filter((u): u is string => !!u), run: () => setWsId(w.id) })
  for (const t of view?.tabs ?? []) {
    const w = live.find(w => w.id === t.workspace)
    if (w) items.push({ kind: 'tab', more: () => tabMenu([t.id]), label: `${wsName(w)} / ${t.name}`, hint: t.last ? t.last.slice(0, 80) : 'tab', glyph: tabGlyph(t), mark: <ProjectMark p={projOf(w)} />, run: () => selectTab(t.id) })
  }
  a({ label: 'Next tab that needs you', icon: 'bell', hint: kh('next'), run: nextNeed })
  for (const { w, m } of extMenus('palette', ws)) a({ label: `${w.name}: ${m.title}`, icon: 'panel', hint: m.key ? keyText(m.key) : 'extension', run: () => void extRun(w, m, hereCtx()) })
  a({ label: full ? 'Exit full screen' : 'Full screen: just this tab', icon: full ? 'minimize' : 'maximize', hint: kh('full'), run: () => toggleFull() })
  if (aiOn(settings)) a({ id: 'aiLater', label: 'Ask Laki AI later…', icon: 'timer', run: () => sendLater('ai') })
  if (aiOn(settings) && settings.ai?.float !== false && aiDock) a({ label: 'Float the Laki AI button again', icon: 'popOut', run: () => dock(false) }) // minimized: where no status bar shows it too
  if (ws?.storage) a({ label: gallery === ws.id ? 'Hide artifacts' : 'Show artifacts', icon: 'image', hint: kh('artifacts'), run: toggleArtifacts })
  for (const race of new Set(live.flatMap(w => (w.race ? [w.race] : [])))) {
    const w = live.find(w => w.race === race)!
    a({ label: `Compare the race: ${wsName(w).replace(/-[^-]+$/, '')}`, icon: 'race', run: () => setDialog({ compare: race }) })
  }
  a({ label: 'New workspace', icon: 'plus', hint: kh('newWs'), run: () => newWs(ws?.project) })
  a({ label: 'Open project folder…', icon: 'folderPlus', hint: '⌘O', run: openProject })
  a({ id: 'terminal', label: 'New terminal (in your home folder)', icon: 'terminal', run: () => quickNew('shells') })
  a({ id: 'start', label: 'Get started: the first steps', icon: 'check', run: () => (setOnboard(o => ({ ...o, off: false })), setDialog('onboard')) })
  a({ id: 'browser', label: 'New browser', icon: 'globe', run: () => quickNew('browsers') })
  a({ id: 'ssh', label: 'Open a project over SSH…', icon: 'server', run: () => setDialog('project') })
  a({ label: 'Settings', icon: 'gear', hint: kh('settings'), run: () => setDialog('settings') })
  a({ id: 'themes', label: 'Themes: change how Laki looks', icon: 'palette', run: () => setDialog({ section: 'appearance', spot: 'Theme' }) }) // Settings › Appearance, at its Theme card, lit
  a({ id: 'schedules', label: 'Scheduled tasks', icon: 'clock', run: () => setDialog('schedules') })
  a({ id: 'board', label: 'Board: every workspace by where it is, and to-dos', icon: 'board', run: () => setDialog('board') })
  if (!achKept.off) a({ id: 'achievements', label: 'Achievements: what to try next', icon: 'trophy', run: () => setDialog('achievements') })
  if (specsOn) a({ id: 'specs', label: 'Specs & Brainstorms: requirements to implement, ideas to explore', icon: 'spec', run: () => setDialog({ specs: '' }) })
  if (flowsOn) a({ id: 'workflows', label: 'Workflows: blocks Laki runs for a task, and their runs', icon: 'flow', run: () => setDialog({ workflows: '' }) })
  // Run workflow: each one, in the selected workspace (none, or one it can't run in: the Run sheet asks)
  const flowWs = flowsOn && ws && flowMenu(ws).length ? ws : undefined
  if (flowsOn) for (const f of flowWs ? flowsHere(flowWs) : flowItems) if (!f.problems.length) a({ label: `Run workflow: ${f.name}`, icon: 'flow', hint: flowWs ? wsName(flowWs) : 'workflow', run: () => runFlow(f, flowWs?.id) })
  if (settings.birdView !== false) a({ id: 'bird', label: 'Bird view: every live session and its screen', icon: 'eye', run: () => setDialog('bird') })
  a({ id: 'usage', label: 'Usage: tokens and cost by day and model', icon: 'activity', run: () => setDialog('usage') })
  if (settings.calendar !== false) a({ id: 'calendar', label: 'Calendar: scheduled tasks and reminders by week or month', icon: 'calendar', run: () => setDialog('calendar') })
  if (settings.desk !== false) a({ id: 'desk', label: 'My Desk: your extensions as tiles, an overview of what is going on', icon: 'desk', run: () => setDialog('desk') })
  if (settings.notes !== false) a({ id: 'notes', label: 'Notes: your own, for any project', icon: 'note', run: () => setDialog({ note: '' }) })
  if (settings.todoList !== false) a({ id: 'todos', label: 'To-dos: your checklist', icon: 'listChecks', run: () => setDialog('todos') })
  if (aiOn(settings)) a({ id: 'ai', label: 'Laki AI: ask Laki to work your agents, and what it cost', icon: 'ai', run: () => setDialog('ai') })
  if (settings.devMode) a({ label: "Release notes: what's new in Laki", icon: 'file', run: () => setDialog({ section: 'notes' }) })
  for (const w of view?.widgets ?? []) if (w.on && w.full && (!w.project || w.project === ws?.project)) a({ label: `Extension: ${w.name}`, icon: 'panel', run: () => setDialog({ widget: w.id }) })
  a({ id: 'extensions', label: 'Extensions (plugins): settings, reload, delete', icon: 'panel', run: () => setDialog({ section: 'widgets' }) })
  a({ id: 'newExtension', label: aiOn(settings) ? 'New extension…: make one with Laki AI, on its page' : 'New extension…: its page, the prompt for any AI chat', icon: 'plus', run: () => setDialog({ extension: '' }) })
  a({ id: 'starters', label: 'New extension from a starter…: each one shown on its sample data', icon: 'plus', run: () => setDialog('starters') })
  a({ id: 'uikit', label: 'UI kit: the elements an extension is made of, each with its JSON', icon: 'panel', run: () => setDialog({ uikit: true }) })
  a({ id: 'icons', label: 'Icons: every icon an extension can use, by name', icon: 'smile', run: () => setDialog({ uikit: true, icons: true }) })
  a({ id: 'resources', label: 'Resources: memory and CPU by tab', icon: 'memory', run: () => setDialog({ section: 'resources' }) })
  a({ label: 'Help: keys and commands', icon: 'help', hint: kh('help'), run: () => setDialog('help') })
  a({ id: 'about', label: 'About Laki', icon: 'info', run: () => setDialog('about') })
  a({ id: 'collapseAll', label: 'Collapse all projects', icon: 'chevronRight', run: () => setFolded(view?.projects.map(p => p.id) ?? []) })
  a({ id: 'expandAll', label: 'Expand all projects', icon: 'chevron', run: () => setFolded([]) })
  a({ label: sideOpen ? 'Hide sidebar' : 'Show sidebar', icon: 'sidebar', hint: kh('sidebar'), run: () => setSideOpen(o => !o) })
  a({ label: video ? 'Another YouTube video…' : 'Watch a YouTube video…', icon: 'youtube', run: () => setDialog('video') })
  if (video) a({ label: 'Close the video', icon: 'x', run: () => setVideo(null) })
  const ticking = timers.filter(t => t.then !== 'remind').length // reminders stay
  if (ticking) a({ label: ticking > 1 ? 'Stop all timers' : 'Stop the timer', icon: 'stop', run: () => setTimers(l => l.filter(t => t.then === 'remind')) })
  a({ id: 'timer', label: 'Start a timer…', icon: 'timer', run: () => setDialog('timer') })
  if (ws) a({ id: 'remind', label: `Remind me about ${wsName(ws)}…`, icon: 'timer', run: () => setDialog({ remind: ws.id }) })
  a({ label: find ? 'Stop filtering the sidebar' : 'Filter the sidebar…', icon: 'filter', run: () => (setSideOpen(true), setFind(f => (f ? null : { q: '' }))) })
  if (!view?.remote) {
    // the way Settings has it: Laki's PIN, or the saved email
    if (settings.remoteAuth === 'tailscale') a({ label: `Start remote access ${settings.remoteFunnel ? 'on the internet (Tailscale Funnel)' : 'on your tailnet'}, 1 hour`, icon: 'link', run: () => (call('remoteStart', { hours: 1, via: 'tailscale', pin: !!(settings.remoteTsPin || settings.remoteFunnel), funnel: !!settings.remoteFunnel }).catch(() => {}), setDialog({ section: 'remote' })) })
    else if (settings.remoteAuth === 'pin') a({ label: 'Start remote access with a PIN, 1 hour', icon: 'link', run: () => (call('remoteStart', { hours: 1, pin: true }).catch(() => {}), setDialog({ section: 'remote' })) })
    else if (settings.remoteMail) a({ label: `Start remote access for ${settings.remoteMail}, 1 hour`, icon: 'link', run: () => (call('remoteStart', { hours: 1, mail: settings.remoteMail }).catch(() => {}), setDialog({ section: 'remote' })) })
    a({ id: 'remote', label: 'Remote access…', icon: 'link', run: () => setDialog({ section: 'remote' }) })
  } else {
    a({ label: 'Remote access: the link and QR code', icon: 'link', run: () => setDialog({ section: 'remote' }) })
    a({ id: 'remoteStop', label: 'Stop remote access', icon: 'stop', danger: true, run: () => call('remoteStop').catch(() => {}) })
  }
  a({ id: 'notify', label: `Turn macOS notifications ${settings.notify === false ? 'on' : 'off'}`, icon: 'bell', run: () => call('settingsSet', { notify: settings.notify === false }).catch(() => {}) })
  a({ id: 'recording', label: `Recording mode ${settings.recording ? 'off: show private workspaces' : 'on: hide private workspaces'}`, icon: 'lock', run: () => call('settingsSet', { recording: !settings.recording }).catch(() => {}) })
  if (ws) {
    newTabActions.forEach(x => a({ ...x, label: `New tab: ${x.label}` }))
    for (const x of targets) a({ label: `Open in ${x.name}`, icon: appIcon(x.id), hint: x.id === editor ? '⌘E' : undefined, run: () => openIn(x.id) })
    a({ id: 'openPort', label: `Open localhost:${ws.port} ($PORT)`, icon: 'link', run: () => openPort(ws.port) })
    a({ label: 'Files', icon: 'file', hint: kh('panel'), run: () => showPanel('files') })
    if (git) a({ label: 'Changes', icon: 'changes', hint: '⌘D', run: () => showPanel('changes') })
    if (git) a({ id: 'review', label: 'Review: PR checks and comments', icon: 'review', run: () => showPanel('review') })
    a({ label: 'Workspace info', icon: 'info', hint: kh('info'), run: () => showInfo(true) })
    if (tab) a({ id: 'copyTab', label: "Copy the tab's contents: its whole terminal as text", icon: 'copy', run: () => copyTab(tab) })
    if (tab && bridge?.floatTab) a(floated.includes(tab.id) ? { id: 'floatTab', label: 'Bring the tab back from its own window', icon: 'popIn', run: () => floatTab(tab.id, false) } : { id: 'floatTab', label: 'Float the tab in its own window', icon: 'popOut', run: () => floatTab(tab.id) })
    a({ id: 'run', label: ws.run ? 'Run the run script' : 'Set a run script…', icon: 'run', run: ws.run ? run : editScripts })
    if (devRunning) a({ id: 'stopRun', label: 'Stop the run script', icon: 'stop', run: () => api.send('input', { tab: devTab!.id, data: '\x03' }) })
    for (const k of ws.scripts ?? []) a({ id: `script-${k}`, label: `Run the ${k} script`, icon: SCRIPT_ICONS[k], run: () => runScript(ws, k) })
    if (ws.kind === 'worktree') a({ id: 'ship', label: 'Ship: commit, push, open a PR', icon: 'ship', run: () => setDialog('ship') })
    wsActions.forEach(a)
    if (canOverlap(ws)) a({ id: 'overlaps', label: 'Check overlaps…', icon: 'gitCompare', run: () => checkOverlaps(ws) })
    if (tab && !tab.share) a({ id: 'share', label: 'Share live view…', icon: 'globe', run: () => setSharing(tab.id) })
    const layouts = layoutMenu()
    for (const p of LAYOUT_PRESETS) {
      const m = layouts.find((x): x is Extract<MenuItem, { run: () => void }> => !!x && 'label' in x && x.label === p.name && !!x.run)
      if (m) a({ id: `layout-${p.id}`, label: `Layout: ${p.name}`, icon: m.icon ?? 'layers', run: m.run })
    }
    if (previewed) a({ label: 'Close the file preview', icon: 'x', hint: kh('closeTab'), run: closePreview })
    if (tab) a({ label: `Close ${tab.name}`, icon: 'x', hint: previewed ? undefined : kh('closeTab'), run: () => closeTabs([tab]) })
    if (ws.pr) a({ id: 'openPR', label: `Open PR #${ws.pr.number}`, icon: 'pr', run: () => openExternal(ws.pr!.url) })
    for (const p of ws.ports) a({ label: `Open localhost:${p}`, icon: 'link', run: () => openExternal(`http://localhost:${p}`) })
    if (project && !project.kind) a({ id: 'projectSettings', label: `Project settings: ${project.name}`, icon: 'settings', run: () => setDialog({ settings: project.id }) })
  }
  for (const w of view?.workspaces.filter(w => w.archived) ?? []) a({ label: `Restore ${wsName(w)}`, icon: 'restore', hint: 'archived', run: () => restore(w.id) })
  // the default account for new sessions (Settings › Agents & profiles)
  for (const agent of ['claude', 'codex'] as const)
    for (const x of accountsOf(agent))
      if ((settings.accountUse?.[agent] ?? HOME_ACCOUNT) !== x.id) a({ label: `Switch ${AGENT_NAMES[agent]} to ${x.name}`, icon: 'agent', hint: 'new sessions', run: () => call('settingsSet', { accountUse: { ...settings.accountUse, [agent]: x.id } }).then(() => toast(`New ${AGENT_NAMES[agent]} sessions start on ${x.name}`, undefined, undefined, true), () => {}) })
  return items
}
