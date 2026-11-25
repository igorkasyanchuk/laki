// a workspace's actions and their menus' items: a delayed start's, Detach, Move to a group, its workflows, its PR
// (info, labels, facts, the merge's verdict, Merge, Close, Draft, the PR menu), a worker's asks; computed inline in
// App's render (r: App's values this render), as they were in App
import { ago, AUTO_LABEL, AUTO_SAYS, type AutoKey, type Check, ciText, type FixWhat, type LabelApi, MERGE_WORDS, type PRAct, REVIEW, type WsInfo } from './Info'
import { ask, askText, choose, type Fact, type MenuItem, moveIds, type Verdict } from './ui'
import { creatorOf, FOLD_AFTER, type Gate, jobOf, type MergeMethod, newGroupRows, PR_QUIET, PR_SCAN, PR_TRIES, prAllows, type PRLabel, rowsOf, type Settings, type View, type WorkspaceView } from '../../shared/types'
import type { WorkflowItem } from '../../shared/workflow'
import { type Worker, workerOf } from './workers'
import { bridge, openExternal } from './api'
import { forgeName, pendingWords, prName, prNo } from './text'
import { hasCap } from '../../shared/caps'
import { parseAt } from '../../shared/when'
import { type Dialog, type RailKind, wsName } from './appCtx'
import type { Call } from '../../shared/api'
import type { Dispatch, SetStateAction } from 'react'

export type WsActionsIn = {
  call: Call
  checking: string | undefined
  copy: (text: string) => Promise<void>
  done: (text: string, undo?: () => void) => void
  flowItems: WorkflowItem[]
  flowsOn: boolean
  fold: (id: string) => void
  folded: string[]
  gated: <T>(w: WorkspaceView, step: Gate, f: (force?: boolean) => Promise<T>) => Promise<T | undefined>
  rawKind: (w: WorkspaceView) => RailKind
  setDialog: Dispatch<SetStateAction<Dialog>>
  settings: Settings
  toast: (text: string, undo?: () => void, label?: string, ok?: boolean, err?: boolean, ms?: number) => void
  view: View | null
  viewNow: () => View | null // the view as it is now (App's viewRef): after a prompt, not this render's
}

