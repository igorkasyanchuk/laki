// GitHub Codespaces through gh on this Mac (cloud workspaces, hosts.ts' section of that name): make, wait, start, stop,
// delete, list, the machine types. Each one's ssh Host entry (gh codespace ssh --config, under Laki's own name for it)
// is a file in <data>/ssh/codespaces, which <data>/ssh/config includes before your own ~/.ssh/config: Laki's ssh calls
// take -F with it once it's there (sshF), so plain hosts read as they did
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { dataDir } from '../shared/conn.ts'

const run = promisify(execFile)
const sshDir = join(dataDir(), 'ssh')
const CONFIG = join(sshDir, 'config')
const entries = join(sshDir, 'codespaces')
// where a codespace has the repo: /workspaces/<repo>. LAKI_CS_ROOT: tests' folder (fakes/ssh: every host is this Mac)
export const CS_ROOT = process.env.LAKI_CS_ROOT || '/workspaces'
export const sshF = () => (existsSync(CONFIG) ? ['-F', CONFIG] : [])
// owner/repo of a github.com remote (https, ssh or scp's form)
export const ghRepo = (url: string) => /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]
// a remote's URL as gh's -R takes it, [HOST/]OWNER/REPO: git@host:o/r.git, ssh://git@host:22/o/r, https://host/o/r.git;
// none for a path or anything else
export const repoOf = (url: string) => (m => m && `${m[1]}/${m[2]}`)(/^(?:[a-z][\w+.-]*:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim()))

export const SCOPE = 'gh needs the codespace scope: run gh auth refresh -s codespace'
// gh here (cwd: create's, the project's folder, which fakes/gh clones); its failure as a line you can act on: the
// codespace scope most of all, which gh auth login doesn't ask for
async function gh(args: string[], timeout = 30000, cwd?: string) {
  try {
    return (await run('gh', args, { cwd, timeout, maxBuffer: 16 << 20 })).stdout.trim()
  } catch (e: any) {
    const err = String(e.stderr || e.message)
    if (e.code === 'ENOENT') throw new Error(`gh isn't installed: ${process.platform === 'darwin' ? 'brew' : 'sudo apt'} install gh, then gh auth login`)
    if (/codespace"? scope|-s codespace/i.test(err)) throw new Error(SCOPE)
    if (/gh auth login|not logged in/i.test(err)) throw new Error("gh isn't signed in: run gh auth login")
    throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${err.trim().split('\n')[0]}`)
  }
}

// the machine types the repo may use (the new-workspace page's; wsNew asks too: the scope, the repo, the name)
export const machines = async (repo: string) =>
  ((JSON.parse(await gh(['api', `repos/${repo}/codespaces/machines`])).machines ?? []) as { name: string; display_name?: string }[]).map(m => ({ name: m.name, display: m.display_name || m.name }))

// gh waits while it's made; its name is the last line it prints. --default-permissions: a devcontainer asking for more
// would wait on a question no one sees
export const create = async (cwd: string, repo: string, branch: string, machine: string) => (await gh(['codespace', 'create', '-R', repo, '-b', branch, '-m', machine, '--default-permissions'], 15 * 60e3, cwd)).split('\n').at(-1)!.trim()

export const stateOf = async (name: string) => String(JSON.parse(await gh(['codespace', 'view', '-c', name, '--json', 'state'])).state ?? '')

// until it's Available (10 minutes at most); Failed or Deleted: why not
export async function until(name: string, ms = 10 * 60e3) {
  for (const end = Date.now() + ms; ; await new Promise(r => setTimeout(r, 3000))) {
    const s = await stateOf(name)
    if (s === 'Available') return
    if (s === 'Failed' || s === 'Deleted') throw new Error(`GitHub says it's ${s}`)
    if (Date.now() > end) throw new Error(`still ${s} after ${ms / 60e3} minutes`)
  }
}

// gh has no start: its API's (not again for one Starting), then until it's up
export const start = async (name: string, st = '') => (st === 'Starting' || (await gh(['api', '-X', 'POST', `user/codespaces/${name}/start`])), await until(name))
// one stopped already (its idle timeout) is as good
export const stop = (name: string) => gh(['codespace', 'stop', '-c', name], 120000).catch(e => (/not running/i.test(e.message) ? '' : Promise.reject(e)))
// one gone already (deleted on github.com) is as good
export const remove = (name: string) => gh(['codespace', 'delete', '-c', name, '--force'], 120000).catch(e => (/404|not found/i.test(e.message) ? '' : Promise.reject(e)))
export const list = async () => new Map((JSON.parse((await gh(['codespace', 'list', '--json', 'name,state', '-L', '200'])) || '[]') as { name: string; state: string }[]).map(c => [c.name, c.state]))

// the config that includes them, then yours and the system's (-F reads neither by itself): ssh takes each option's
// first value, so a Host * of yours (User, IdentityFile, ProxyCommand) never wins over a codespace's own; its entries
// name only laki-cs-* hosts. Written as the first cloud workspace is made, before its tabs' ssh lines
export function sshConfig() {
  mkdirSync(entries, { recursive: true, mode: 0o700 })
  writeFileSync(CONFIG, `# Laki's ssh config (-F): its codespaces' Host entries first, then yours\nInclude "${entries}/*"\nInclude ~/.ssh/config\nInclude /etc/ssh/ssh_config\n`, { mode: 0o600 })
}
// its Host entry, as alias
export async function sshEntry(name: string, alias: string) {
  const text = await gh(['codespace', 'ssh', '--config', '-c', name])
  if (!/^[ \t]*Host[ \t]/m.test(text)) throw new Error(`gh codespace ssh --config -c ${name}: no Host entry`)
  sshConfig()
  writeFileSync(join(entries, alias), `${text.replace(/^[ \t]*Host[ \t].*$/gm, `Host ${alias}`)}\n`, { mode: 0o600 })
}
export const hasEntry = (alias: string) => existsSync(join(entries, alias))
export const forget = (alias: string) => rmSync(join(entries, alias), { force: true })
