// A workspace's info panel (the ⓘ in the tab bar) and its PR in the status bar: CI, review, and the
// switches that send failing CI or new review comments to the agent. App.tsx maps a
// workspace to WsInfo.
import { type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { jobOf, MERGE_METHODS, type MergeMethod, type PRLabel, type PRPerm } from '../../shared/types'
import { Folded } from './MarkdownView'
import { shortPath } from './text'
import { type Tunnel } from './Tunnel'
import { Icon, IconButton, type IconName, type MenuItem, Switch, useMenu } from './ui'

export type Check = { name: string; state: 'pass' | 'fail' | 'pending' | 'skip'; url?: string; took?: number } // took: seconds (an older daemon: none)
export type PRInfo = {
  number: number
  state: string // OPEN, MERGED, CLOSED
  url: string
  checks: '' | 'pass' | 'fail' | 'pending'
  list?: Check[]
  title?: string
  author?: string
  mine?: boolean // you opened it
  draft?: boolean
  review?: string // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
  approved?: string[] // who approved it (each one's latest review); an older daemon: none
  changes?: string[] // who asked for changes
  conflict?: boolean // merge conflicts with its base branch
  ready?: boolean // GitHub would merge it now; false: blocked, behind, unstable…
  base?: string
  additions?: number
  deletions?: number
  body?: string
  updated?: string
  labels?: PRLabel[] // an older daemon: none
}
export type WsInfo = {
  id: string
  name?: string
  branch: string
  base: string
  path: string
  storage?: string // $LAKI_STORAGE_FOLDER: made with its first tab
  links?: { path: string; url: string; title: string }[] // its .url files there: what its agents published
  port: number
  ports?: number[] // listening
  kind: string
  created?: number // ms
  pr?: PRInfo
  autoFix?: boolean
  autoReview?: boolean
  autoMerge?: boolean
  autoLand?: boolean // merge when green
  allow?: Record<PRPerm, boolean> // what its project lets the app do to the PR (prAllows)
  method?: MergeMethod // its project's last merge
  prLinked?: boolean // the PR a prompt named, not checked out: no auto switches
  fixTries?: number // failing CI sent this many times in a row for the current PR
  mergeTries?: number // and its merge conflicts
  prScan: number // minutes between PR checks (Settings › Pull requests)
  prTries: number // failing CI or conflicts go to the agent this many times in a row
  tunnels?: Tunnel[] // ports exposed to the world
  related?: string[] // other GitHub PRs and issues it's about (not its PR): its prompt's, a PR its own replaced
  from?: { id: string; name: string } // the workspace whose agent started it
  started?: { id: string; name: string }[] // the ones its agents started
}
export type AutoKey = 'autoFix' | 'autoReview' | 'autoMerge' | 'autoLand'
export type FixWhat = 'ci' | 'review' | 'conflict' // what prFix sends
export type PRAct = 'approve' | 'close' | 'merge' // prAct: gh as you, after a confirm
// the PR's labels: the repo's (prLabels), and one put on or taken off (prLabel)
export type LabelApi = { list: () => Promise<PRLabel[]>; set: (name: string, on: boolean) => void }
export const MERGE_WORDS: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' }
const FIXES: AutoKey[] = ['autoFix', 'autoReview', 'autoMerge']

// CI in a few characters: ✓ 5/5, ✗ 2 failing, … 3 running; bare: without the mark (CiMark draws it)
export function ciText(pr: PRInfo, bare = false) {
  const n = (s?: Check['state']) => pr.list?.filter(c => (s ? c.state === s : c.state !== 'skip')).length ?? 0
  const some = (s: Check['state']) => (n(s) ? `${n(s)} ` : '')
  const mark = (g: string, s: string) => (bare ? s : s ? `${g} ${s}` : g)
  if (pr.checks === 'fail') return mark('✗', `${some('fail')}failing`)
  if (pr.checks === 'pending') return mark('…', `${some('pending')}running`)
  if (pr.checks === 'pass') return mark('✓', n() ? `${n('pass')}/${n()}` : '')
  return 'no checks'
}
// ciText with its mark drawn, as the checks list draws it (the status bar's, the board's, a row's card)
export function CiMark({ pr }: { pr: PRInfo }) {
  if (!pr.checks) return <span className="ci-mark">{ciText(pr)}</span>
  return (
    <span className="ci-mark">
      <Icon name={CK[pr.checks].icon} size={11} />
      {ciText(pr, true) || CK[pr.checks].word /* a bare ✓ (nothing counted): words, so the mark isn't all there is */}
    </span>
  )
}

// a PR author's GitHub picture (the CSP lets avatars.githubusercontent.com in); a bot's (app/…) has none, nor a
// failed one, nor any with Settings' GitHub pictures off (App sets avatarsOn)
let avatarsOn = true
export const showAvatars = (on: boolean) => void (avatarsOn = on)
export const Avatar = ({ login, size = 14 }: { login?: string; size?: number }) =>
  avatarsOn && login && /^[\w-]+$/.test(login) ? <img className="avatar" src={`https://avatars.githubusercontent.com/${login}?s=${size * 2}`} width={size} height={size} alt="" loading="lazy" onError={e => (e.currentTarget.hidden = true)} /> : null

export const prState = (pr: PRInfo) => (pr.draft && pr.state === 'OPEN' ? 'draft' : pr.state.toLowerCase())
export const REVIEW: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' }

// who reviewed it, as a line: the status bar's tip, the hover card
export const reviewersText = (pr: PRInfo) =>
  [pr.approved?.length && `approved by ${pr.approved.join(', ')}`, pr.changes?.length && `changes requested by ${pr.changes.join(', ')}`].filter(Boolean).join(' · ')

// the PR section's: each kind of review, its people with their pictures
function Reviewers({ pr }: { pr: PRInfo }) {
  const rows: [string, string, string[] | undefined][] = [
    ['approved', 'Approved by', pr.approved],
    ['changes', 'Changes requested by', pr.changes],
  ]
  if (!rows.some(([, , who]) => who?.length)) return null
  return (
    <div className="pr-reviewers">
      {rows.map(
        ([k, word, who]) =>
          !!who?.length && (
            <div key={k} className={`pr-rv pr-rv-${k}`}>
              <Icon name={k === 'approved' ? 'check' : 'x'} />
              <span className="muted">{word}</span>
              {who.map(l => (
                <span key={l} className="pr-by">
                  <Avatar login={l} /> {l}
                </span>
              ))}
            </div>
          ),
      )}
    </div>
  )
}

export const ago = (t?: string | number) => {
  if (!t) return ''
  const s = (Date.now() - new Date(t).getTime()) / 1000
  if (!(s >= 0)) return ''
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`
}

// the auto switches, in the status bar and the panel; the panel's (under "Let the agent fix") are rows: names, and
// row's Send now after each
// (merge when green last, where the project allows it, unless keys say)
export function AutoToggles({ w, onToggle, names = ['fix CI', 'review', 'fix conflicts', 'merge when green'], row, keys = w.allow?.land ? [...FIXES, 'autoLand'] : FIXES }: { w: WsInfo; onToggle: (k: AutoKey, v: boolean) => void; names?: string[]; row?: (k: AutoKey) => ReactNode; keys?: AutoKey[] }) {
  if (w.prLinked)
    return (
      <span className="muted small" data-tip="The prompt named this PR, or it was attached: its branch isn't checked out here, so the agent couldn't push to it (laki new --pr gives the switches). A prompt's gives way to a PR of this workspace's own branch, once pushed.">
        linked, not checked out
      </span>
    )
  const when = `Checked every ${w.prScan === 1 ? 'minute' : `${w.prScan} minutes`} and after each turn; the prompt and pace: Settings › Pull requests.`
  const tips: Record<AutoKey, string> = {
    autoFix: `Failing CI on a new commit goes to the agent, with the failed logs: it fixes and pushes. Up to ${w.prTries} tries in a row, then it's over to you. ${when}`,
    autoReview: `New review comments on the PR go to the agent: it addresses them and pushes. ${when}`,
    autoMerge: `Merge conflicts with the base branch go to the agent: it merges the base in and pushes. Up to ${w.prTries} tries in a row, then it's over to you. ${when}`,
    autoLand: `Laki merges the PR (${MERGE_WORDS[w.method ?? 'squash'].toLowerCase()}, the last way used here) and deletes its branch on GitHub once every check passes, it has no conflicts, isn't a draft, is approved if the repo asks for a review and the agent isn't working. ${when}`,
  }
  return (
    <>
      {keys.map(k => {
        const i = (['autoFix', 'autoReview', 'autoMerge', 'autoLand'] as const).indexOf(k)
        const s = (
          <Switch key={k} on={w[k]} tip={tips[k]} onChange={v => onToggle(k, v)}>
            {names[i]}
          </Switch>
        )
        return row ? (
          <div key={k} className="pr-fix">
            {s}
            {row(k)}
          </div>
        ) : (
          s
        )
      })}
    </>
  )
}

