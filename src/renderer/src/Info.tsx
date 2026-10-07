// A workspace's info panel (the ⓘ in the tab bar) and its PR in the status bar: CI, review, and the
// switches that send failing CI or new review comments to the agent. App.tsx maps a
// workspace to WsInfo.
import { type MouseEvent, type ReactNode } from 'react'
import { MERGE_METHODS, type MergeMethod, type PRPerm } from '../../shared/types'
import { Glyph } from './Glyph'
import { Folded } from './MarkdownView'
import { type Tunnel } from './Tunnel'
import { Icon, IconButton, type IconName, Switch, useMenu } from './ui'

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
  conflict?: boolean // merge conflicts with its base branch
  base?: string
  additions?: number
  deletions?: number
  body?: string
  updated?: string
}
export type WsInfo = {
  id: string
  name?: string
  branch: string
  base: string
  path: string
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
  agents: { id: string; name: string; glyph: string; last?: string }[]
}
export type AutoKey = 'autoFix' | 'autoReview' | 'autoMerge' | 'autoLand'
export type FixWhat = 'ci' | 'review' | 'conflict' // what prFix sends
export type PRAct = 'approve' | 'close' | 'merge' // prAct: gh as you, after a confirm
export const MERGE_WORDS: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' }
const FIXES: AutoKey[] = ['autoFix', 'autoReview', 'autoMerge']

// CI in a few characters: ✓ 5/5, ✗ 2 failing, … 3 running
export function ciText(pr: PRInfo) {
  const n = (s?: Check['state']) => pr.list?.filter(c => (s ? c.state === s : c.state !== 'skip')).length ?? 0
  const some = (s: Check['state']) => (n(s) ? `${n(s)} ` : '')
  if (pr.checks === 'fail') return `✗ ${some('fail')}failing`
  if (pr.checks === 'pending') return `… ${some('pending')}running`
  if (pr.checks === 'pass') return n() ? `✓ ${n('pass')}/${n()}` : '✓'
  return 'no checks'
}

// a PR author's GitHub picture (the CSP lets avatars.githubusercontent.com in); a bot's (app/…) has none, nor a
// failed one
export const Avatar = ({ login, size = 14 }: { login?: string; size?: number }) =>
  login && /^[\w-]+$/.test(login) ? <img className="avatar" src={`https://avatars.githubusercontent.com/${login}?s=${size * 2}`} width={size} height={size} alt="" loading="lazy" onError={e => (e.currentTarget.hidden = true)} /> : null

export const prState = (pr: PRInfo) => (pr.draft && pr.state === 'OPEN' ? 'draft' : pr.state.toLowerCase())
export const REVIEW: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' }

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
      <span className="muted small" data-tip="The prompt named this PR; its branch isn't checked out here, so the agent couldn't push to it. A workspace from the PR (Pull request on the new-workspace page, laki new --pr) has the switches.">
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
      <button className={`pr pr-${pr.checks || 'none'} pr-${pr.state.toLowerCase()}`} data-tip={`${pr.title ?? ''} · ${prState(pr)}`.replace(/^ · /, '')} onClick={() => onOpen(pr.url)}>
        #{pr.number}
      </button>
      {pr.state === 'OPEN' && (
        <>
          <button className={`pr pr-${pr.checks || 'none'}`} data-tip="Checks on GitHub · right click to refresh" onClick={() => onOpen(`${pr.url}/checks`)}>
            {ciText(pr)}
          </button>
          {pr.conflict && (
            <button className="pr pr-conflict" data-tip="Merge conflicts with its base branch: merge or rebase it" onClick={() => onOpen(pr.url)}>
              ⚠ conflicts
            </button>
          )}
          <AutoToggles w={w} onToggle={onToggle} />
        </>
      )}
    </span>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-k">{k}</span>
      <span className="info-v">{children}</span>
    </div>
  )
}

