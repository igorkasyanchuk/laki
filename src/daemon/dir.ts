// the daemon's data folder (~/.laki, LAKI_HOME): a module of its own, out of core.ts' import cycle, so the modules in
// it (accounts, notes, plans…) can read it as they load whichever of them is imported first. Each imports it from here.
import { createHash } from 'node:crypto'
import { realpathSync, rmSync } from 'node:fs'
import { join, sep } from 'node:path'
import { dataDir } from '../shared/conn.ts'

export const dir = dataDir()

// a path with its links resolved (the folder as it is on disk); one not there yet, as it is
export const realOf = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
// the test rig's daemon: its LAKI_TEST_PARENT and a data folder under /tmp (the rig's /tmp/laki-…), on plain node (the
// rig's; the app's daemon runs on Electron's, which never is one). Never an env var alone: one could reach a real ~/.laki
// (nor TMPDIR: an env var too). What only tests may do asks it: the RPC's `now` (main.ts' TEST_CLOCK) and LAKI_POLICY
// (policy.ts). After the folder is made: realpath needs it there
export const inRig = () => {
  const tmp = realOf('/tmp')
  const d = realOf(dir)
  return !!process.env.LAKI_TEST_PARENT && !process.versions.electron && d !== tmp && d.startsWith(tmp + sep)
}

// S6: what the data folder may hold that a sandboxed claude's Read tool never reads, there yet or not (hookFiles); globs:
// state.json's dated backups and copies set aside, writeAtomic's temp files (<file>.<pid>-<hex>.tmp). Its Bash and the
// wrapper sandbox (wrapCmd) hide the whole folder instead
export const DATA_SECRETS = ['daemon.json', 'daemon.lock', 'mcp', 'net-proxy.json', 'pty.json', 'pty.secret', 'pty.sock', 'state.json', 'state.json.bak', 'state.json.*', 'state.json.tmp', '*.tmp', 'tap-key', 'ai-key', 'ai-endpoint-key', 'accounts', 'hooks', 'prompts.json', 'ai-chat.json', 'ai-chats', 'ai-agent-*.json', 'ai-calls.jsonl', 'inbox.json', 'notes', 'todo-list.json', 'secrets', 'env-keys', 'turns', 'widget-data', 'widget-secrets.json', 'clients', 'clients.json', 'client-log', 'vapid.json', 'e2e-salts.json', 'remote-log.jsonl', 'remote-log.1.jsonl', 'agent-log', 'review-notes', 'review-walks', 'background', 'daemon.log', 'flow-trust']
// laki backup's (dataBackup.ts): what of the data folder is yours to carry to another Mac; the rest (DATA_SECRETS'
// keys, tokens and sign-ins, logs, temp files, the trash) stays out. review-notes: the Review tab's unsent comments (in
// DATA_SECRETS only so an agent's Read can't see them). Not turns: their refs are in each repo, an index without them
// would offer rewinds that fail
export const BACKUP_KEEP = ['state.json', 'notes', 'todo-list.json', 'plans', 'workflows', 'widgets', 'ai-chats', 'ai-chat.json', 'prompts.json', 'flow-trust', 'review-notes']
// R13: a workspace's Walk throughs (ai.ts reviewSteps), out of its agents' reach (the storage folder is theirs to write)
export const walkFile = (ws: string) => (/^[\w.-]+$/.test(ws) ? join(dir, 'review-walks', `${ws}.json`) : undefined)
// a project workflow's text as you allowed it (workflow.ts' trust), beside its hash in state.flowTrust: the trust
// sheet's diff against what's there now (flowTrustDiff). By its key's hash; 0600
export const flowTrustFile = (key: string) => join(dir, 'flow-trust', `${createHash('sha256').update(key).digest('hex')}.md`)
export const flowTrustDrop = (keys: string[], trusts: Record<string, string> | undefined) => {
  for (const k of keys) {
    if (trusts) delete trusts[k]
    rmSync(flowTrustFile(k), { force: true })
  }
}