// the status bar's PR: number, CI, then the switches
// onMenu: a right click (Refresh from GitHub)
export function PRStatus({ w, onOpen, onToggle, onMenu }: { w: WsInfo; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void; onMenu?: (e: MouseEvent<HTMLElement>) => void }) {
  const pr = w.pr
  if (!pr) return null
  return (
    <span className="pr-status" onContextMenu={onMenu}>
      <button className={`pr pr-${pr.checks || 'none'} pr-${pr.state.toLowerCase()}`} data-tip={[pr.title, prState(pr), reviewersText(pr)].filter(Boolean).join(' · ')} onClick={() => onOpen(pr.url)}>
        #{pr.number}
      </button>
      {pr.state === 'OPEN' && (
        <>
          <button className={`pr pr-${pr.checks || 'none'}`} data-tip="Checks on GitHub · right click to refresh" onClick={() => onOpen(`${pr.url}/checks`)}>
            <CiMark pr={pr} />
          </button>
          {pr.conflict && (
            <button className="pr pr-conflict" data-tip="Merge conflicts with its base branch: merge or rebase it" onClick={() => onOpen(pr.url)}>
              <Icon name="conflict" size={11} /> conflicts
            </button>
          )}
          <AutoToggles w={w} onToggle={onToggle} />
        </>
      )}
    </span>
  )
}

