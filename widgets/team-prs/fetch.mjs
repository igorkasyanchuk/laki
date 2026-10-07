// Team PRs' fetch, run by Laki's node: the repo's open PRs by the team's members, each with its labels, CI and review,
// and the count over the last runs (for the chart). config: repo (owner/name or a link), logins (GitHub logins), only
// and hide (labels)
import { execFile } from 'node:child_process'

const gh = (...args) => new Promise((ok, no) => execFile('gh', args, { maxBuffer: 32 << 20 }, (e, out, err) => (e ? no(new Error(String(err).trim().split('\n').pop() || e.message)) : ok(out))))
const BAD = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const OK = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

function ci(rollup = []) {
  const states = rollup.map(c => c.conclusion || c.state || '')
  if (!states.length) return 'none'
  if (states.some(s => BAD.has(s))) return 'failing'
  return states.every(s => OK.has(s)) ? 'passing' : 'pending'
}

// owner/name from what was typed: a link to the repo (or a page of it) works too; a GitHub Enterprise host stays
const repoOf = r => {
  const parts = r.trim().replace(/^https?:\/\//, '').replace(/^(www\.)?github\.com\//, '').replace(/\.git$/, '').split('/').filter(Boolean)
  return parts.slice(0, parts[0]?.includes('.') ? 3 : 2).join('/')
}
const low = list => new Set(list.map(x => x.replace(/^@/, '').toLowerCase()))

export default async function ({ config, last }) {
  const repo = repoOf(config.repo)
  if (!repo) throw new Error('Set Repo (owner/name) in Settings › Widgets')
  const want = low(config.logins)
  if (!want.size) throw new Error('Set GitHub logins in Settings › Widgets')
  const only = low(config.only)
  const hide = low(config.hide)
  // each login's open PRs, all at once: the repo's whole list with its checks is too much for GitHub's API in a busy
  // repo (a 504), and its search takes one author at a time
  const FIELDS = 'number,title,url,author,createdAt,isDraft,labels,reviewDecision,mergeable,statusCheckRollup'
  const lists = await Promise.all([...want].map(a => gh('pr', 'list', '--repo', repo, '--state', 'open', '--author', a, '--limit', '100', '--json', FIELDS)))
  const prs = lists
    .flatMap(o => JSON.parse(o))
    .filter(p => {
      const ls = p.labels.map(l => l.name.toLowerCase())
      return (!only.size || ls.some(l => only.has(l))) && !ls.some(l => hide.has(l))
    })
    .map(p => ({
      number: p.number,
      title: p.title,
      url: p.url,
      author: p.author.login,
      createdAt: p.createdAt,
      draft: p.isDraft,
      labels: p.labels.map(l => ({ name: l.name, color: l.color })),
      ci: ci(p.statusCheckRollup),
      review: p.reviewDecision === 'APPROVED' ? 'approved' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : 'waiting',
      conflict: p.mergeable === 'CONFLICTING',
    }))
    .sort((a, b) => b.number - a.number) // the newest first
  const history = [...(last?.history ?? []), { at: Date.now(), count: prs.length }].slice(-48)
  return { prs, team: [...want], history }
}
