// laki: the command line for the daemon. `laki hook <state>` is what agents' hooks run: it never fails or
// blocks the agent for more than a second.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { daemonScript, ensureDaemon, rpc } from '../shared/conn.ts'
import { REMOTE, type Schedule, type ScheduleRun, type View, type WidgetView, type Workspace } from '../shared/types.ts'
import { USAGE } from '../shared/usage.ts'
import { mcp, state } from './mcp.ts'
import { describe } from '../shared/when.ts'

const argv = process.argv.slice(2)
const flags: Record<string, string | true> = {}
const args: string[] = []
const VALUED = new Set(['base', 'preset', 'cmd', 'prompt', 'name', 'lines', 'm', 'message', 'when', 'where', 'model', 'effort', 'issue', 'pr', 'fan', 'tab'])
const BOOL = new Set(['json', 'local', 'when-idle', 'full'])
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
      // the app this CLI ships in, else this checkout's build (dist/mac-arm64: Apple silicon, dist/mac: Intel), else
      // whatever LaunchServices knows as laki
      const here = dirname(fileURLToPath(import.meta.url))
      const dist = `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Laki.app`
      const app = [process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, ''), resolve(here, '../..', dist), resolve(here, '../../..', dist)].find(p => p.endsWith('.app') && existsSync(p))
      try {
        execFileSync('open', app ? [app] : ['-b', 'dev.laki.app'], { stdio: 'ignore' })
      } catch {
        throw new Error(`Laki.app not found: build it with \`npm run pack\` (${dist}), or copy it to /Applications`)
      }
      return
    }
    case 'stop':
      return rpc('shutdown').catch(() => {})
    case 'mcp':
      return mcp() // starts the daemon at its first tool call: stdout is the protocol's
  }
  await ensureDaemon()
  switch (cmd) {
    case 'ls': {
      if (json) return out(await state()) // agents read it: no secrets
      const v: View = await rpc('state')
      for (const p of v.projects) {
        console.log(`${p.id}  ${p.host ? `${p.host}:` : ''}${p.path}`)
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
      if (sub === 'add') {
        const { config: _, ...p } = await rpc('projectAdd', { path: REMOTE.test(arg ?? '') && !existsSync(arg!) ? arg : resolve(arg ?? '.') }) // host:path is the host's; config: its env
        return out(p, `added ${arg}`)
      }
      if (sub === 'rm') return out(await rpc('projectRm', { id: arg }), `removed ${arg}`)
      const { projects } = await state()
      return out(projects, projects.map(p => `${p.id}  ${p.host ? `${p.host}:` : ''}${p.path}`).join('\n'))
    }
    case 'new': {
      if (!rest[0]) throw new Error('usage: laki new <project> [--base b] [--preset p] [--model m] [--effort e] [--issue url|n] [--pr url|n] [--fan claude,codex] [--prompt text]')
      const o = {
        project: rest[0],
        base: flags.base,
        preset: flags.preset,
        cmd: flags.cmd,
        prompt: flags.prompt || rest.slice(1).join(' ') || undefined,
        name: flags.name,
        local: !!flags.local,
        model: flags.model,
        effort: flags.effort,
        issue: flags.issue || undefined,
        pr: flags.pr || undefined,
      }
      const line = (ws: Workspace) => `${ws.id}  ${ws.path}  (${ws.branch ? `branch ${ws.branch}` : 'folder'}, PORT ${ws.port})`
      // a race: the same prompt to each preset, a worktree each
      if (flags.fan) {
        const presets = String(flags.fan).split(',').map(p => p.trim()).filter(Boolean)
        const made: Workspace[] = await rpc('wsFan', { ...o, presets }, 120000 * Math.max(1, presets.length))
        return out(made, made.map(line).join('\n'))
      }
      const ws: Workspace = await rpc('wsNew', o, 120000)
      return out(ws, line(ws))
    }
    case 'browser': {
      // laki browser [ws] open [url] | screenshot | click <selector> | fill <selector> <text> | text; in a tab, its workspace
      const ops = ['open', 'screenshot', 'click', 'fill', 'text']
      const [ws, op, ...more] = ops.includes(rest[0]) && process.env.LAKI_WORKSPACE ? [process.env.LAKI_WORKSPACE, ...rest] : rest
      if (!ws || !ops.includes(op)) throw new Error('usage: laki browser [ws] open [url|/path] | screenshot | click <selector> | fill <selector> <text> | text')
      const p = op === 'open' ? { url: more[0] } : op === 'click' ? { selector: more.join(' ') } : op === 'fill' ? { selector: more[0], text: more.slice(1).join(' ') } : {}
      const r = await rpc('browse', { ws, op, ...p }, 45000)
      return out(r, op === 'text' ? r.text : op === 'screenshot' ? r.path : op === 'open' ? `${r.url}${r.title ? `  ${r.title}` : ''}` : 'ok')
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
    case 'progress': {
      // laki progress <0-100> [what you're on]: an agent's estimate, on its tab (LAKI_TAB) until its turn ends
      if (!rest[0]) throw new Error('usage: laki progress <0-100> [what you are on]')
      const r = await rpc('progress', { tab: flags.tab || process.env.LAKI_TAB, pct: String(rest[0]).replace(/%$/, ''), note: rest.slice(1).join(' ') || undefined })
      return out(r, `${r.pct}%`) // as the tab shows it: 0 to 100, whole
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
      const line = (s: Schedule) => `${s.id}  ${s.on ? 'on ' : 'off'}  ${describe(s.rule)}${s.next ? `, next ${at(s.next)}` : ''}  ${s.project} · ${s.preset} · ${({ local: 'folder', 'local-new': 'folder-new' } as Record<string, string>)[s.ws] ?? s.ws}  ${s.name || s.prompt}`
      if (sub === 'ls' || sub === 'log') {
        const v: View = await rpc('state')
        if (sub === 'ls') return out(v.schedules ?? [], (v.schedules ?? []).map(line).join('\n') || 'no scheduled tasks')
        return out(v.runs ?? [], (v.runs ?? []).map((r: ScheduleRun) => `${at(r.at)}  ${r.ok ? '✓' : '✗'}  ${r.name}  ${r.what}`).join('\n') || 'no runs yet')
      }
      if (sub === 'add') {
        if (!flags.when) throw new Error('when? laki schedule add <project> --when "weekdays at 9am" <prompt>')
        const where = ({ folder: 'local', 'folder-new': 'local-new' } as Record<string, string>)[String(flags.where)] ?? (flags.where || undefined)
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
    case 'widget':
    case 'widgets': {
      const [sub = 'ls', id, action, ...arg] = rest
      if (sub === 'ls') {
        const ws: WidgetView[] = (await rpc('state')).widgets ?? []
        const line = (w: WidgetView) => `${w.id}  ${w.on ? 'on ' : 'off'}  ${w.size.join('×')}  ${w.every ? `every ${w.every}m` : 'no fetch'}  ${w.error ? `✗ ${w.error}` : w.at ? '✓' : ''}  ${w.dir}`
        return out(ws, ws.map(line).join('\n') || 'no widgets')
      }
      if (sub === 'reload') return out(await rpc('widgetReload'), 'reloaded')
      if (sub === 'on' || sub === 'off') return out(await rpc('widgetSet', { id, on: sub === 'on' }), `${id} ${sub}`)
      if (sub === 'run') {
        const r = await rpc('widgetRun', { id }, 130000)
        return out(r, r.ok ? 'fetched' : `✗ ${r.error}`)
      }
      if (sub === 'render') {
        const html: string | null = await rpc('widgetRender', { id, full: !!flags.full })
        return out(html, html ?? `${id} has no ${flags.full ? 'full' : 'preview'} view`)
      }
      if (sub === 'action') {
        const r = await rpc('widgetAction', { id, action, arg: arg.join(' ') }, 130000)
        return out(r, r.ok ? r.out || [r.toast, r.modal?.title, r.modal?.text].filter(Boolean).join('\n') || 'done' : `✗ ${r.error}`) // what the app would show
      }
      throw new Error('usage: laki widget [ls] | reload | on|off|run <id> | render <id> [--full] | action <id> <action> [arg]')
    }
    default:
      throw new Error(`unknown command ${cmd}\n\n${USAGE}`)
  }
}

main().catch(e => {
  console.error(`laki: ${e.message}`)
  process.exit(1)
})
