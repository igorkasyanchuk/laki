// The ⋯ and right-click menus of a workspace, a tab, a file and a project: App builds them each render (menusOf)
// from what appCtx.ts says it reads.
import { type AppBase, colorOf, WEB, wsName } from './appCtx'
import { type TabView, type WorkspaceView, againOnEnter, HOME_ACCOUNT, type Project } from '../../shared/types'
import { ask, type MenuItem, ON, iconItems, TAB_COLORS, askText, type IconName } from './ui'
import { pendingWords, shortPath } from './text'
import { isIconName } from '../../shared/icons'
import { tabsOf, move } from '../../shared/layout'
import { modeItems, readable } from './Reader'
import { wsLink } from './links'
import { api, bridge } from './api'
import type { Collision } from '../../shared/overlap'
import { ROW_MARKS, rowMarkUsed, rowMarkSet } from './settingsBase'
export function menusOf(app: AppBase) {
  const { accountsOf, apps, archive, attachable, byId, call, closeTabs, copy, copyTab, done, extItems, fail, floated, floatTab, flowMenu, fold, folded, forkWs, groupMoves, groups, inReader, isTerm, kh, laterCancel, laterChange, laterNow, mark, markUnread, newIn, newWord, openIn, openInItems, prMenu, projOf, rail, rawKind, readerOn, refreshPR, restore, rmItem, runMenu, selectTab, setDialog, setGroups, setOverlapsAt, setRead, setSharing, settings, setWsId, showInfo, showPanel, sortItems, split, stepItem, tabByWs, termIn, termsOk, termWhere, toast, view } = app
  // a workspace's first agent tab; ● again on a tab, as if its turn ended unseen (until it's looked at again)
  const agentTab = (id: string) => view?.tabs.find(t => t.workspace === id && t.kind === 'agent')

  // Restart on another account: the same chat there (a turn at work stops: asked first)
  const restartOn = async (t: TabView, account: string, name: string) => {
    if (t.status === 'running' && !(await ask(`Restart ${t.name} on ${name}?`, { text: 'Its turn at work stops; the chat resumes there.', ok: 'Restart' }))) return
    call('tabAccount', { tab: t.id, account }).then(() => toast(`${t.name}: on ${name} now`, undefined, undefined, true), () => {})
  }

  // right click in Files: a file in its default app, a browser (for what they show), or any app (Finder reveals it,
  // a terminal opens its folder)
  const fileMenu = (w: WorkspaceView, file: string, dir: boolean): MenuItem[] => [
    { head: 'Open in' },
    ...(dir ? [] : [{ label: 'Default app', icon: 'file', key: 'o', run: () => openIn('default', { ws: w.id, file }) } as MenuItem]),
    ...(!dir && WEB.test(file) ? apps.filter(a => a.browser).map(a => ({ label: a.name, icon: 'globe', run: () => openIn(a.id, { ws: w.id, file }) }) as MenuItem) : []),
    ...openInItems({ ws: w.id, file }),
    null,
    { label: 'Copy path', icon: 'copy', key: 'c', run: () => copy(`${w.path}/${file}`) },
    ...(dir ? [] : extItems('file', w, { ws: w.id, file }, file)),
  ]

  const laterItems = (w: WorkspaceView): MenuItem[] => (w.pending ? [{ head: pendingWords(w.pending, true) }, { label: 'Start now', icon: 'run', tip: 'Starts its agent now instead of at the time set', run: () => laterNow(w) }, { label: 'Change time…', icon: 'clock', run: () => void laterChange(w) }, { label: 'Cancel delayed start', icon: 'x', danger: true, tip: 'Its agent never starts; the workspace stays', run: () => void laterCancel(w) }, null] : [])
  // Rename with AI: the workspace's agent (the tab you're on there, else its first live one) asked, when its turn ends,
  // to name it from its PR's title and description, else its task, through laki rename
  const liveAgent = (w: WorkspaceView) => (ts => ts.find(t => t.id === tabByWs[w.id]) ?? ts[0])((view?.tabs ?? []).filter(t => t.workspace === w.id && t.kind === 'agent' && t.status !== 'exited'))
  const aiRename = (w: WorkspaceView, t: TabView) =>
    void call<{ sent?: boolean }>('send', { target: t.id, whenIdle: true, text: `Rename this workspace after its task, in 2 to 5 words a person would say: from its pull request's title and description if it has one${w.pr ? ` (#${w.pr.number})` : ' (gh pr view)'}, else from what you're working on here. Run \`laki rename . "<the name>"\`, say the new name in one line, and change nothing else.` })
      .then(r => done(r?.sent ? `Asked ${t.name} to name it` : `${t.name} names it when its turn ends`), fail)

  // Workspace ›: its own settings and copies, a submenu, so the menu's top level is what you do with it
  const wsOwn = (w: WorkspaceView): MenuItem[] => [
    { label: 'Rename…', icon: 'pencil', key: 'r', tip: 'Its name in Laki; the branch and folder stay', run: () => setDialog({ renameWs: w.id }) },
    ...((t => (t ? [{ label: 'Rename with AI', icon: 'agent', sub: `${t.name} names it from its PR, else its task`, run: () => aiRename(w, t) } as MenuItem] : []))(liveAgent(w))),
    { label: 'Info', icon: 'info', key: 'i', tip: 'Its path, branch, port, PR and links, in the side panel', run: () => (setWsId(w.id), showInfo(true)) },
    ...(w.branch && !isTerm(w) ? [{ label: 'Copy branch name', icon: 'copy', key: 'b', tip: w.branch, run: () => copy(w.branch) } as MenuItem] : []),
    ...(w.browser === undefined ? [{ label: 'Copy path', icon: 'copy', key: 'c', hint: (w.host ? `${w.host}:` : '') + shortPath(w.path), tip: (w.host ? `${w.host}:` : '') + w.path, run: () => copy((w.host ? `${w.host}:` : '') + w.path) } as MenuItem] : []),
    ...(canOverlap(w) ? [{ label: 'Check overlaps…', icon: 'gitCompare', key: 'o', tip: "Where its changes meet another worktree's of the project, or what its base gained since it branched", run: () => checkOverlaps(w) } as MenuItem] : []),
    null,
    { label: w.muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell', key: 'm', tip: w.muted ? 'Its agents notify you again' : 'No notifications or Dock count from its agents', run: () => call('wsSet', { id: w.id, muted: !w.muted }) },
    { label: 'Important: cards on screen', icon: 'alertCircle', key: 'n', hint: w.important ? ON : undefined, tip: w.important ? 'On: a click turns it off (macOS notifications again)' : "Its agents' asks and finishes as cards at the bottom right, over every app, until you answer or close them", run: () => call('wsSet', { id: w.id, important: !w.important }) },
    { label: 'Remind me…', icon: 'timer', key: 'e', tip: 'A notification about it later; a click opens it', run: () => setDialog({ remind: w.id }) },
    { label: 'Private', icon: 'lock', hint: w.private ? ON : undefined, tip: w.private ? 'Recording mode shows it again' : "Recording mode (⌘K, the menu bar) hides it: from the sidebar, the Board, bubbles, counts, notifications and phone pushes; it keeps running", run: () => call('wsSet', { id: w.id, private: !w.private }) },
    ...(agentTab(w.id) ? [{ label: 'Mark as unread', icon: 'unread', key: 'u', tip: 'Its ● again, so it stays in Needs you until you look', run: () => markUnread(agentTab(w.id)!.id) } as MenuItem] : []),
    { label: w.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', key: 'p', tip: w.pinned ? 'Back under its project' : 'In the sidebar\'s Pinned, above every project', run: () => call('wsSet', { id: w.id, pinned: !w.pinned }) },
    ...(rail ? [{ label: w.railPin ? 'Unpin from the rail' : 'Pin to the rail', icon: 'pin', key: 'k', tip: 'A button on the left rail that opens it from anywhere', run: () => call('wsSet', { id: w.id, railPin: !w.railPin }).catch(fail) } as MenuItem] : []), // full (pinned specs count too): says so
    ...(rail && w.railPin ? [{ label: 'Rail icon', icon: isIconName(w.icon) ? w.icon : 'star', items: iconItems(w.icon, i => void call('wsSet', { id: w.id, icon: i ?? '' }).catch(fail)) } as MenuItem] : []), // its pin's, a terminal's too
    ...(settings.devMode ? [{ label: 'Logs', icon: 'file', key: 'l', tip: 'What Laki did for it: PR scans, deliveries, setup runs', run: () => setDialog({ logs: `ws:${w.id}`, title: `Logs · ${wsName(w)}` }) } as MenuItem] : []),
    null,
    ...showItems(),
  ]
  const wsMenu = (w: WorkspaceView): MenuItem[] => [
    ...stepItem(w),
    ...laterItems(w),
    { colors: TAB_COLORS, value: w.color, pick: c => call('wsSet', { id: w.id, color: c }) },
    { label: 'Workspace', icon: 'settings', key: 's', items: wsOwn(w) }, // no tip: it would cover the submenu; W is Run workflow's
    { label: 'Open in', icon: 'code', key: 'o', tip: 'Its folder in an editor, a terminal or Finder', items: openInItems({ ws: w.id }) },
    ...(w.race ? [{ label: 'Compare the race', icon: 'race', key: 'c', tip: 'The agents that raced on this task side by side, to keep one', run: () => setDialog({ compare: w.race! }) } as MenuItem] : []),
    ...prSub(w),
    ...(w.pinned ? [] : groupItems(w)),
    ...runItems(w),
    ...flowMenu(w),
    null,
    ...(w.kind === 'worktree'
      ? [
          { label: 'Fork workspace', icon: 'fork', key: 'f', tip: 'A new worktree off its branch\'s last commit, its agent\'s chat forked too', run: () => forkWs(w) } as MenuItem,
          { label: 'Archive workspace', icon: 'archive', key: 'a', tip: 'Removes its worktree, keeps the branch; restore it from the project\'s menu', run: () => archive(w) } as MenuItem,
        ]
      : []),
    rmItem(w),
    ...extItems('workspace', w, { ws: w.id }),
  ]

  // PR #n › (or Pull request ›): the status bar PR's menu, a submenu; no PR: look for one, attach one
  const prSub = (w: WorkspaceView): MenuItem[] =>
    (items => (items.length ? [{ label: w.pr ? `PR #${w.pr.number}` : 'Pull request', icon: 'pr', key: 'h', items }] : []))(
      w.pr
        ? prMenu(w)
        : [
            ...(w.kind === 'worktree' ? [{ label: 'Look for a PR', icon: 'refresh', tip: 'Asks GitHub now for a PR on its branch', run: refreshPR } as MenuItem] : []),
            ...(attachable(w) ? [{ label: 'Attach a PR…', icon: 'link', tip: 'Makes a PR by its link or number this workspace\'s', run: () => setDialog({ attachPr: w.id }) } as MenuItem] : []),
          ],
    )

  const groupItems = (w: WorkspaceView): MenuItem[] => (items => (items.length ? [{ label: 'Move to group', icon: 'sep', key: 'g', items }] : []))(groupMoves([w]))

  // Run ›: the toolbar's Run ▾ for this workspace (its script, localhost, the agent and terminal actions), a submenu;
  // a terminal or a browser has none
  const runItems = (w: WorkspaceView): MenuItem[] => (rawKind(w) === 'projects' ? [{ label: 'Run', icon: 'run', key: 'n', items: runMenu(w) }] : [])

  const tabMenu = (ids: string[]): MenuItem[] => {
    const ts = ids.map(byId).filter((t): t is TabView => !!t)
    const g = groups.find(g => tabsOf(g).includes(ids[0]))
    const ended = ts.filter(t => t.status === 'exited' && againOnEnter(t))
    const others = groups.filter(x => x !== g).flatMap(x => tabsOf(x).map(byId)).filter((t): t is TabView => !!t)
    return [
      { label: 'Rename…', icon: 'pencil', key: 'r', tip: 'The tab\'s name', run: () => setDialog({ rename: ts[0].id }) },
      { colors: TAB_COLORS, value: colorOf(ts[0]), pick: c => ts.forEach(t => call('tabSet', { id: t.id, color: c })) },
      { label: ts[0].muted ? 'Unmute notifications' : 'Mute notifications', icon: 'bell', key: 'm', tip: ts[0].muted ? 'It notifies you again' : 'No notifications or Dock count from this tab', run: () => ts.forEach(t => call('tabSet', { id: t.id, muted: !ts[0].muted })) },
      { label: 'Mark as unread', icon: 'unread', key: 'u', tip: 'Its ● again, so it stays in Needs you until you look', run: () => ts.forEach(t => markUnread(t.id)) },
      ...(readerOn && ts.length === 1 && readable(ts[0]) ? [(r => ({ label: r ? 'Show the terminal' : 'Show as a chat (Reader)', icon: r ? 'terminal' : 'file', tip: r ? 'Its terminal, as the agent draws it' : 'Its chat as a conversation: your messages, its answers, its steps folded', run: () => setRead(ts[0].id, r ? 'term' : 'reader') }) as MenuItem)(inReader(ts[0].id))] : []),
      ...(bridge?.floatTab && ts.length === 1 ? [floated.includes(ts[0].id) ? ({ label: 'Back from its own window', icon: 'popIn', run: () => floatTab(ts[0].id, false) } as MenuItem) : ({ label: 'Float in its own window', icon: 'popOut', sub: 'Over every app, so you can watch it from anywhere', run: () => floatTab(ts[0].id) } as MenuItem)] : []),
      ...(ts.length === 1 && ts[0].mode ? [{ label: 'Permission mode', icon: 'lock', items: modeItems(ts[0], m => call('tabMode', { tab: ts[0].id, mode: m }).catch(() => {})) } as MenuItem] : []),
      ...(ts[0].kind === 'agent' && ts[0].status !== 'exited' ? [{ label: 'Send a message later…', icon: 'timer', tip: 'Types a message into it at a time you pick, or once its turn ends', run: () => setDialog({ sendLater: ts[0].workspace, to: ts[0].id }) } as MenuItem] : []),
      ...(ts.length === 1 ? [{ label: 'Copy contents', icon: 'copy', sub: 'Its whole terminal as text, the scrollback too', run: () => copyTab(ts[0]) } as MenuItem] : []),
      ...(bridge ? [{ label: 'Copy link', icon: 'link', key: 'l', tip: 'A laki:// link that opens this tab', run: () => copy(wsLink(ts[0].workspace, ts[0].id)) } as MenuItem] : []),
      ts[0].share
        ? {
            label: 'Shared live view',
            icon: 'globe',
            items: [
              { label: 'Link and QR code…', icon: 'globe', run: () => setSharing(ts[0].id) },
              { label: 'Copy share link', icon: 'link', run: () => copy(ts[0].share!.url) },
              { label: 'Stop sharing', icon: 'x', danger: true, run: () => void call('shareStop', { tab: ts[0].id }).then(() => done(`${ts[0].name} isn't shared any more: its link is dead`)) },
            ],
          }
        : { label: 'Share live view…', icon: 'globe', sub: 'A view-only page of it, live, at a link', run: () => setSharing(ts[0].id) },
      null,
      { label: 'Split right', icon: 'splitRight', tip: 'A new pane beside it, in the same tab', run: () => (selectTab(ts[0].id), split('right', ts[0].id)) },
      { label: 'Split down', icon: 'splitDown', tip: 'A new pane under it, in the same tab', run: () => (selectTab(ts[0].id), split('bottom', ts[0].id)) },
      ...(g && tabsOf(g).length > 1
        ? ids.length > 1
          ? [{ label: 'Separate panes', icon: 'unsplit', tip: 'Each pane back in a tab of its own', run: () => setGroups(groups.flatMap(x => (x === g ? tabsOf(x).map(tab => ({ tab })) : [x]))) } as MenuItem]
          : [{ label: 'Move to its own tab', icon: 'unsplit', tip: 'Out of this split, into a tab of its own', run: () => setGroups(move(groups, ids[0], false, 'bar')) } as MenuItem]
        : []),
      ...((t => {
        const other = t?.kind === 'agent' && (t.preset === 'claude' ? 'codex' : t.preset === 'codex' ? 'claude' : undefined)
        return other && view?.presets.some(p => p.agent === other && !p.off)
          ? [{ label: `Continue in ${other === 'codex' ? 'Codex' : 'Claude Code'}`, icon: 'agent', tip: `A ${other === 'codex' ? 'Codex' : 'Claude Code'} tab beside it that reads this chat and the changes so far, then carries on: for a usage limit or a stuck agent. This one stays`, run: () => void call<{ tab: string; name: string }>('tabHandover', { tab: t!.id, to: other }).then(r => (selectTab({ id: r.tab, workspace: t!.workspace }), done(`${r.name} takes over from ${t!.name}`)), () => {}) } as MenuItem]
          : []
      })(ts.length === 1 ? ts[0] : undefined)),
      ...(ts.length === 1 && ts[0].kind === 'agent' ? [{ label: 'Side chat', icon: 'messages', tip: 'Ask about what it does in the side panel while it works: its own chat stays as it is', run: () => (selectTab(ts[0].id), showPanel('side')) } as MenuItem] : []),
      ...(ended.length ? [{ label: 'Restart', icon: 'restore', tip: 'Starts it again (an agent resumes its chat)', run: () => ended.forEach(t => api.send('input', { tab: t.id, data: '\r' })) } as MenuItem] : []),
      ...(ts.length === 1 && accountsOf(ts[0].preset).length > 1 && !view?.workspaces.find(w => w.id === ts[0].workspace)?.host
        ? [{ label: 'Restart on another account', icon: 'restore', tip: 'The same chat, resumed on another sign-in (Settings › Agents & profiles)', items: accountsOf(ts[0].preset).map(a => ({ label: a.name, hint: (ts[0].account ?? HOME_ACCOUNT) === a.id ? ON : undefined, run: () => (ts[0].account ?? HOME_ACCOUNT) !== a.id && restartOn(ts[0], a.id, a.name) }) as MenuItem) } as MenuItem]
        : []),
      null,
      { label: ids.length > 1 ? 'Close tab' : 'Close', icon: 'x', hint: kh('closeTab'), tip: 'Ends what runs in it', run: () => closeTabs(ts) },
      ...(ids.length > 1 || !g || tabsOf(g).length === 1 ? (others.length ? [{ label: 'Close other tabs', icon: 'x', danger: true, tip: 'Every tab of this workspace but this one', run: () => closeTabs(others) } as MenuItem] : []) : []),
      ...(ts.length === 1 ? extItems('tab', view?.workspaces.find(x => x.id === ts[0].workspace), { ws: ts[0].workspace, tab: ts[0].id }) : []),
    ]
  }

  const tasksOf = (project: string) => (n => (n ? `${n} ${n === 1 ? 'task' : 'tasks'}` : undefined))(view?.schedules?.filter(s => s.project === project && !s.archived).length ?? 0)

  // a project's name in Laki, any you like; empty: its folder's again (the daemon's projectSet)
  const renameProject = async (p: Project) => {
    const name = await askText(`Rename ${p.name}`, { text: `Its folder ${shortPath(p.path)} stays as it is. Empty: the folder's name.`, value: p.name, placeholder: p.path.split('/').filter(Boolean).pop(), ok: 'Rename' })
    if (name === null || name.trim() === p.name) return
    call('projectSet', { id: p.id, name: name.trim() }).then(() => done(name.trim() ? `Renamed to ${name.trim()}` : "Named after its folder again"), () => {})
  }
  const projectActions = (p: Project): MenuItem[] => {
    const archived = view?.workspaces.filter(w => w.archived && w.project === p.id) ?? []
    return [
      { colors: TAB_COLORS, value: p.color, pick: c => call('projectSet', { id: p.id, color: c }) },
      { label: newWord(p), icon: 'plus', hint: p.kind ? undefined : kh('newWs'), run: () => newIn(p) },
      ...(!p.kind && termsOk ? [{ label: 'New terminal', icon: 'terminal', key: 't', hint: termWhere(p), tip: 'A shell in the project\'s own folder, listed with its workspaces', run: () => termIn(p) } as MenuItem] : []),
      ...(p.kind ? [] : [{ label: 'Open project page', icon: 'info', key: 'o', tip: 'Its notes, scheduled tasks, memory and settings', run: () => setDialog({ project: p.id }) } as MenuItem]),
      { label: 'Open in', icon: 'code', key: 'i', items: openInItems({ project: p.id }) },
      { label: 'Add a group', icon: 'sep', tip: 'A named head in its list: drop workspaces under it', run: () => setDialog({ sep: p.id }) },
      ...(p.kind || p.git === false || p.host ? [] : [{ label: 'Import worktrees…', icon: 'fork', tip: 'Worktrees of this repo made outside Laki, as workspaces', run: () => setDialog({ importWt: p.id }) } as MenuItem]),
      ...(p.kind || p.host ? [] : [{ label: 'Import chats…', icon: 'agent', tip: 'Claude Code and Codex chats in this project that no tab has open (a plain terminal\'s, a closed tab\'s), as tabs that pick them up', run: () => setDialog({ importChats: p.id }) } as MenuItem]),
      { label: folded.includes(p.id) ? 'Expand' : 'Collapse', icon: folded.includes(p.id) ? 'chevron' : 'chevronRight', run: () => fold(p.id) },
      { label: 'Notes', icon: 'file', key: 'n', hint: p.notes?.trim() ? undefined : 'none yet', tip: 'Your Markdown notes for this project; agents don\'t see them', run: () => setDialog({ notes: p.id }) },
      { label: 'Private', icon: 'lock', hint: p.private ? ON : undefined, tip: p.private ? 'Recording mode shows it again' : 'Recording mode (⌘K, the menu bar) hides it and all its workspaces; they keep running', run: () => call('projectSet', { id: p.id, private: !p.private }) },
      ...(p.kind ? [] : [{ label: 'Rename…', icon: 'pencil', key: 'r', tip: 'Its name in Laki; empty: its folder\'s. The folder stays as it is', run: () => renameProject(p) } as MenuItem]),
      ...iconItems(p.icon, icon => call('projectSet', { id: p.id, icon: icon ?? '' })),
      ...(p.kind ? [] : sortItems(p.sort ?? 'manual', sort => call('projectSet', { id: p.id, sort: sort ?? 'manual' }))),
      ...(p.kind ? [] : showItems()),
      null,
      ...(p.kind ? [] : [{ label: 'Settings', icon: 'settings', key: 's', run: () => setDialog({ project: p.id, tab: 'settings' }) } as MenuItem]), // its page's Settings tab; Terminals and Browsers have none
      { label: 'Scheduled tasks…', icon: 'clock', hint: tasksOf(p.id), tip: 'Prompts that run in it on a schedule', run: () => setDialog({ schedules: p.id }) },
      ...(p.kind ? [] : [{ label: 'Archive project…', icon: 'archive', key: 'a', tip: 'Out of the sidebar, pickers and ⌘K, its history kept; Settings › Archived projects brings it back', run: () => void ask(`Archive project ${p.name}?`, { text: "It leaves the sidebar, the pickers and ⌘K. Its agents sleep and resume their chats when it's back; terminals close; worktrees and history stay. Settings › Archived projects brings it back.", ok: 'Archive' }).then(y => void (y && call('projectArchive', { project: p.id }).then(() => done(`Archived project ${p.name}`, () => void call('projectArchive', { project: p.id, on: false })), () => {}))) } as MenuItem]),
      ...(p.sample ? [{ label: 'Remove sample…', icon: 'trash', danger: true, tip: "The sample project and its folder in Laki's data (U4)", run: () => void ask(`Remove the sample ${p.name}?`, { text: 'Its workspaces go first; then the project and its folder, made by Laki for trying it.', ok: 'Remove sample', danger: true }).then(y => y && call('sampleRm').catch(() => {})) } as MenuItem] : []),
      { label: 'Remove project', icon: 'trash', key: 'd', danger: true, tip: 'Takes it out of Laki; its files stay', run: () => void ask(`Remove project ${p.name}?`, { text: 'Its workspaces leave Laki; its files stay.', ok: 'Remove', danger: true }).then(y => void (y && call('projectRm', { id: p.id }).then(() => done(`Removed project ${p.name}`), () => {}))) },
      ...(archived.length ? [null, { head: 'Archived' }, ...archived.map(w => ({ label: wsName(w), icon: 'restore' as IconName, hint: 'restore', run: () => restore(w.id) }))] : []),
    ]
  }

  // Check overlaps (a worktree's Workspace ›, its row's mark): the daemon's overlapCheck now, in a dialog (the radar's own
  // scan, every 15 s, only with Settings' Collision radar on)
  const checkOverlaps = (w: WorkspaceView) => {
    setOverlapsAt({ w: w.id })
    api.call<Collision[]>('overlapCheck', { ws: w.id }).then(
      list => setOverlapsAt(o => (o?.w === w.id ? { w: w.id, list } : o)),
      e => setOverlapsAt(o => (o?.w === w.id ? { w: w.id, err: (e as Error).message } : o)),
    )
  }
  const canOverlap = (w: WorkspaceView) => w.kind === 'worktree' && !w.host && !w.archived && projOf(w)?.git !== false

  const showItems = (): MenuItem[] => [{ label: 'Show', icon: 'eye', tip: 'What the sidebar rows show after their names', items: [...ROW_MARKS.filter(([m]) => rowMarkUsed(settings, m)).map(([m, label, tip]) => ({ label, tip, hint: mark(m) ? ON : undefined, run: () => void call('settingsSet', rowMarkSet(settings, m, !mark(m))).catch(() => {}) })), null, { label: 'Empty projects', tip: 'Projects with no workspace to show (none, all archived, or all pinned); off: only ones with rows', hint: settings.hideEmpty === true ? undefined : ON, run: () => void call('settingsSet', { hideEmpty: settings.hideEmpty !== true }).catch(() => {}) }] }]
  // D7: a phone at answer only (its view's remote.level): only what that level may do (main.ts' ANSWER), so nothing
  // fails on a click: a workspace's name, color, pins and reminders, Info, copies, a new agent. ponytail: by label
  const answerOnly = view?.remote?.level === 'answer'
  const ANSWER_ITEMS = /^(Rename…|Info|Copy .+|Remind me…|Pin to top|Unpin|Pin to the rail|Unpin from the rail|Mark as unread|Workspace|New (?!terminal).+)$/
  const only = (items: MenuItem[], colors = false): MenuItem[] => {
    if (!answerOnly) return items
    const kept = items.flatMap((i): MenuItem[] => (i === null || 'head' in i ? [i] : 'colors' in i ? (colors ? [i] : []) : !('label' in i) ? [] : i.items ? (sub => (sub.length ? [{ ...i, items: sub }] : []))(only(i.items)) : ANSWER_ITEMS.test(i.label) ? [i] : []))
    // a head or a line with nothing of its own left under it goes too
    return kept.filter((i, n) => (i === null ? n > 0 && kept[n - 1] !== null && n < kept.length - 1 : 'head' in i ? !!kept[n + 1] && !('head' in kept[n + 1]!) : true))
  }
  return { wsMenu: (w: WorkspaceView) => only(wsMenu(w), true), tabMenu: (ids: string[]) => only(tabMenu(ids)), fileMenu: (w: WorkspaceView, file: string, dir: boolean) => only(fileMenu(w, file, dir)), projectActions: (p: Project) => only(projectActions(p)), showItems: () => only(showItems()), canOverlap, checkOverlaps }
}