// a fact: its name, the value on one line (cut short, all of it in the tip), a copy button (and acts) on hover
function Row({ k, children, tip, copy, acts }: { k: string; children: ReactNode; tip?: string; copy?: () => void; acts?: ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-k">{k}</span>
      <span className="info-v" data-tip={tip}>
        {children}
      </span>
      {acts}
      {copy && <IconButton icon="copy" title="Copy" onClick={copy} />}
    </div>
  )
}

// a GitHub PR or issue link as a few words: PR #12 · repo
export const refLabel = (url: string) => {
  const m = /github\.com\/[\w.-]+\/([\w.-]+)\/(pull|issues)\/(\d+)/.exec(url)
  return m ? `${m[2] === 'pull' ? 'PR' : 'Issue'} #${m[3]} · ${m[1]}` : url
}

// checks, failing first, then running, passing, skipped
const CK: Record<Check['state'], { order: number; word: string; icon: IconName }> = {
  fail: { order: 0, word: 'failing', icon: 'x' },
  pending: { order: 1, word: 'running', icon: 'unread' },
  pass: { order: 2, word: 'passing', icon: 'check' },
  skip: { order: 3, word: 'skipped', icon: 'minus' },
}
const took = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`)

// onLog: a failing GitHub Actions check's Log button (other CI has no job to read)
function Checks({ pr, onOpen, onLog }: { pr: PRInfo; onOpen: (url: string) => void; onLog?: (c: Check) => void }) {
  const list = [...(pr.list ?? [])].sort((a, b) => CK[a.state].order - CK[b.state].order)
  const count = (s: Check['state']) => list.filter(c => c.state === s).length
  return (
    <div className="pr-block">
      <h4>
        Checks
        <span className="pr-sum">
          {(['fail', 'pending', 'pass', 'skip'] as const).map(s => count(s) > 0 && <span key={s} className={`ck-${s}`}>{`${count(s)} ${CK[s].word}`}</span>)}
        </span>
      </h4>
      {!list.length && <span className="muted small">No checks</span>}
      {list.map((c, i) => {
        const row = (
          <a key={i} className={`pr-check ck-${c.state}`} href={c.url} data-tip={c.url && 'Its details and log'} onClick={e => (e.preventDefault(), c.url && onOpen(c.url))}>
            <Icon name={CK[c.state].icon} />
            <span className="pr-check-name">{c.name}</span>
            {!!c.took && <span className="muted">{took(c.took)}</span>}
          </a>
        )
        return c.state === 'fail' && onLog && jobOf(c.url) ? (
          <div key={i} className="pr-check-row">
            {row}
            <button className="pr-send" data-tip="The end of its failed steps' log" onClick={() => onLog(c)}>
              <Icon name="fileText" /> Log
            </button>
          </div>
        ) : (
          row
        )
      })}
    </div>
  )
}

const FIX: Partial<Record<AutoKey, FixWhat>> = { autoFix: 'ci', autoReview: 'review', autoMerge: 'conflict' }
const SEND: Record<FixWhat, [string, string]> = {
  ci: ['Send failing CI', 'the failing checks and their logs, to the agent'],
  review: ['Send review comments', 'the open ones, to the agent'],
  conflict: ['Send conflicts', 'the agent merges the base branch in and pushes'],
}

// the PR: title, state, actions, its description, checks, and what the agent fixes (info panel, side panel)
// threads: its open review threads (the side panel's), unknown in the info panel: Send review comments shows then
export function PRSection({ w, threads, onOpen, onToggle, onFix, onLog, onAct, onAttach, onDetach, onLabel }: { w: WsInfo; threads?: number; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void; onFix: (what: FixWhat) => void; onLog?: (c: Check) => void; onAct: (act: PRAct, method?: MergeMethod) => void; onAttach?: () => void; onDetach?: () => void; onLabel?: LabelApi }) {
  const pr = w.pr
  const open = pr?.state === 'OPEN'
  const can = (k: PRPerm) => w.allow?.[k] ?? k !== 'land'
  const [menu, openMenu] = useMenu()
  const method = w.method ?? 'squash'
  const merge = open && can('merge') && !pr?.draft
  const approve = open && can('approve') && !pr?.mine // GitHub takes no approval of your own
  // why Merge isn't green (it still merges, after the confirm: GitHub may refuse)
  const blocked = !pr
    ? ''
    : pr.conflict
      ? 'merge conflicts'
      : pr.checks === 'fail'
        ? 'checks failing'
        : pr.checks === 'pending'
          ? 'checks running'
          : pr.review === 'CHANGES_REQUESTED'
            ? 'changes requested'
            : pr.ready === false
              ? 'GitHub would not merge it yet'
              : ''
  const more: MenuItem[] = !pr
    ? []
    : [
        { label: 'Open its checks', icon: 'link', run: () => onOpen(`${pr.url}/checks`) },
        { label: 'Open its files', icon: 'diff', run: () => onOpen(`${pr.url}/files`) },
        ...(w.prLinked && onDetach ? [{ label: 'Not this workspace’s PR', icon: 'link', sub: 'Only related: its own PR, once opened, shows here', run: onDetach } as MenuItem] : []),
        ...(open && can('close') ? [null, { label: 'Close pull request…', icon: 'x', danger: true, run: () => onAct('close') } as MenuItem] : []),
      ]
  // Labels: the repo's, the PR's ticked; a click puts one on or takes it off (the menu opens once they're in)
  const labelMenu = async (e: MouseEvent<HTMLButtonElement>) => {
    const at = e.currentTarget.getBoundingClientRect()
    const all = await onLabel!.list().catch(() => null) // App's call says why
    if (!all || !pr) return
    const has = new Set(pr.labels?.map(l => l.name))
    const repo = pr.url.replace(/\/pull\/\d+.*$/, '/labels')
    openMenu(at, [
      ...(all.length > 8 ? [{ filter: 'Find a label' }] : []),
      ...all.map(l => ({ label: l.name, sub: l.description, icon: 'tag', hint: has.has(l.name) ? 'ON' : undefined, run: () => onLabel!.set(l.name, !has.has(l.name)) }) as MenuItem),
      { label: all.length ? 'Edit labels on GitHub' : 'No labels yet: make some on GitHub', icon: 'github', foot: true, run: () => onOpen(repo) },
    ])
  }
  // Send now: what there is to send, by hand (a linked PR, with no switches: each named)
  const send = (what: FixWhat, named = false) => {
    if (!pr || !(what === 'ci' ? pr.checks === 'fail' : what === 'review' ? (threads ?? 1) > 0 : pr.conflict)) return null
    const [label, tip] = SEND[what]
    return (
      <button key={what} className="pr-send" aria-label={label} data-tip={`${label}: ${tip}`} onClick={() => onFix(what)}>
        <Icon name="agent" /> {named ? label : 'Send now'}
      </button>
    )
  }
  return (
    <section className="pr-sec">
      <h3>
        <Icon name="pr" /> Pull request
      </h3>
      {!pr ? (
        <>
          <p className="muted small">{w.kind === 'worktree' ? `None for ${w.branch} yet. Ship opens one.` : 'None.'}</p>
          {onAttach && (
            <button className="small" onClick={onAttach} data-tip="One opened another way, or on another branch: by its URL or number">
              <Icon name="link" /> Attach a PR…
            </button>
          )}
        </>
      ) : (
        <>
          <a className="pr-title" href={pr.url} onClick={e => (e.preventDefault(), onOpen(pr.url))}>
            {pr.title} <span className="pr-num">#{pr.number}</span>
          </a>
          <div className="pr-meta">
            <span className={`tag tag-${prState(pr)}`}>{prState(pr)}</span>
            {pr.review && <span className={`tag tag-${pr.review.toLowerCase()}`}>{REVIEW[pr.review] ?? pr.review.toLowerCase()}</span>}
            {pr.conflict && open && <span className="tag tag-conflict">merge conflicts</span>}
            {pr.author && (
              <span className="pr-by">
                by <Avatar login={pr.author} /> {pr.mine ? 'you' : pr.author}
              </span>
            )}
            {!!(pr.additions || pr.deletions) && (
              <span className="mono">
                <span className="add">+{pr.additions ?? 0}</span> <span className="del">−{pr.deletions ?? 0}</span>
              </span>
            )}
            {pr.updated && <span>updated {ago(pr.updated)}</span>}
          </div>
          <Reviewers pr={pr} />
          {(!!pr.labels?.length || onLabel) && (
            <div className="pr-labels">
              {pr.labels?.map(l => (
                <span key={l.name} className="pr-label" style={l.color ? ({ '--lc': `#${l.color}` } as CSSProperties) : undefined}>
                  {l.name}
                </span>
              ))}
              {onLabel && (
                <button className="pr-label-add" aria-label="Labels" data-tip="Put a label on it or take one off (gh pr edit)" onClick={labelMenu}>
                  <Icon name="tag" />
                  {!pr.labels?.length && 'Label'}
                </button>
              )}
            </div>
          )}
          {/* GitHub's order: Merge first (green once it could go in), Approve beside it, the PR on GitHub at the end and
              closing, rare and lasting, in ⋯; each asks first (App's prAct) */}
          <div className="pr-acts">
            {merge && (
              <span className={`split ${blocked ? '' : 'green'}`}>
                <button className="merge" onClick={() => onAct('merge', method)} data-tip={`${MERGE_WORDS[method]}, after a confirm${blocked ? ` · ${blocked}` : ''}`}>
                  <Icon name="pr" /> Merge
                </button>
                <button
                  className="merge caret"
                  aria-label="Another way to merge"
                  data-tip="Another way to merge"
                  onClick={e => openMenu(e, MERGE_METHODS.map(m => ({ label: `${MERGE_WORDS[m]}…`, icon: m === method ? 'check' : undefined, run: () => onAct('merge', m) })))}
                >
                  <Icon name="chevron" />
                </button>
              </span>
            )}
            {approve && (
              <button className="approve" onClick={() => onAct('approve')} data-tip="An approving review, as you (gh pr review --approve), after a confirm">
                <Icon name="check" /> Approve
              </button>
            )}
            {(merge || approve) && <span className="spacer" />}
            <button className={merge || approve ? 'square' : ''} aria-label="Open on GitHub" data-tip={`Open on GitHub · ${pr.url}`} onClick={() => onOpen(pr.url)}>
              <Icon name="github" />
              {!(merge || approve) && 'Open on GitHub'}
            </button>
            <button className="square" aria-label="More" data-tip="More" onClick={e => openMenu(e, more, 'right')}>
              <Icon name="more" />
            </button>
          </div>
          {pr.body?.trim() && <Folded key={pr.url} text={pr.body.trim()} lines={6} />}
          {open && <Checks pr={pr} onOpen={onOpen} onLog={onLog} />}
          {open && (
            <div className="pr-block">
              <h4>Let the agent fix</h4>
              <AutoToggles w={w} onToggle={onToggle} names={['failing CI', 'review comments', 'conflicts']} row={k => send(FIX[k]!)} keys={FIXES} />
              {w.prLinked && <div className="pr-sends">{(['ci', 'review', 'conflict'] as const).map(what => send(what, true))}</div>}
              {w.autoFix && (w.fixTries ?? 0) > w.prTries && <span className="warn small">Gave up after {w.prTries} fixes; turn failing CI off and on to try again.</span>}
              {w.autoMerge && (w.mergeTries ?? 0) > w.prTries && <span className="warn small">Gave up on the conflicts after {w.prTries} tries; turn conflicts off and on to try again.</span>}
            </div>
          )}
          {open && can('land') && !w.prLinked && (
            <div className="pr-block">
              <h4>When it's green</h4>
              <AutoToggles w={w} onToggle={onToggle} names={['', '', '', MERGE_WORDS[method]]} keys={['autoLand']} />
            </div>
          )}
          {menu}
        </>
      )}
    </section>
  )
}

