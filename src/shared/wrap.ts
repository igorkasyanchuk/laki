// The macOS wrapper sandbox (a profile's wrap: 'macos'): an agent whose own sandbox is off or that has none runs under
// /usr/bin/sandbox-exec with a profile made here. Each agent's own sandbox, as its documentation says (Nov 2026):
// - Claude Code: its own (settings' sandbox: Seatbelt on macOS, for its Bash commands); Laki's profile Sandbox switch.
// - Codex: its own (-s workspace-write: Seatbelt on macOS); Laki's profile Sandbox switch.
// - Antigravity CLI (agy, the gemini agent): its own, off by default (--sandbox: terminal restrictions); Laki doesn't
//   turn it on (agy --help).
// - Grok Build: its own, off by default (--sandbox workspace, GROK_SANDBOX, [sandbox] profile in ~/.grok/config.toml:
//   Seatbelt on macOS); Laki doesn't turn it on (docs.x.ai/build/features/sandbox).
// - OpenCode: none; permission rules only, its shell "runs with the host user's … authority" (opencode.ai/docs/permissions).
// So the wrapper is for OpenCode, and Antigravity, Grok, Claude or Codex with their own off (one sandbox inside another:
// sandbox-exec can't nest). Pure: the daemon (core.ts wrapCmd) realpaths every path first and passes them as -D
// parameters: a path is never written into the profile's text
import type { Agent } from './types.ts'

// an agent's own sandbox, turned on by its profile's flags or env (Laki's switch for claude and codex: core's sandboxed)
const OWN: Partial<Record<Agent, { args: RegExp; env?: string }>> = {
  gemini: { args: /(^|\s)--sandbox(?=[\s=]|$)(?![\s=]+(false|off)\b)/ }, // agy's: a flag only
  grok: { args: /(^|\s)--sandbox[\s=]+(?!off\b)\S/, env: 'GROK_SANDBOX' },
}
export const ownBoxOn = (agent: string, args = '', env: Record<string, string> = {}) => (o => !!o && (o.args.test(args) || (!!o.env && !!env[o.env] && !/^(0|false|off)$/i.test(env[o.env]))))(OWN[agent as Agent])
// the folders under home an agent writes as it runs (its docs: Claude Code's ~/.claude and ~/.claude.json, Codex's
// CODEX_HOME ~/.codex, agy's ~/.gemini (antigravity-cli, config), Grok's ~/.grok "stays writable … so sessions can persist", OpenCode's
// ~/.local/share/opencode (its log and database), ~/.local/state/opencode, ~/.config/opencode, ~/.opencode/plan)
export const AGENT_WRITES: Record<Agent, string[]> = {
  claude: ['.claude', '.claude.json'],
  codex: ['.codex'],
  gemini: ['.gemini'],
  grok: ['.grok'],
  opencode: ['.local/share/opencode', '.local/state/opencode', '.config/opencode', '.opencode'],
}
// what no wrapped agent reads: keys and tokens, the Keychains, every other agent's config
export const SECRET_HOME = ['.ssh', '.aws', '.gnupg', '.config/gh', 'Library/Keychains']

