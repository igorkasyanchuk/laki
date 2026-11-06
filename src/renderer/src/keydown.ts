// App's keys, in the capture phase before xterm.js sees them: App's keydown listener calls onKey with what appCtx.ts
// says it reads (only once there's a view; before it, nothing). force: an action of Settings › Keys by its id (a menu
// bar item's, a Browsers page's ⌘T/⌘W), whatever its keys; fixed: a menu bar item's fixed key (⌘O, ⌘E…), never one of
// Settings › Keys' that was given the same keys
import type { AppCtx } from './appCtx'
import { keyRec, keyLabel } from './ui'
import { keyFor, type KeyId } from '../../shared/keys'
import { pressOf } from '../../shared/widgetSchema'

export function onKey(app: AppCtx, e: KeyboardEvent, force?: KeyId, fixed?: boolean) {
  const { canLater, closePage, closePreview, closeTabs, reopenTab, dialog, doStep, editor, extOn, extRun, findIn, git, groups, hereCtx, hist, historyOn, kb, layoutMenu, moveWs, newTab, newWs, nextNeed, openIn, openMenu, openProject, openReview, pickKey, previewed, quickNew, reviewTab, selectGroup, sendLater, setDialog, setFind, setFinds, setPicking, setSideOpen, settings, showInfo, stepOf, stepsOn, tab, toggleArtifacts, toggleFull, togglePanel, toSettings, travel, ws, zoom } = app
  if (keyRec.on) return // a hotkey being recorded in Settings
  // development mode's element picker, over anything (a dialog, a page): its hotkey (Settings › General › Development)
  if (!force && settings.devMode === true && pickKey && !e.repeat && keyLabel(e) === pickKey) return void (e.preventDefault(), e.stopPropagation(), setPicking(p => !p))
  const field = (t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && !t.classList.contains('xterm-helper-textarea'))(e.target as HTMLElement | null)
  // Settings › Keys' (kb): false where one doesn't apply now, so its keys go on (⌘[ in a text field: an indent)
  const bound: Record<KeyId, false | (() => unknown)> = {
    newWs: () => newWs(ws?.project),
    newTab: () => (ws?.browser !== undefined ? quickNew('browsers') : newTab('shell')), // a browser's: another browser
    closeTab: () => (ws?.browser !== undefined ? dialog || closePage(ws) : previewed ? closePreview() : tab && closeTabs([tab])), // a Browsers page: it closes (not under a page or dialog: it isn't in sight); else the file preview first
    reopenTab: !!ws && ws.browser === undefined && (() => reopenTab()), // ponytail: a Browsers page's ⇧⌘T does nothing (Browser.tsx keeps no closed pages)
    sidebar: () => setSideOpen(o => !o),
    panel: () => ws && togglePanel(),
    info: () => showInfo(),
    palette: () => setDialog(d => (d === 'palette' ? null : 'palette')),
    files: () => ws && setDialog(d => (d === 'files' ? null : 'files')),
    find: () => dialog || findIn() || (tab && setFinds(m => ({ ...m, [tab.id]: (m[tab.id] ?? 0) + 1 }))), // not over a dialog; a diff's own (findIn) first
    // the sidebar's filter: open, its box focused; pressed again in the box: closed
    filter: () => (document.activeElement?.closest('.side-find') ? setFind(null) : (setSideOpen(true), setFind(f => f ?? { q: '' }), requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.side-find input')?.focus()))),
    next: nextNeed,
    step: stepsOn && !!ws && !dialog && (() => (st => st && doStep(ws, st))(stepOf(ws))),
    later: canLater && !dialog && (() => sendLater(tab?.kind === 'agent' ? tab.id : undefined)),
    history: (box => !!box && (() => box.dispatchEvent(new CustomEvent('laki-history'))))(document.activeElement?.closest('textarea[data-history]')), // a prompt box's search of your prompts (usePromptHistory)
    artifacts: () => dialog || toggleArtifacts(), // not under a page: out of sight
    full: () => toggleFull(), // full screen, or back
    back: historyOn && !field && (() => travel(hist.current.i - 1)),
    forward: historyOn && !field && (() => travel(hist.current.i + 1)),
    settings: () => toSettings(),
    help: () => setDialog(d => (d === 'help' ? null : 'help')),
    layout: !dialog && (() => (b => (b ? b.click() : (r => r && openMenu(r, layoutMenu(), 'right'))(document.querySelector('.ws-more')?.getBoundingClientRect())))(document.querySelector<HTMLElement>('.layout-btn'))), // a phone (no button): its menu at ⋯
  }
  const id = force ?? (fixed ? undefined : keyFor(e, kb))
  const run = id && bound[id]
  if (run) return void (e.preventDefault(), e.stopPropagation(), run())
  if (force) return
  // an extension action's key (with Alt or Ctrl: ⌘ and ⌘⇧ alone are Laki's), with the workspace and tab you're in;
  // not under a yes/no (its run's own question would replace it: a Deny, a Cancel)
  const hit = (e.altKey || e.ctrlKey) && !e.repeat && !document.querySelector('.ask-overlay') ? (p => extOn(ws).flatMap(w => (w.menus ?? []).filter(m => m.key === p).map(m => ({ w, m }))))(pressOf(e))[0] : undefined
  if (hit) return void (e.preventDefault(), e.stopPropagation(), void extRun(hit.w, hit.m, hereCtx()))
  if (!e.metaKey || e.altKey || e.ctrlKey) return
  const k = e.key.toLowerCase()
  // ⌘⇧N: the tab bar's +, its menu (shell, each agent, command) to pick from with the keys
  if (e.shiftKey && k === 'n') return void (e.preventDefault(), e.stopPropagation(), dialog || document.querySelector<HTMLElement>('.newtab-btn')?.click())
  // the fixed ones (shared/keys.ts FIXED)
  const act: Record<string, () => void> = {
    e: () => ws && openIn(editor),
    '=': () => zoom(1),
    '+': () => zoom(1),
    '-': () => zoom(-1),
    '0': () => zoom(0),
    o: openProject,
    d: () => git && togglePanel('changes'),
    arrowup: () => moveWs(-1),
    arrowdown: () => moveWs(1),
  }
  if (/^[1-9]$/.test(k)) act[k] = () => (n => (n < 0 ? openReview() : groups[n] && selectGroup(groups[n])))(Number(k) - 1 - (reviewTab ? 1 : 0)) // the review's tab first: ⌘1
  if (!act[k] || (e.shiftKey && k !== 'arrowup' && k !== 'arrowdown' && k !== '+')) return
  const t = e.target as HTMLElement | null // ⌘↑/⌘↓ in a text field move its cursor (xterm's own textarea isn't one)
  if (k.startsWith('arrow') && t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && !/^(checkbox|radio|button|submit)$/.test(t.type))) && !t.classList.contains('xterm-helper-textarea')) return
  e.preventDefault()
  e.stopPropagation()
  act[k]()
}
