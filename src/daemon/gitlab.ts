// GitLab merge requests through glab (build prompt 1): a project whose origin is on GitLab gets its MR, its pipeline as
// checks, Ship, issues and the MR actions the way a GitHub one gets gh's, in the same PR / Check / issue shapes (the
// renderer reads one shape: pr.forge 'gitlab' makes its words MR and !n). forgeOf: gitlab.com, or a host glab is
// signed in to (glab auth status --hostname); anything else stays gh's, as before. glab runs where gh would (exec: an
// SSH host's there), in the folder, so it takes the repo and its host from the remote, never a guess. ponytail: review
// threads, line comments, the PR switches, the Review tab's GitHub side and blame are GitHub's only (githubOnly)
import type { Check, PR, Project, Workspace } from '../shared/types.ts'
import { exec, git, type At } from './core.ts'

type Forge = 'gitlab' | 'github'
// by project, and a self-hosted host's (glab signed in to it), each kept KEEP: a glab signed in later, a remote changed or
// git failing once is seen again in a while, not only after a restart
const KEEP = 5 * 60000
const forges = new Map<string, { at: number; f: Promise<Forge> }>()
const hosts = new Map<string, { at: number; f: Promise<Forge> }>()
const kept = (m: Map<string, { at: number; f: Promise<Forge> }>, k: string, make: () => Promise<Forge>) => {
  const had = m.get(k)
  if (had && Date.now() - had.at < KEEP) return had.f
  const f = make()
  m.set(k, { at: Date.now(), f })
  return f
}
// a remote's host: a URL's (https://, ssh://) or scp-like git@host:path's; a path on disk has none
export const hostOf = (url: string) => (/^[a-z][\w+.-]*:\/\/(?:[^@/\s]+@)?([^/:\s]+)/i.exec(url.trim()) ?? /^[^@/\s]+@([^/:\s]+):/.exec(url.trim()))?.[1]?.toLowerCase()
export function forgeOf(at: (Workspace | Project) & At): Promise<Forge> {
  return kept(forges, 'project' in at ? at.project : at.id, () =>
    git(at, 'remote', 'get-url', 'origin').then(
      url => {
        const host = hostOf(url)
        if (!host || host === 'github.com') return 'github' as const
        if (host === 'gitlab.com') return 'gitlab' as const
        return kept(hosts, host, () => exec(at, 'glab', ['auth', 'status', '--hostname', host], { timeout: 10000 }).then(() => 'gitlab' as const, () => 'github' as const))
      },
      () => 'github' as const,
    ),
  )
}
export const isLab = (pr?: PR) => pr?.forge === 'gitlab'
export function githubOnly(pr: PR | undefined, what: string) {
  if (isLab(pr)) throw new Error(`GitHub only: ${what} isn't there for GitLab merge requests yet`)
}

// glab's failure as a line you can act on, as core's ghSays
export function glabSays(e: any, what: string) {
  const err = String(e?.stderr || e?.message || e)
  if (e?.code === 'ENOENT' || /glab: (command )?not found|command not found: glab/.test(err)) return "glab isn't installed: brew install glab, then glab auth login"
  if (/glab auth login|not logged in|401 Unauthorized|no token/i.test(err)) return "glab isn't signed in: run glab auth login"
  return `glab, ${what}: ${err.trim().split('\n')[0]}`
}
const glab = (at: At, args: string[], timeout = 30000) => exec(at, 'glab', args, { timeout }).then(r => String(r.stdout))

// a pipeline job's status as a check's: success passes; failed fails; running, pending, created (and the waits) are
// pending; skipped and manual are skipped; canceled is cancelled (never a pass: Merge when green needs one)
const JOB: Record<string, Check['state']> = { success: 'pass', failed: 'fail', running: 'pending', pending: 'pending', created: 'pending', preparing: 'pending', waiting_for_resource: 'pending', scheduled: 'pending', skipped: 'skip', manual: 'skip', canceled: 'cancelled' }
export const jobsOf = (jobs: any[]): Check[] => (Array.isArray(jobs) ? jobs : []).map(j => ({ name: String(j?.name ?? '?'), state: JOB[String(j?.status)] ?? 'pending', ...(typeof j?.web_url === 'string' && { url: j.web_url }), ...(typeof j?.duration === 'number' && { took: Math.round(j.duration) }) }))
const STATE: Record<string, string> = { opened: 'OPEN', merged: 'MERGED', closed: 'CLOSED', locked: 'CLOSED' }

// the workspace's MR (by its branch, or the linked one's !n) as a PR; checks from its head pipeline's jobs (100: GitLab's
// page is 20, and a failing job past it would read as passing). ponytail: a pipeline over 100 jobs reads its first 100
export async function glabPR(ws: Workspace, checksOf: (l: Check[]) => PR['checks']): Promise<PR> {
  const ref = ws.prUrl ? (/\/merge_requests\/(\d+)/.exec(ws.prUrl)?.[1] ?? ws.branch) : ws.branch
  const j = JSON.parse(await glab(ws, ['mr', 'view', ref, '--output', 'json'], 20000))
  const pipe = j.head_pipeline ?? j.pipeline
  const list = pipe?.id ? jobsOf(JSON.parse(await glab(ws, ['api', `projects/:id/pipelines/${Number(pipe.id)}/jobs?per_page=100`], 20000).catch(() => '[]'))) : []
  const ms = String(j.detailed_merge_status ?? '')
  return {
    number: j.iid,
    state: STATE[j.state] ?? String(j.state ?? '').toUpperCase(),
    url: j.web_url,
    checks: checksOf(list),
    list,
    title: j.title,
    author: j.author?.username,
    ...((j.draft || j.work_in_progress) && { draft: true }),
    head: j.sha,
    conflict: typeof j.has_conflicts === 'boolean' ? j.has_conflicts : undefined,
    ready: ms ? ms === 'mergeable' : undefined,
    base: j.target_branch,
    body: typeof j.description === 'string' ? j.description.slice(0, 4000) : undefined,
    updated: j.updated_at,
    forge: 'gitlab',
  }
}
export const noMR = (said: string) => /no (open )?merge requests? (available|found)|merge request not found|404 Not Found/i.test(said)

