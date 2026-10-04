// laki: the command line for the daemon. `laki hook <state>` is what agents' hooks run: it never fails or
// blocks the agent for more than a second.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { daemonScript, ensureDaemon, rpc } from '../shared/conn.ts'
import type { Schedule, ScheduleRun, View } from '../shared/types.ts'
import { USAGE } from '../shared/usage.ts'
import { describe } from '../shared/when.ts'

const argv = process.argv.slice(2)
const flags: Record<string, string | true> = {}
const args: string[] = []
const VALUED = new Set(['base', 'preset', 'cmd', 'prompt', 'name', 'lines', 'm', 'message', 'when', 'where'])
const BOOL = new Set(['json', 'local', 'when-idle'])
// only known flags are flags (message text may start with "-"); after "--" everything is text
let textOnly = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const k = a.replace(/^-+/, '')
  if (!textOnly && a === '--') textOnly = true
  else if (!textOnly && args[0] !== 'hook' && a.startsWith('-') && (VALUED.has(k) || BOOL.has(k))) flags[k] = VALUED.has(k) ? (argv[++i] ?? '') : true
  else args.push(a)
}
const json = !!flags.json
const out = (v: unknown, text?: string) => console.log(json || text === undefined ? JSON.stringify(v, null, 2) : text)

async function hook(state: string, extra?: string) {
  setTimeout(() => process.exit(0), 1000) // never hold the agent up
  const tab = process.env.LAKI_TAB
  if (!tab) process.exit(0)
  let payload: unknown = {}
  try {
    if (extra) payload = JSON.parse(extra)
    else if (!process.stdin.isTTY) {
      const text = await new Promise<string>(r => {
        let s = ''
        process.stdin.on('data', d => (s += d)).on('end', () => r(s)).on('error', () => r(s))
        setTimeout(() => r(s), 400)
      })
      if (text.trim()) payload = JSON.parse(text)
    }
  } catch {}
  await rpc('hook', { tab, state, payload }, 700).catch(() => {})
  process.exit(0)
}

const glyph: Record<string, string> = { running: '◐', waiting: '◆', idle: '○', exited: '✖' }