// checks, failing first, then running, passing, skipped
const CK: Record<Check['state'], { order: number; word: string; icon: IconName }> = {
  fail: { order: 0, word: 'failing', icon: 'x' },
  pending: { order: 1, word: 'running', icon: 'unread' },
  pass: { order: 2, word: 'passing', icon: 'check' },
  skip: { order: 3, word: 'skipped', icon: 'minus' },
}
const took = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`)

function Checks({ pr, onOpen }: { pr: PRInfo; onOpen: (url: string) => void }) {
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
      {list.map((c, i) => (
        <a key={i} className={`pr-check ck-${c.state}`} href={c.url} data-tip={c.url && 'Its details and log'} onClick={e => (e.preventDefault(), c.url && onOpen(c.url))}>
          <Icon name={CK[c.state].icon} />
          <span className="pr-check-name">{c.name}</span>
          {!!c.took && <span className="muted">{took(c.took)}</span>}
        </a>
      ))}
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
export function PRSection({ w, threads, onOpen, onToggle, onFix, onAct, onAttach }: { w: WsInfo; threads?: number; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void; onFix: (what: FixWhat) => void; onAct: (act: PRAct, method?: MergeMethod) => void; onAttach?: () => void }) {
  const pr = w.pr
  const open = pr?.state === 'OPEN'
  const can = (k: PRPerm) => w.allow?.[k] ?? k !== 'land'
  const [menu, openMenu] = useMenu()
  const method = w.method ?? 'squash'
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
                by {!pr.mine && <Avatar login={pr.author} />} {pr.mine ? 'you' : pr.author}
              </span>
            )}
            {!!(pr.additions || pr.deletions) && (
              <span className="mono">
                <span className="add">+{pr.additions ?? 0}</span> <span className="del">−{pr.deletions ?? 0}</span>
              </span>
            )}
            {pr.updated && <span>updated {ago(pr.updated)}</span>}
          </div>
          <div className="pr-acts">
            {open && can('merge') && !pr.draft && (
              <span className="split">
                <button className="merge" onClick={() => onAct('merge', method)} data-tip={`${MERGE_WORDS[method]} (gh pr merge), after a confirm; ▾ for another way`}>
                  <Icon name="pr" /> Merge…
                </button>
                <button
                  className="merge more"
                  aria-label="Another way to merge"
                  onClick={e => openMenu(e, MERGE_METHODS.map(m => ({ label: `${MERGE_WORDS[m]}…`, icon: m === method ? 'check' : undefined, run: () => onAct('merge', m) })))}
                >
                  ▾
                </button>
              </span>
            )}
            {open && can('approve') && !pr.mine /* GitHub takes no approval of your own */ && (
              <button className="approve" onClick={() => onAct('approve')} data-tip="An approving review, as you (gh pr review --approve)">
                <Icon name="check" /> Approve…
              </button>
            )}
            <button onClick={() => onOpen(pr.url)} data-tip={pr.url}>
              <Icon name="github" /> <span className="pr-wide">Open on </span>GitHub
            </button>
            {open && can('close') && (
              <button className="close-pr" onClick={() => onAct('close')} data-tip="Closes it without merging (gh pr close); it can be reopened on GitHub">
                <Icon name="x" /> Close…
              </button>
            )}
          </div>
          {pr.body?.trim() && <Folded key={pr.url} text={pr.body.trim()} lines={6} />}
          {open && <Checks pr={pr} onOpen={onOpen} />}
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

export function InfoPanel(p: {
  w: WsInfo
  onClose: () => void
  onOpen: (url: string) => void
  onToggle: (k: AutoKey, v: boolean) => void
  onFix: (what: FixWhat) => void
  onAct: (act: PRAct, method?: MergeMethod) => void
  onRename: () => void
  onAttach?: () => void // a git workspace on a branch, with no PR: Attach a PR…
  onAgent: (tab: string) => void
  onCopy: (text: string) => void
}) {
  const { w } = p
  return (
    <div className="info">
      <div className="diff-head">
        <b>{w.name || w.id}</b>
        <IconButton icon="pencil" title="Rename" onClick={p.onRename} />
        <span className="spacer" />
        <button className="icon small" onClick={p.onClose} title="Close (⌘I)">
          ×
        </button>
      </div>
      <div className="info-body">
        <section>
          {w.name && <Row k="id">{w.id}</Row>}
          {w.kind === 'worktree' ? (
            <Row k="branch">
              {w.branch} <span className="muted">← {w.base}</span>
            </Row>
          ) : (
            <Row k="where">{w.branch ? `the repo itself, on ${w.branch}` : 'the folder itself'}</Row>
          )}
          <Row k="path">
            <span className="mono small">{w.path}</span>
          </Row>
          <Row k="$PORT">{w.port}</Row>
          {w.tunnels?.map(t => (
            <Row key={t.port} k="public">
              {t.url ? (
                <span className="info-link">
                  <a href={t.url} onClick={e => (e.preventDefault(), p.onOpen(t.url!))}>
                    {t.url.replace(/^https:\/\//, '')}
                  </a>
                  <IconButton icon="copy" title="Copy the link" onClick={() => p.onCopy(t.url!)} />
                  <span className="muted small">
                    :{t.port} · {t.mails?.length ? `only ${t.mails.join(', ')}` : 'anyone with the link'}
                  </span>
                </span>
              ) : (
                <span className="muted">:{t.port} · starting…</span>
              )}
            </Row>
          ))}
          {w.created ? <Row k="created">{ago(w.created)}</Row> : null}
        </section>

        <PRSection w={w} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} onAct={p.onAct} onAttach={p.onAttach} />

        <section>
          <h3>
            <Icon name="agent" /> Agents
          </h3>
          {!w.agents.length && <p className="muted small">No agent tabs.</p>}
          {w.agents.map(a => (
            <div key={a.id} className="info-agent" onClick={() => p.onAgent(a.id)}>
              <div className="info-agent-head">
                <Glyph s={a.glyph} /> {a.name}
              </div>
              {a.last ? <div className="info-last">{a.last}</div> : <div className="muted small">Nothing said yet.</div>}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