// a wrapped profile's network (its net): all, or its listed hosts through Laki's proxy
export const WRAP_NET: ('all' | 'list')[] = ['all', 'list']
export type WrapIn = {
  agent: Agent
  worktree: string
  home: string
  gitDirs?: string[] // what git commit writes for this worktree (a worktree's live in the main repo's .git)
  tmp: string[] // the system's temp folders (/private/tmp, $TMPDIR's)
  write?: string[] // more it may write: its storage folder, its account's folder, Laki's status line folder
  data?: string // Laki's data folder: no file in it read, nor its folders listed (its secrets, ones made later too), but
  // walked through (a stat, a realpath of its worktree in it), so file-read-data only: file-read* breaks the path to them
  allowRead?: string[] // read back out of it, never written: its hook and plugin files, pasted pictures (what it writes too)
  net?: 'all' | 'list' | 'off' // list: no network but this Mac's (the daemon, Laki's proxy: daemon/netProxy.ts, its HTTPS_PROXY); all, unset: as it is
  ptySock?: string // the pty host's socket (proto.ts' ptySock: in the temp folder when the data folder's path is long)
}
// SBPL's last matching rule wins, of rules for the same operation (one for file-read-data wins over file-read*'s, as
// macOS 26 runs it): everything allowed, then writes denied but where it works, then the data folder's files, then what
// it works in and reads of it back, then reads denied of secrets (each a -D parameter: subpath for a folder, literal for
// a file name: .claude.json); a worktree that holds ~/.ssh still can't read it. net list: every connection out denied
// (a unix socket's too: DNS, ssh-agent) but to this Mac's loopback, so a host is reached through Laki's proxy or not at all.
// Whatever its net: no unix socket in the data folder (the pty host's: every terminal) nor the pty host's own, last so it wins
export function wrapProfile(o: WrapIn): { text: string; params: string[] } {
  const params: string[] = []
  const ref = (path: string, kind: 'subpath' | 'literal' | 'path-literal' = 'subpath') => {
    const k = `P${params.length / 2}`
    params.push('-D', `${k}=${path}`)
    return `(${kind} (param "${k}"))`
  }
  const h = (rel: string) => `${o.home.replace(/\/+$/, '')}/${rel}`
  const own = AGENT_WRITES[o.agent].map(rel => ref(h(rel), /\.json$/.test(rel) ? 'literal' : 'subpath'))
  const writes = [o.worktree, ...o.tmp, ...(o.write ?? [])].map(p => ref(p))
  const git = (o.gitDirs ?? []).map(p => ref(p))
  const others = (Object.keys(AGENT_WRITES) as Agent[]).filter(a => a !== o.agent).flatMap(a => AGENT_WRITES[a]).filter(rel => !AGENT_WRITES[o.agent].includes(rel))
  const reads = [...SECRET_HOME.map(h), ...others.map(h)].map(p => ref(p, /\.json$/.test(p) ? 'literal' : 'subpath'))
  const data = o.data ? ref(o.data) : undefined
  // only what's in it: a worktree that holds the data folder (a project at ~) doesn't read it all back
  const back = data ? [o.worktree, ...(o.gitDirs ?? []), ...(o.write ?? []), ...(o.allowRead ?? [])].filter(p => p.startsWith(`${o.data!.replace(/\/+$/, '')}/`)).map(p => ref(p)) : []
  const text = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write*\n  ${[...writes, ...own].join('\n  ')}\n  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (literal "/dev/ptmx")\n  (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
    // its .git (a worktree's file, a checkout's folder) isn't its to write: it names the git folder and the config that
    // Laki's own git reads outside the sandbox (a program to run). What git commit writes there allowed back (gitDirs)
    `(deny file-write* ${ref(`${o.worktree.replace(/\/+$/, '')}/.git`)})`,
    ...(git.length ? [`(allow file-write*\n  ${git.join('\n  ')})`] : []),
    ...(data ? [`(deny file-read-data ${data})`] : []),
    ...(back.length ? [`(allow file-read-data\n  ${back.join('\n  ')})`] : []), // never one with none: that allows every read
    `(deny file-read*\n  ${reads.join('\n  ')})`,
    ...(data ? [`(deny file-read-data\n  ${reads.join('\n  ')})`] : []), // file-read* never wins over a file-read-data rule, before it or after
    ...(o.net === 'list' ? ['(deny network-outbound)', '(allow network-outbound (remote ip "localhost:*"))'] : []),
    ...(data ? [`(deny network-outbound (remote unix-socket ${data}))`] : []),
    ...(o.ptySock ? [`(deny network-outbound (remote unix-socket ${ref(o.ptySock, 'path-literal')}))`] : []),
    '',
  ].join('\n')
  return { text, params }
}
// a refused write in what a wrapped tab printed: the path, when the line says Operation not permitted (macOS's EPERM)
export function wrapRefused(out: string): string | undefined {
  const t = out.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  const m = /(\/[^\s'":]+)['"]?:?\s*Operation not permitted/i.exec(t) ?? /operation not permitted,? \w+ ['"](\/[^'"]+)['"]/i.exec(t)
  return m?.[1]
}