async function main() {
  const [cmd, ...rest] = args
  switch (cmd) {
    case 'hook':
      return hook(rest[0], rest[1])
    case 'daemon':
      return import(pathToFileURL(daemonScript()).href)
    case undefined:
    case 'help':
      return console.log(USAGE)
    case 'open': {
      // the app this CLI ships in, else this checkout's build, else whatever LaunchServices knows as laki
      const here = dirname(fileURLToPath(import.meta.url))
      const app = [process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, ''), resolve(here, '../../dist/mac-arm64/Laki.app'), resolve(here, '../../../dist/mac-arm64/Laki.app')].find(p => p.endsWith('.app') && existsSync(p))
      try {
        execFileSync('open', app ? [app] : ['-b', 'dev.laki.app'], { stdio: 'ignore' })
      } catch {
        throw new Error('Laki.app not found: build it with `npm run pack` (dist/mac-arm64/Laki.app), or copy it to /Applications')
      }
      return
    }
    case 'stop':
      return rpc('shutdown').catch(() => {})
  }
  await ensureDaemon()
  switch (cmd) {
    case 'ls': {
      const v: View = await rpc('state')
      if (json) return out(v)
      for (const p of v.projects) {
        console.log(`${p.id}  ${p.path}`)
        for (const w of v.workspaces.filter(w => w.project === p.id)) {
          const tabs = v.tabs.filter(t => t.workspace === w.id)
          const extra = [w.archived ? 'archived' : `:${w.port}`, w.pr ? `PR #${w.pr.number} ${w.pr.state}` : '', w.ports.length ? `listening ${w.ports.join(',')}` : '']
          console.log(`  ${w.id}  ${w.branch || 'folder'}  ${extra.filter(Boolean).join('  ')}`)
          for (const t of tabs) console.log(`    ${t.status === 'exited' && t.code === 0 ? '✓' : (glyph[t.status] ?? ' ')}${t.done ? '●' : ' '} ${t.name} (${t.id})${t.queue?.length ? ` +${t.queue.length} queued` : ''}`)
        }
      }
      return
    }
    case 'project': {
      const [sub, arg] = rest
      if (sub === 'add') return out(await rpc('projectAdd', { path: resolve(arg ?? '.') }), `added ${arg}`)
      if (sub === 'rm') return out(await rpc('projectRm', { id: arg }), `removed ${arg}`)
      const v: View = await rpc('state')
      return out(v.projects, v.projects.map(p => `${p.id}  ${p.path}`).join('\n'))
    }
    case 'new': {
      if (!rest[0]) throw new Error('usage: laki new <project> [--base b] [--preset p] [--prompt text]')
      const ws = await rpc('wsNew', {
        project: rest[0],
        base: flags.base,
        preset: flags.preset,
        cmd: flags.cmd,
        prompt: flags.prompt || rest.slice(1).join(' ') || undefined,
        name: flags.name,
        local: !!flags.local,
      })
      return out(ws, `${ws.id}  ${ws.path}  (${ws.branch ? `branch ${ws.branch}` : "folder"}, PORT ${ws.port})`)
    }
    case 'rm':
    case 'archive':
    case 'restore':
    case 'fork': {
      const m = { rm: 'wsRm', archive: 'wsArchive', restore: 'wsRestore', fork: 'wsFork' }[cmd]
      const r = await rpc(m, { id: rest[0] }, 120000)
      return out(r ?? { ok: true }, r?.id ? `${r.id}  ${r.path}` : 'ok')
    }
    case 'tab': {
      const t = await rpc('tabNew', { ws: rest[0], preset: flags.preset, cmd: flags.cmd })
      return out(t, `${t.name} (${t.id})`)
    }
    case 'send': {
      const [target, ...words] = rest
      const r = await rpc('send', { target, text: words.join(' '), whenIdle: !!flags['when-idle'] })
      return out(r, r.sent ? 'sent' : `queued (${r.queued} waiting): sent when the agent finishes its turn`)
    }
    case 'screen': {
      const text = await rpc('screen', { target: rest[0], lines: Number(flags.lines) || 30 })
      return out(text, text)
    }
    case 'diff': {
      const d = await rpc('diff', { ws: rest[0] })
      return out(d, d.diff)
    }
    case 'run': {
      const t = await rpc('run', { ws: rest[0] })
      return out(t, `started ${t.name} (${t.id})`)
    }
    case 'ship': {
      const t = await rpc('ship', { ws: rest[0], message: flags.m || flags.message })
      return out(t, `shipping in tab ${t.name} (${t.id})`)
    }
    case 'schedule': {
      const [sub = 'ls', id, ...words] = rest
      const at = (t?: number) => (t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
      const line = (s: Schedule) => `${s.id}  ${s.on ? 'on ' : 'off'}  ${describe(s.rule)}${s.next ? `, next ${at(s.next)}` : ''}  ${s.project} · ${s.preset} · ${s.ws === 'local' ? 'folder' : s.ws}  ${s.name || s.prompt}`
      if (sub === 'ls' || sub === 'log') {
        const v: View = await rpc('state')
        if (sub === 'ls') return out(v.schedules ?? [], (v.schedules ?? []).map(line).join('\n') || 'no scheduled tasks')
        return out(v.runs ?? [], (v.runs ?? []).map((r: ScheduleRun) => `${at(r.at)}  ${r.ok ? '✓' : '✗'}  ${r.name}  ${r.what}`).join('\n') || 'no runs yet')
      }
      if (sub === 'add') {
        if (!flags.when) throw new Error('when? laki schedule add <project> --when "weekdays at 9am" <prompt>')
        const where = flags.where === 'folder' ? 'local' : flags.where || undefined
        const s = await rpc('scheduleSet', { project: id, when: flags.when, preset: flags.preset, ws: where, name: flags.name, prompt: flags.prompt || words.join(' ') })
        return out(s, line(s))
      }
      if (sub === 'on' || sub === 'off') return out(await rpc('scheduleSet', { id, on: sub === 'on' }), `${id} ${sub}`)
      if (sub === 'run') {
        const r = await rpc('scheduleRun', { id }, 120000)
        return out(r, `${r.ok ? '✓' : '✗'} ${r.what}`)
      }
      if (sub === 'rm') return out((await rpc('scheduleRm', { id })) ?? { ok: true }, `removed ${id}`)
      throw new Error(`usage: laki schedule [ls] | log | add <project> --when "…" <prompt> | on|off|run|rm <id>`)
    }
    default:
      throw new Error(`unknown command ${cmd}\n\n${USAGE}`)
  }
}

main().catch(e => {
  console.error(`laki: ${e.message}`)
  process.exit(1)
})
