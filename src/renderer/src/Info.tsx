// A workspace's info panel (the ⓘ in the tab bar) and its PR in the status bar: CI, review, and the
// switches that send failing CI or new review comments to the agent. App.tsx maps a
// workspace to WsInfo.
import { type ReactNode } from 'react'
import { Glyph } from './Glyph'
import { type Tunnel } from './Tunnel'
import { Icon, IconButton, Switch } from './ui'

export type Check = { name: string; state: 'pass' | 'fail' | 'pending' | 'skip'; url?: string }
export type PRInfo = {
  number: number
  state: string // OPEN, MERGED, CLOSED
  url: string
  checks: '' | 'pass' | 'fail' | 'pending'
  list?: Check[]
  title?: string
  author?: string
  draft?: boolean
  review?: string // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
  conflict?: boolean // merge conflicts with its base branch
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
  fixTries?: number // failing CI sent this many times in a row for the current PR
  tunnels?: Tunnel[] // ports exposed to the world
  agents: { id: string; name: string; glyph: string; last?: string }[]
}
export type AutoKey = 'autoFix' | 'autoReview' | 'autoMerge'
export type FixWhat = 'ci' | 'review' | 'conflict' // what prFix sends
const MAX_FIXES = 3 // the daemon's: failing CI or conflicts go to the agent this many times in a row

// CI in a few characters: ✓ 5/5, ✗ 2 failing, … 3 running
export function ciText(pr: PRInfo) {
  const n = (s?: Check['state']) => pr.list?.filter(c => (s ? c.state === s : c.state !== 'skip')).length ?? 0
  const some = (s: Check['state']) => (n(s) ? `${n(s)} ` : '')
  if (pr.checks === 'fail') return `✗ ${some('fail')}failing`
  if (pr.checks === 'pending') return `… ${some('pending')}running`
  if (pr.checks === 'pass') return n() ? `✓ ${n('pass')}/${n()}` : '✓'
  return 'no checks'
}

export const prState = (pr: PRInfo) => (pr.draft && pr.state === 'OPEN' ? 'draft' : pr.state.toLowerCase())
const REVIEW: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' }

const ago = (t?: string | number) => {
  if (!t) return ''
  const s = (Date.now() - new Date(t).getTime()) / 1000
  if (!(s >= 0)) return ''
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`
}

// the auto switches, in the status bar and the panel
export function AutoToggles({ w, onToggle }: { w: WsInfo; onToggle: (k: AutoKey, v: boolean) => void }) {
  return (
    <>
      <Switch on={w.autoFix} tip={`Failing CI goes to the agent, once per commit (${MAX_FIXES} tries in a row)`} onChange={v => onToggle('autoFix', v)}>
        fix CI
      </Switch>
      <Switch on={w.autoReview} tip="New review comments on the PR go to the agent" onChange={v => onToggle('autoReview', v)}>
        review
      </Switch>
      <Switch on={w.autoMerge} tip={`Merge conflicts with the base branch go to the agent: it merges the base in and pushes (${MAX_FIXES} tries in a row)`} onChange={v => onToggle('autoMerge', v)}>
        fix conflicts
      </Switch>
    </>
  )
}

// the status bar's PR: number, CI, then the switches
export function PRStatus({ w, onOpen, onToggle }: { w: WsInfo; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void }) {
  const pr = w.pr
  if (!pr) return null
  return (
    <span className="pr-status">
      <button className={`pr pr-${pr.checks || 'none'} pr-${pr.state.toLowerCase()}`} data-tip={`${pr.title ?? ''} · ${prState(pr)}`.replace(/^ · /, '')} onClick={() => onOpen(pr.url)}>
        #{pr.number}
      </button>
      {pr.state === 'OPEN' && (
        <>
          <button className={`pr pr-${pr.checks || 'none'}`} data-tip="Checks on GitHub" onClick={() => onOpen(`${pr.url}/checks`)}>
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

// the PR: title, state, checks, the auto switches and what to send the agent (info panel, side panel)
export function PRSection({ w, onOpen, onToggle, onFix }: { w: WsInfo; onOpen: (url: string) => void; onToggle: (k: AutoKey, v: boolean) => void; onFix: (what: FixWhat) => void }) {
  const pr = w.pr
  return (
    <section>
      <h3>
        <Icon name="pr" /> Pull request
      </h3>
      {!pr ? (
        <p className="muted small">{w.kind === 'worktree' ? `None for ${w.branch} yet. Ship opens one.` : 'None.'}</p>
      ) : (
        <>
          <a className="info-title" href={pr.url} onClick={e => (e.preventDefault(), onOpen(pr.url))}>
            #{pr.number} {pr.title}
          </a>
          <div className="info-tags">
            <span className={`tag tag-${prState(pr)}`}>{prState(pr)}</span>
            {pr.review && <span className={`tag tag-${pr.review.toLowerCase()}`}>{REVIEW[pr.review] ?? pr.review.toLowerCase()}</span>}
            {pr.conflict && pr.state === 'OPEN' && <span className="tag tag-conflict">merge conflicts</span>}
            {pr.author && <span className="muted">by {pr.author}</span>}
            {!!(pr.additions || pr.deletions) && (
              <span className="mono small">
                <span className="add">+{pr.additions ?? 0}</span> <span className="del">−{pr.deletions ?? 0}</span>
              </span>
            )}
            {pr.updated && <span className="muted small">updated {ago(pr.updated)}</span>}
          </div>
          {pr.state === 'OPEN' && (
            <>
              <div className="info-checks">
                {(pr.list ?? []).map((c, i) => (
                  <a key={i} className={`info-check ck-${c.state}`} href={c.url} onClick={e => (e.preventDefault(), c.url && onOpen(c.url))}>
                    <span className="ck">{{ pass: '✓', fail: '✗', pending: '…', skip: '–' }[c.state]}</span>
                    {c.name}
                  </a>
                ))}
                {!pr.list?.length && <span className="muted small">No checks.</span>}
              </div>
              <div className="info-auto">
                <AutoToggles w={w} onToggle={onToggle} />
                {w.autoFix && (w.fixTries ?? 0) > MAX_FIXES && <span className="warn small">gave up after {MAX_FIXES} fixes; push to try again</span>}
              </div>
              <div className="row">
                <button onClick={() => onFix('ci')} disabled={pr.checks !== 'fail'}>
                  Send failing CI to the agent
                </button>
                <button onClick={() => onFix('review')}>Send review comments</button>
                <button onClick={() => onFix('conflict')} disabled={!pr.conflict}>
                  Send merge conflicts
                </button>
              </div>
            </>
          )}
          {pr.body?.trim() && <div className="info-pr-body">{pr.body.trim()}</div>}
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
  onRename: () => void
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

        <PRSection w={w} onOpen={p.onOpen} onToggle={p.onToggle} onFix={p.onFix} />

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