// the MR actions: approve, close, merge (squash or rebase as picked; the source branch removed unless kept), draft or ready
export function glabAct(ws: Workspace, pr: PR, act: 'approve' | 'close' | 'merge', how?: string, removeBranch = true) {
  const iid = String(pr.number)
  const args = act === 'approve' ? ['mr', 'approve', iid] : act === 'close' ? ['mr', 'close', iid] : ['mr', 'merge', iid, '--yes', ...(how === 'squash' ? ['--squash'] : how === 'rebase' ? ['--rebase'] : []), ...(removeBranch ? ['--remove-source-branch'] : []), ...(/^[0-9a-f]{7,64}$/.test(pr.head ?? '') ? ['--sha', pr.head!] : [])] // --sha: only the commit the scan saw
  return glab(ws, args, 60000).catch(e => Promise.reject(new Error(glabSays(e, `MR !${iid}`))))
}
// a merged MR undone: its merge (or squash) commit reverted onto a new branch off the target (the commits API: GitLab
// makes the revert commit), then an MR from it; a revert GitLab can't make (it conflicts), or an MR that didn't open,
// takes the branch off again
export async function glabRevert(ws: Workspace, pr: PR, title: string) {
  const says = (e: unknown) => Promise.reject(new Error(glabSays(e, `MR !${pr.number}`)))
  const j = JSON.parse(await glab(ws, ['mr', 'view', String(pr.number), '--output', 'json'], 20000).catch(says))
  const sha = String(j.merge_commit_sha || j.squash_commit_sha || '')
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error(`MR !${pr.number} has no merge commit to revert (a fast-forward merge of several commits: revert them by hand)`)
  const branch = `revert-${sha.slice(0, 8)}`
  await glab(ws, ['api', '-X', 'POST', 'projects/:id/repository/branches', '-f', `branch=${branch}`, '-f', `ref=${j.target_branch}`]).catch(says)
  const undo = async (e: unknown) => (await glab(ws, ['api', '-X', 'DELETE', `projects/:id/repository/branches/${branch}`]).catch(() => {}), says(e)) // a retry starts clean
  await glab(ws, ['api', '-X', 'POST', `projects/:id/repository/commits/${sha}/revert`, '-f', `branch=${branch}`], 60000).catch(undo)
  const out = await glab(ws, ['mr', 'create', '--source-branch', branch, '--target-branch', String(j.target_branch), '--title', title, '--description', `Reverts !${pr.number}`, '--yes'], 60000).catch(undo)
  const url = /https?:\/\/\S+\/merge_requests\/(\d+)/.exec(out)
  if (!url) throw new Error(`MR !${pr.number}: glab opened no merge request for ${branch}`)
  return { number: Number(url[1]), url: url[0], title }
}
export const glabDraft = (ws: Workspace, pr: PR, draft: boolean) => glab(ws, ['mr', 'update', String(pr.number), draft ? '--draft' : '--ready']).catch(e => Promise.reject(new Error(glabSays(e, `MR !${pr.number}`))))

// fromIssue's: a GitLab issue by its number
export async function glabIssue(at: At, n: string) {
  if (!/^\d+$|^https:\/\//.test(n)) throw new Error(`which GitLab issue? its number, not ${n}`) // never a flag to glab
  const i = JSON.parse(await glab(at, ['issue', 'view', n, '--output', 'json'], 20000).catch(e => Promise.reject(new Error(glabSays(e, `issue #${n}`)))))
  return { number: Number(i.iid), title: String(i.title ?? ''), body: typeof i.description === 'string' ? i.description : '', url: String(i.web_url ?? '') }
}
// the # list's: open issues, with who is assigned (no MRs that close them: GitHub's only)
export async function glabIssues(at: At) {
  const list = JSON.parse((await glab(at, ['issue', 'list', '--output', 'json'], 30000).catch(e => Promise.reject(new Error(glabSays(e, 'the repo'))))) || '[]')
  return (Array.isArray(list) ? list : []).map((x: any) => ({ number: Number(x.iid), title: String(x.title ?? ''), url: String(x.web_url ?? ''), assignees: (Array.isArray(x.assignees) ? x.assignees : []).map((a: any) => String(a?.username ?? '')), prs: [] as { number: number; url: string; state: 'open' | 'draft' | 'merged' | 'closed' }[] }))
}
// Ship's last line: the branch's MR, else a new one filled from its commits
// into the workspace's base (or the Ship sheet's); its title and description, draft and reviewers when the sheet gave them
export const shipMr = (o: { title?: boolean; draft?: boolean; reviewers?: boolean } = {}) =>
  `glab mr view "$LAKI_BRANCH" >/dev/null 2>&1 || glab mr create ${o.title ? '--title "$LAKI_TITLE" --description "$LAKI_BODY"' : '--fill'} --yes --source-branch "$LAKI_BRANCH" --target-branch "$LAKI_BASE"${o.draft ? ' --draft' : ''}${o.reviewers ? ' --reviewer "$LAKI_REVIEWERS"' : ''}`