export function wsActionsOf(r: WsActionsIn) {
  const { call, checking, copy, done, flowItems, flowsOn, fold, folded, gated, rawKind, setDialog, settings, toast, view, viewNow } = r
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

  // Move to group ›, a submenu: a workspace into one of its project's groups (first in it, as a drop on its head), out
  // of its group (last before the first one), or into a new one (New group…: named, made before the first group with them)
  // Move to group: a workspace's, or several picked ones of one project (groupMoves: [] when they aren't)
  const groupMoves = (ws_: WorkspaceView[]): MenuItem[] => {
    const p = view?.projects.find(p => p.id === ws_[0]?.project)
    if (!p || ws_.some(w => w.project !== p.id)) return []
    const ids = rowsOf(p, view!.workspaces).map(x => x.id)
    const seps = p.seps ?? []
    const isSep = (x: string) => seps.some(s => s.id === x)
    const groupOf = (id: string) => ids.slice(0, ids.indexOf(id)).reverse().find(isSep)
    const inSep = ws_.length === 1 ? groupOf(ws_[0].id) : undefined
    // its rows and groups as they are once it's named (a workspace made, a group renamed meanwhile, kept); past a long
    // project's fold (Fold long projects) the project shows whole, so the new group is in sight
    const fresh = async () => {
      const name = (await askText('New group', { placeholder: 'Release, Bugs, Ideas…', ok: 'Move' }))?.trim()
      const v = viewNow()
      const q = v?.projects.find(x => x.id === p.id)
      if (!name || !v || !q) return
      const now = q.seps ?? []
      const id = `sep-${Math.random().toString(36).slice(2, 10)}`
      const rows = newGroupRows(rowsOf(q, v.workspaces).map(x => x.id), x => now.some(s => s.id === x), ws_.map(w => w.id), id)
      if ((await call('projectSet', { id: q.id, seps: [...now, { id, name }], rows }).then(() => true, () => false)) === false) return
      const cap = settings.foldAfter ?? FOLD_AFTER
      const before = rows.slice(0, rows.indexOf(id)).filter(x => v.workspaces.some(w => w.id === x && !w.archived)).length
      if (cap > 0 && before >= cap && !folded.includes(`more:${q.id}`)) fold(`more:${q.id}`)
    }
    const to = (target: string, into: boolean) => {
      call('reorder', { workspaces: moveIds(ids, ws_.map(w => w.id), { kind: 'ws', id: ws_[0].id, target, after: into, into }) }).catch(() => {})
      if (into && folded.includes(target)) fold(target) // as a drop does: it opens, to show it there
    }
    return [
      ...seps.filter(s => s.id !== inSep).map(s => ({ label: s.name || 'Unnamed group', icon: 'sep', run: () => to(s.id, true) }) as MenuItem),
      ...(ws_.some(w => groupOf(w.id)) ? [{ label: 'Out of its group', icon: 'minus', run: () => to(ids.find(isSep)!, false) } as MenuItem] : []),
      ...(seps.length ? [null] : []),
      { label: 'New group…', icon: 'plus', run: () => void fresh() },
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
    if (act === 'ci') {
      if (!(await ask(`Approve and run CI on ${prName(pr)}?`, { text: `${pr.title ?? ''}\nIt's from a fork: its code runs in your CI. GitHub runs ${pr.held === 1 ? 'its held run' : `its ${pr.held} held runs`} now.`.trim(), facts: prFacts(w), ok: 'Approve and run' }))) return
      return void call<{ approved: number }>('prAct', { ws: w.id, act, head: pr.head }).then(r => toast(`Approved ${r.approved} ${r.approved === 1 ? 'run' : 'runs'} of ${prName(pr)}`, undefined, undefined, true), () => {})
    }
    const close = act === 'close'
    if (!(await ask(close ? `Close ${prName(pr)}?` : `Approve ${prName(pr)}?`, { text: [pr.title, close && `Without merging; it can be reopened on ${forgeName(pr)}.`].filter(Boolean).join('\n'), facts: prFacts(w), ok: close ? (pr.forge === 'gitlab' ? 'Close merge request' : 'Close pull request') : 'Approve', danger: close }))) return
    call('prAct', { ws: w.id, act }).then(() => toast(close ? `Closed ${prName(pr)}` : `Approved ${prName(pr)}`, undefined, undefined, true), () => {})
  }
  // the waiting tabs of the workspaces this tab's agent started (fromTab), for its pane's foot (WorkerAsks)
  // the workspaces this tab's agent started (fromTab), each with its tabs and a failed Done check, for its pane's dock
  // (WorkersDock)
  const workerAsks = (tab: string): Worker[] =>
    (view?.workspaces.filter(w => w.fromTab === tab && !w.archived) ?? []).map(w => workerOf(w, wsName(w), view?.tabs ?? []))
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
    // the PR switches (only here: the status bar's ⋯, its right click, the workspace's ⋯ › PR #n): what goes to the agent
    // on its own, for a PR on this workspace's own branch (a linked one's agent can't push to it)
    ...(w.pr?.state === 'OPEN' && w.pr.forge !== 'gitlab' && !w.prLinked
      ? [
          null,
          ...(ks => [{ head: `Laki does on its own · ${ks.filter(k => w[k]).length} of ${ks.length} on` } as MenuItem, ...ks.map(k => ({ label: AUTO_LABEL[k], icon: k === 'autoLand' ? 'gitMerge' : 'agent', toggle: !!w[k], tip: `${AUTO_SAYS[k]}. ${w[k] ? 'On: click to turn it off' : 'Off: click to turn it on'}`, run: () => void setAuto(w, k, !w[k]) }) as MenuItem)])(['autoFix', 'autoReview', 'autoMerge', ...(allows(w, 'land') ? ['autoLand' as const] : [])] as AutoKey[]),
        ]
      : []),
    ...(w.pr?.state === 'MERGED' && allows(w, 'revert') && hasCap(view, 'pr.revert') ? [null, { label: `Revert ${K}…`, icon: 'undo', key: 'v', tip: `A new ${K} on ${F} that undoes this one, after you confirm`, run: () => prAct(w, 'revert') } as MenuItem] : []),
    ...(w.pr ? [null, { label: `Detach ${prName(w.pr)}`, icon: 'unlink', key: 'd', sub: 'Only related, kept off this workspace (Attach a PR brings it back)', run: () => detachPr(w) } as MenuItem] : []),
  ]
  return { allows, attachable, ciLog, detachPr, flowMenu, flowsHere, groupMoves, infoOf, labelApi, laterCancel, laterChange, laterNow, prAct, prFix, prMenu, refreshPR, runFlow, setAuto, shortBranch, workerAsks } as const
}