// the right panel's Info tab (⌘I): the workspace's facts and its PR
export function InfoTab(p: {
  w: WsInfo
  onOpen: (url: string) => void
  onToggle: (k: AutoKey, v: boolean) => void
  onFix: (what: FixWhat) => void
  onLog?: (c: Check) => void // a failing check's log
  onAct: (act: PRAct, method?: MergeMethod) => void
  onRename: () => void
  onAttach?: () => void // a git workspace on a branch, with no PR: Attach a PR…
  onCopy: (text: string) => void
  onStorage?: () => void // its storage folder in Finder (the app's only)
  onWs?: (id: string) => void // another workspace (from, started)
  onPrimary?: (url: string) => void // a related PR as its PR
  onUnrelate?: (url: string) => void // off the related list
  onDetach?: () => void // its PR, only linked, to related
  onLabel?: LabelApi // its PR's labels
}) {
  const { w } = p
  return (
      <div className="sp-body info-body">
        <div className="info-name">
          <b>{w.name || w.id}</b>
          <IconButton icon="pencil" title="Rename" onClick={p.onRename} />
        </div>
        <section className="info-facts">
          {w.name && (
            <Row k="id" copy={() => p.onCopy(w.id)}>
              <span className="mono">{w.id}</span>
            </Row>
          )}
          {w.kind === 'worktree' ? (
            <Row k="branch" tip={`${w.branch}, from ${w.base}`} copy={() => p.onCopy(w.branch!)}>
              <span className="mono">{w.branch}</span> <span className="muted">← {w.base}</span>
            </Row>
          ) : (
            <Row k="where">{w.branch ? <>the repo itself, on <span className="mono">{w.branch}</span></> : 'the folder itself'}</Row>
          )}
          <Row k="path" tip={w.path} copy={() => p.onCopy(w.path)}>
            <span className="mono">{shortPath(w.path)}</span>
          </Row>
          {w.storage && (
            <Row k="storage" tip={`${w.storage}: what its agents keep for you ($LAKI_STORAGE_FOLDER)`} copy={() => p.onCopy(w.storage!)}>
              {p.onStorage ? (
                <a href="#" className="mono" onClick={e => (e.preventDefault(), p.onStorage!())}>
                  {w.storage.split('/').pop()}
                </a>
              ) : (
                <span className="mono">{shortPath(w.storage)}</span>
              )}
            </Row>
          )}
          {w.links?.map((l, i) => ( // what its agents published (the storage folder's .url files), newest first
            <Row key={l.path} k={i ? '' : 'links'} tip={l.url} copy={() => p.onCopy(l.url)}>
              <a href={l.url} onClick={e => (e.preventDefault(), p.onOpen(l.url))}>
                {l.title}
              </a>
            </Row>
          ))}
          <Row k="$PORT" tip={`http://localhost:${w.port}`} copy={() => p.onCopy(String(w.port))}>
            <a href="#" className="mono" onClick={e => (e.preventDefault(), p.onOpen(`http://localhost:${w.port}`))}>
              localhost:{w.port}
            </a>
          </Row>
          {w.tunnels?.map(t => (
            <Row key={t.port} k={t.mails?.length ? 'shared' : 'public'} tip={`:${t.port} · ${t.mails?.length ? `only ${t.mails.join(', ')}` : 'anyone with the link'}`} copy={t.url ? () => p.onCopy(t.url!) : undefined}>
              {t.url ? (
                <a href={t.url} onClick={e => (e.preventDefault(), p.onOpen(t.url!))}>
                  {t.url.replace(/^https:\/\//, '')}
                </a>
              ) : (
                <span className="muted">:{t.port} · starting…</span>
              )}
            </Row>
          ))}
          {w.created ? <Row k="created" tip={new Date(w.created).toLocaleString()}>{ago(w.created)}</Row> : null}
          {w.from && (
            <Row k="from" tip={`Its agent started this one: ${w.from.name}`}>
              <a href="#" onClick={e => (e.preventDefault(), p.onWs?.(w.from!.id))}>
                {w.from.name}
              </a>
            </Row>
          )}
          {w.started?.map((s, i) => (
            <Row key={s.id} k={i ? '' : 'started'} tip={`Its agent started ${s.name}`}>
              <a href="#" onClick={e => (e.preventDefault(), p.onWs?.(s.id))}>
                {s.name}
              </a>
            </Row>
          ))}
          {w.related?.filter(u => u.toLowerCase() !== w.pr?.url.toLowerCase()).map((u, i) => ( // other PRs and issues it's about; its PR is the section below
            <Row
              key={u}
              k={i ? '' : 'related'}
              tip={u}
              copy={() => p.onCopy(u)}
              acts={
                <>
                  {p.onPrimary && u.includes('/pull/') && <IconButton icon="pr" title="Make it this workspace's PR" onClick={() => p.onPrimary!(u)} />}
                  {p.onUnrelate && <IconButton icon="x" title="Not related" onClick={() => p.onUnrelate!(u)} />}
                </>
              }
            >
              <a href={u} onClick={e => (e.preventDefault(), p.onOpen(u))}>
                {refLabel(u)}
              </a>
            </Row>
          ))}
        </section>

        <PRSection w={w} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} onLog={p.onLog} onAct={p.onAct} onAttach={p.onAttach} onDetach={p.onDetach} onLabel={p.onLabel} />
      </div>
  )
}
