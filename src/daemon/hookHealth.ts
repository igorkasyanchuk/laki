// Hooks not heard: why an agent's hooks likely don't reach Laki, for a tab core.ts' hookTick marks hookless. Pure but
// for reading what it's given: core passes the workspace, the settings files to look in, the profile and the hook command
// (idea: Open Island's HookHealthCheck; nothing of its code)
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

// OSC 7501's root against the status hooks gave (shadow: core's programSeen only counts it)
export const nativeAgrees = (native: string, status: string) => status === (native === 'working' ? 'running' : native === 'blocked' ? 'waiting' : 'idle')

export type HookWhy = { why: string; detail?: string } // detail: what to look at, to copy (a file:line, the args, the command)

// a path as you'd say it: inside the workspace relative, in your home with ~
const said = (p: string, cwd?: string) => (cwd && p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p.startsWith(homedir() + '/') ? `~${p.slice(homedir().length)}` : p)

// the first that holds: (1) a settings file turns hooks off; (2) the profile's args bring their own --settings (claude
// takes one); (3) CLAUDE_CONFIG_DIR set in an env of yours; (4) Laki's hook command doesn't run (the node or Electron it
// names gone: a moved or updated app under a daemon that outlived it); (5) the agent's own: gemini's trusted folders, or
// too old for hooks
export function hookCause(o: { agent: string; cwd?: string; files?: string[]; args?: string; env?: { where: string; dir: string }; argv: string[] }): HookWhy {
  for (const f of o.files ?? []) {
    let text = ''
    let j: any
    try {
      text = readFileSync(f, 'utf8')
      j = JSON.parse(text)
    } catch {
      continue
    }
    const key = j?.disableAllHooks === true ? 'disableAllHooks' : j?.allowManagedHooksOnly === true ? 'allowManagedHooksOnly' : undefined
    if (!key) continue
    const line = text.split('\n').findIndex(l => l.includes(`"${key}"`)) + 1
    return { why: `"${key}": true in ${said(f, o.cwd)}`, detail: `${f}${line ? `:${line}` : ''}` }
  }
  if (o.agent === 'claude' && /(^|\s)--settings(\s|=|$)/.test(o.args ?? '')) return { why: "its profile's args have their own --settings: claude takes one, so Laki's hooks aren't loaded", detail: o.args }
  if (o.env) return { why: `CLAUDE_CONFIG_DIR is set in ${o.env.where}: claude reads its settings from ${said(o.env.dir)} (an account in Settings › Agents & profiles does that for you)`, detail: `CLAUDE_CONFIG_DIR=${o.env.dir}` }
  const cmd = o.argv.join(' ')
  const [bin, script] = [o.argv[0], o.argv.at(-1)!]
  if (!existsSync(bin)) return { why: `Laki's hook command doesn't run: ${bin} is gone (the app moved or was updated: restart Laki)`, detail: cmd }
  try {
    accessSync(bin, constants.X_OK)
  } catch {
    return { why: `Laki's hook command doesn't run: ${bin} isn't executable`, detail: cmd }
  }
  if (!existsSync(script)) return { why: `Laki's hook command doesn't run: ${script} is gone (the app moved or was updated: restart Laki)`, detail: cmd }
  if (o.agent === 'gemini') return { why: 'gemini runs hooks only in versions that have them, in a folder it trusts', detail: o.cwd }
  return { why: `unknown: ${o.agent} may be too old for hooks` }
}
