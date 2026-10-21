// laki: the command line for the daemon. `laki hook <state>` is what agents' hooks run: it never fails or
// blocks the agent for more than a second.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { alive, daemonScript, ensureDaemon, rpc } from '../shared/conn.ts'
import { type AiCall, type AiMsg, type AiTotals, cellsOf, DEVICE_OPS, type Memory, placesOf, REMOTE, type Remote, type Schedule, type ScheduleRun, type EventSent, type GateHeld, type View, type WidgetLogLine, type WidgetRuns, type WidgetView, type Workspace } from '../shared/types.ts'
import { helpFor, USAGE } from '../shared/usage.ts'
import { mcp, state } from './mcp.ts'
import { blockName, check, FLOW_ENDED, parse, type FlowRun, type FlowView, type WorkflowItem } from '../shared/workflow.ts'
import { describe } from '../shared/when.ts'
import { COMMON, UI, UI_SAMPLES, type UiProblem, type UiType } from '../shared/widgetUi.ts'
import { ICONS } from '../shared/icons.ts'
import { STARTER_KINDS } from '../shared/widgetStarters.ts'

const argv = process.argv.slice(2)
const flags: Record<string, string | true> = {}
const args: string[] = []
const sets: string[] = [] // --set name=value, again and again: a workflow run's inputs
const VALUED = new Set(['base', 'preset', 'cmd', 'prompt', 'name', 'lines', 'm', 'message', 'when', 'where', 'model', 'effort', 'issue', 'pr', 'fan', 'tab', 'image', 'ws', 'off', 'kind', 'dir', 'place', 'size', 'every', 'view', 'hide', 'seen', 'level'])
const BOOL = new Set(['json', 'local', 'when-idle', 'full', 'dry', 'mine', 'list', 'no-run', 'merge', 'force'])
// only known flags are flags (message text may start with "-"); after "--" everything is text
let textOnly = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const k = a.replace(/^-+/, '')
  if (!textOnly && a === '--') textOnly = true
  else if (!textOnly && ['flow', 'flows', 'workflow'].includes(args[0]) && (a === '--set' || a === '-set')) sets.push(argv[++i] ?? '') // flow run's only: elsewhere it's words
  else if (!textOnly && ['flow', 'flows', 'workflow'].includes(args[0]) && a === '--from') flags.from = argv[++i] ?? '' // flow again's
  else if (!textOnly && ['widget', 'widgets'].includes(args[0]) && (a === '-n' || a === '-f')) flags[k] = a === '-n' ? (argv[++i] ?? '') : true // laki widget logs' only: elsewhere they're words
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

// laki flow check [file.md… | folder]: each workflow file read and checked as Laki does (parse, then check), with no
// daemon, so a repo's hook or CI can run it; none given: ./.laki/workflows, a folder its *.md. Exit 1 on any problem.
// A `use:` action's slug and a preset's name aren't known here: not checked
function flowCheck(paths: string[]) {
  const files = (paths.length ? paths : ['.laki/workflows']).flatMap(p => {
    if (!existsSync(p)) throw new Error(`no ${p}${paths.length ? '' : ': give a workflow file or folder'}`)
    return statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.md')).sort().map(f => join(p, f)) : [p]
  })
  if (!files.length) throw new Error(`no workflows (*.md) in ${paths.join(', ') || '.laki/workflows'}`)
  const r = files.map(file => {
    const { workflow, problems } = parse(readFileSync(file, 'utf8'), basename(file, '.md'))
    return { file, name: workflow.name, problems: [...problems, ...check(workflow)] }
  })
  out(r, r.map(x => [`${x.problems.length ? '✗' : '✓'} ${x.name}  ${x.file}`, ...x.problems.map(p => `  ${p}`)].join('\n')).join('\n'))
  if (r.some(x => x.problems.length)) process.exitCode = 1
}

// laki widget dev [folder]: your extension's folder (this one by default) linked, on and watched; then its fetches and
// actions as they run, a line each, until Ctrl-C (the link stays). --off <id|folder> unlinks, --list lists them
// who runs this (the daemon's agentCaller tells an agent's tab from yours): laki widget's action, on, dev, run and check
const caller = () => ({ ws: process.env.LAKI_WORKSPACE, tab: process.env.LAKI_TAB })
async function dev(folder?: string) {
  type Link = { folder: string; widgets: { id: string; name: string; on: boolean; devError?: string }[] }
  if (flags.list) {
    const { links } = (await rpc('widgetDev', { list: true })) as { links: Link[] }
    return out(links, links.map(l => `${l.folder}  ${l.widgets.map(w => `${w.id}${w.devError ? ' ✗' : ''}`).join(', ') || '(no widget found)'}`).join('\n') || 'no folders linked: laki widget dev [folder]')
  }
  if (typeof flags.off === 'string') return out(await rpc('widgetDev', { off: flags.off }), `unlinked ${flags.off}`)
  const t0 = Date.now()
  const r = (await rpc('widgetDev', { folder: resolve(folder ?? '.'), from: caller() })) as { folder: string; widgets: { id: string; name: string; devError?: string }[]; broken: string[]; note?: string }
  if (json) return out(r)
  if (r.note) console.log(r.note)
  for (const b of r.broken) console.log(`✗ ${b}`)
  for (const w of r.widgets) if (w.devError) console.log(`✗ ${w.id}: ${w.devError}`)
  console.log(`Watching ${r.folder} · open Settings › Extensions › ${r.widgets.map(w => w.name).join(', ') || '…'} › Inspect`)
  const seen = new Map(r.widgets.map(w => [w.id, { at: t0 - 1, err: w.devError }]))
  const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 8)
  const size = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`)
  const many = seen.size > 1
  for (;;) {
    for (const [id, s] of seen) {
      const x = (await rpc('widgetRuns', { id }).catch(() => null)) as WidgetRuns | null
      if (!x) continue
      const who = many ? `${id} ` : ''
      if (x.devError !== s.err) console.log(x.devError ? `${hm(Date.now())} ${who}✗ last good version kept: ${x.devError}` : `${hm(Date.now())} ${who}reads again`), (s.err = x.devError)
      for (const run of x.runs.filter(u => u.at > s.at).reverse()) {
        const what = run.action ? `action ${run.action}` : 'fetch'
        console.log(`${hm(run.at)} ${who}${what} ${run.ok ? `ok ${run.ms} ms ${size(run.bytes)}` : `failed ${run.ms} ms: ${run.error}`} (${run.reason}${run.why ? `: ${run.why}` : ''})`)
        s.at = run.at
      }
    }
    await new Promise(ok => setTimeout(ok, 500))
  }
}

// the UI kit's catalog (widget.json's "ui"), or one element's props and its sample: for agents and terminals
function kit(type?: string) {
  const kind = (k: unknown) => (Array.isArray(k) ? k.join('|') : String(k))
  const props = (t: UiType) => Object.entries(UI[t].props as Record<string, { kind: unknown; desc: string }>).map(([name, p]) => ({ name, kind: kind(p.kind), desc: p.desc }))
  // every icon an extension can name: a button's, a row's, the icon element's (or any emoji)
  if (type === 'icons') return out(Object.keys(ICONS), [`${Object.keys(ICONS).length} icons, by name (or any emoji): Settings › Extensions › Icons shows them`, '', ...Object.keys(ICONS).reduce<string[][]>((rows, n, i) => (i % 6 ? rows.at(-1)!.push(n) : rows.push([n]), rows), []).map(r => r.map(n => n.padEnd(16)).join('').trimEnd())].join('\n'))
  if (!type)
    return out(
      UI_SAMPLES.map(s => ({ type: s.type, group: s.group, blurb: s.blurb, props: props(s.type).map(p => p.name) })),
      [`Laki's UI kit: widget.json's "ui", one element or { "preview": …, "full": … }. Each element takes ${Object.keys(COMMON).join(', ')} too.`, '', ...UI_SAMPLES.map(s => `${s.group.padEnd(10)} ${s.type.padEnd(12)} ${s.blurb}`), '', 'laki widget kit <element>: its props and a sample; laki widget kit icons: every icon'].join('\n'),
    )
  const s = UI_SAMPLES.find(x => x.type === type)
  if (!s) throw new Error(`no element ${type}: ${Object.keys(UI).join(', ')}`)
  const ps = props(s.type)
  const w = Math.max(...ps.map(p => p.name.length))
  return out({ type: s.type, group: s.group, blurb: s.blurb, props: ps, sample: { ui: s.spec, data: s.data } }, [`${s.type} (${s.group}): ${s.blurb}`, ...ps.map(p => `  ${p.name.padEnd(w)}  ${p.kind.padEnd(10)}  ${p.desc}`), `  + ${Object.keys(COMMON).join(', ')}`, '', 'a sample (widget.json\'s "ui", and data its fetch might print):', JSON.stringify({ ui: s.spec, ...(s.data !== undefined && { sample: s.data }) }, null, 2)].join('\n'))
}

const glyph: Record<string, string> = { running: '◐', waiting: '◆', idle: '○', exited: '✖' }

// remote access in words: its link, who gets in, until when
// pin: false (a log, not a terminal): where to see the PIN instead
const remoteText = (r?: Remote, pin = true) =>
  !r ? 'remote access is off: laki serve, or Settings › Remote access' : !r.link ? 'remote access is starting…' :
  [r.used ? `${r.link} (opened already: a link works once; laki serve again for a new one)` : `${r.link} (it works once, in one tab)`, r.via && (r.funnel ? 'on the internet (Tailscale Funnel)' : `your tailnet's devices only${r.peers === 0 ? ": none online but this machine, which can't open its own link" : ''}`), r.pin ? (pin ? `PIN ${r.pin} (${r.tries} wrong tries stop it)` : 'PIN: see Settings › Remote access, or laki remote') : !r.via && (r.mail ? `only ${r.mail} (Cloudflare's code)` : 'anyone with the link'), r.until ? `until ${new Date(r.until).toLocaleString()}` : 'until stopped'].filter(Boolean).join('\n')

// laki serve: headless, a server without the app (Linux too, or the AppImage's --headless): the daemon in this process
// (or the one running), with remote access through tailscale or cloudflared for the browser, until stopped (Ctrl-C,
// SIGTERM: systemd, laki stop). Remote access ending (its hours, cloudflared or tailscale gone) stops it too, so a
// service manager (Restart=always) starts it again: a new link, laki remote prints it
async function serve(a: string[]) {
  const has = (f: string) => a.includes(`--${f}`)
  const val = (f: string) => (i => (i >= 0 ? a[i + 1] : undefined))(a.indexOf(`--${f}`))
  const via = has('tailscale') ? 'tailscale' : 'cloudflare'
  const o = { via, hours: Number(val('hours') ?? 0), pin: has('pin') || has('funnel'), mail: val('mail'), open: has('open'), funnel: has('funnel') } // funnel: the internet, so a PIN always
  if (via === 'cloudflare' && !o.pin && !o.mail && !o.open) throw new Error('how do you get in? laki serve --tailscale [--pin | --funnel] | --cloudflare --mail you@example.com | --cloudflare --pin  [--hours n]')
  if (via === 'cloudflare' && o.open && !o.pin && !o.mail && !val('hours')) throw new Error('--open lets in anyone with the link: give it --hours (24 at most)')
  // started by Laki --headless, which waits on this process (not passed on to the daemon's agents)
  const parent = Number(process.env.LAKI_HEADLESS_PARENT)
  delete process.env.LAKI_HEADLESS_PARENT
  const running = await alive()
  if (!running) {
    await import(pathToFileURL(daemonScript()).href) // the daemon: in this process, so Ctrl-C or a service manager stops both
    for (let i = 0; i < 100 && !(await alive()); i++) await new Promise(r => setTimeout(r, 100))
  }
  let r: Remote | undefined
  try {
    r = await rpc('remoteStart', o, 90000)
  } catch (e) {
    if (!running) await rpc('shutdown').catch(() => {})
    throw e
  }
  console.log(`laki: remote access\n${remoteText(r, !!process.stdout.isTTY)}`) // a service's log: no PIN in it
  if (running) return console.log('(in the daemon already running here: laki remote shows it again)')
  const stop = (why: string) => {
    clearInterval(watch)
    clearInterval(orphan)
    console.log(`laki: ${why}: stopping`)
    void rpc('shutdown').catch(() => {})
    setTimeout(() => process.exit(0), 3000) // the daemon's shutdown exits first
  }
  const watch = setInterval(async () => {
    const v = await rpc<View>('state').catch(() => undefined)
    if (v && !v.remote) stop(`remote access ended${o.hours ? ` (its ${o.hours} hours)` : ''}`)
  }, 15000)
  // Laki --headless killed (kill, docker stop): this goes too, and remote access with it
  const orphan = setInterval(() => parent && process.ppid !== parent && stop('Laki --headless ended'), 2000)
}

// laki, laki help [command [sub]], --help or -h first or after a command (laki new --help, laki widget new -h): no
// daemon started for it. After --, words are text: laki send ws -- --help sends it
const textFrom = argv.indexOf('--')
const asks = (a?: string) => (a === '--help' || a === '-h') && (textFrom < 0 || argv.indexOf(a) < textFrom)
function help(cmd: string | undefined, rest: string[]): boolean {
  const topic = cmd === undefined ? [] : asks(cmd) || cmd === 'help' ? rest.filter(a => !asks(a)) : asks(rest[0]) ? [cmd] : asks(rest[1]) ? [cmd, rest[0]] : null
  if (!topic) return false
  const text = topic.length ? helpFor(topic[0], topic[1]) : USAGE
  if (text === null) throw new Error(`no command ${topic[0]}: laki help lists them`)
  console.log(text)
  return true
}

async function main() {
  const [cmd, ...rest] = args
  if (cmd !== 'hook' && help(cmd, rest)) return
  switch (cmd) {
    case 'hook':
      return hook(rest[0], rest[1])
    case 'daemon':
      return import(pathToFileURL(daemonScript()).href)
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
    case 'serve':
      return serve(rest)
    case 'remote': {
      // laki remote [stop]: remote access's link (and PIN) now, as Settings shows it; a headless server's way to it
      if (rest[0] === 'stop') return rpc('remoteStop').then(() => out({ ok: true }, 'stopped'))
      const r: Remote | undefined = (await rpc<View>('state')).remote
      return out(r ?? null, remoteText(r))
    }
    case 'mcp':
      return mcp() // starts the daemon at its first tool call: stdout is the protocol's
  }
  if (['flow', 'flows', 'workflow'].includes(cmd) && rest[0] === 'check') return flowCheck(rest.slice(1))
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
        return out(p, `added ${arg ?? p.path}`) // none: the folder it runs in
      }
      if (sub === 'rm') return out(await rpc('projectRm', { id: arg }), `removed ${arg}`)
      const { projects } = await state()
      return out(projects, projects.map(p => `${p.id}  ${p.host ? `${p.host}:` : ''}${p.path}`).join('\n'))
    }
    case 'new': {
      if (!rest[0]) throw new Error('usage: laki new <project> [--base b] [--preset p] [--model m] [--effort e] [--issue url|n] [--pr url|n] [--link url|n] [--fan claude,codex] [--prompt text]')
      // .: the project of the workspace this tab is in (an agent's /laki:new)
      const v = process.env.LAKI_WORKSPACE ? ((await rpc('state')) as View) : undefined
      const here = rest[0] === '.' && v?.workspaces.find(w => w.id === process.env.LAKI_WORKSPACE)?.project
      if (rest[0] === '.' && !here) throw new Error("laki new .: only in a Laki tab ($LAKI_WORKSPACE): name the project")
      const o = {
        project: here || rest[0],
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
        link: flags.link || undefined, // the PR it's about (a review), not checked out: its primary
        caller: { ws: process.env.LAKI_WORKSPACE, tab: process.env.LAKI_TAB }, // an agent's (its tab, or typed in a shell: the daemon's agentCaller): the prompt's PRs are only related; yours in a shell aren't
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
    case 'memory': {
      // a project's memory: laki memory [ls] [<project>|.] | add <project>|. <text…> [--mine] | rm <project>|. <id>
      // `.` is the tab's own project; add is an agent's (auto-memory) unless --mine
      const [a, b, ...words] = rest
      const sub = ['ls', 'add', 'rm'].includes(a) ? a : 'ls'
      const ref = sub === 'ls' && a !== 'ls' ? a : b
      const v: View = await rpc('state')
      const project = !ref || ref === '.' ? v.workspaces.find(w => w.id === process.env.LAKI_WORKSPACE)?.project : ref
      if (!project) throw new Error(ref === '.' ? `laki memory ${sub} .: only in a Laki tab ($LAKI_WORKSPACE): name the project` : `which project? laki memory ${sub === 'ls' ? '' : `${sub} `}<project>…`)
      if (sub === 'add') {
        const text = words.join(' ')
        if (!text.trim()) throw new Error('usage: laki memory add <project>|. "<what to remember>" [--mine]')
        const m = await rpc('memoryAdd', { project, text, auto: !flags.mine, tab: process.env.LAKI_TAB })
        return out(m, `remembered (${m.id})`)
      }
      if (sub === 'rm') {
        if (!words[0]) throw new Error('usage: laki memory rm <project>|. <id>')
        return out(await rpc('memoryRm', { project, id: words[0] }), `forgot ${words[0]}`)
      }
      const p = v.projects.find(x => x.id === project || x.name === project)
      if (!p) throw new Error(`no project ${project}`)
      const mem = p.memory ?? []
      const line = (m: Memory) => `${m.id}  ${new Date(m.at).toISOString().slice(0, 10)}  ${m.text.replace(/\s*\n\s*/g, ' ')}`
      return out(mem, [`${p.name}: yours`, ...mem.filter(m => !m.auto).map(line), '', 'learned by agents', ...mem.filter(m => m.auto).map(line)].join('\n'))
    }
    case 'remind':
    case 'reminders': {
      // the calendar's follow-ups: laki remind <when> <text…> [--ws <id>|.] | laki reminders [rm|done <id>]
      if (cmd === 'reminders') {
        const [sub, id] = rest
        if (sub === 'rm' || sub === 'done') {
          if (!id) throw new Error(`usage: laki reminders ${sub} <id>`)
          return out(sub === 'rm' ? await rpc('reminderRm', { id }) : await rpc('reminderSet', { id, done: true }), sub === 'rm' ? `removed ${id}` : `done ${id}`)
        }
        const v: View = await rpc('state')
        if (!v.reminders) throw new Error('Calendar is off: Settings › General › Experimental')
        return out(v.reminders, v.reminders.map(r => `${r.id}  ${new Date(r.at).toLocaleString()}  ${r.done ? '✓ ' : ''}${r.text.replace(/\s*\n\s*/g, ' ')}`).join('\n') || 'no reminders')
      }
      const [when, ...words] = rest
      if (!when || !words.length) throw new Error('usage: laki remind "<when: in 2h, tomorrow at 9am, 2026-10-20 14:30>" <text…> [--ws <id>|.]')
      if (flags.ws === '.' && !process.env.LAKI_WORKSPACE) throw new Error('--ws .: only in a workspace\'s tab (or give its id)')
      const ws = flags.ws === '.' ? process.env.LAKI_WORKSPACE : (flags.ws as string | undefined)
      const r = await rpc('reminderAdd', { at: when, text: words.join(' '), ws, tab: process.env.LAKI_TAB, ...(!process.env.LAKI_TAB && { by: 'the CLI' }) })
      return out(r, `reminder ${r.id} at ${new Date(r.at).toLocaleString()}`)
    }
    case 'rename':
    case 'pr': {
      // laki rename <ws|.> <name> | laki pr <ws|.> <url|number>: `.` is the tab's own workspace ($LAKI_WORKSPACE)
      const [ref, ...words] = rest
      const ws = ref === '.' ? process.env.LAKI_WORKSPACE : ref
      if (ref === '.' && !ws) throw new Error(`laki ${cmd} .: only in a Laki tab ($LAKI_WORKSPACE): name the workspace`)
      if (!ws || !words.length) throw new Error(cmd === 'rename' ? 'usage: laki rename <ws|.> <name>' : 'usage: laki pr <ws|.> <url|number>')
      if (cmd === 'rename') await rpc('wsSet', { id: ws, name: words.join(' ') })
      else await rpc('prAttach', { ws, pr: words[0] }, 60000)
      return out({ ok: true }, cmd === 'rename' ? `renamed ${ws}` : `attached ${words[0]} to ${ws}`)
    }
    case 'tab': {
      const t = await rpc('tabNew', { ws: rest[0], preset: flags.preset, cmd: flags.cmd, caller: caller() })
      return out(t, `${t.name} (${t.id})`)
    }
    case 'send': {
      const [target, ...words] = rest
      const r = await rpc('send', { target, text: words.join(' '), whenIdle: !!flags['when-idle'] }, 150000) // another workspace's from an agent: the user is asked first
      return out(r, r.sent ? 'sent' : `queued (${r.queued} waiting): sent when the agent finishes its turn`)
    }
    case 'progress': {
      // laki progress <0-100> [what you're on]: an agent's estimate, on its tab (LAKI_TAB) until its turn ends
      if (!rest[0]) throw new Error('usage: laki progress <0-100> [what you are on]')
      const r = await rpc('progress', { tab: flags.tab || process.env.LAKI_TAB, pct: String(rest[0]).replace(/%$/, ''), note: rest.slice(1).join(' ') || undefined })
      return out(r, `${r.pct}%`) // as the tab shows it: 0 to 100, whole
    }
    case 'screen': {
      // laki screen shot [app] | windows | tap <x> <y> | swipe <x1> <y1> <x2> <y2> | type <text> | describe: the iOS
      // Simulator and apps' windows (daemon/device.ts); anything else is a tab's screen. ponytail: a workspace named
      // as an op needs its id
      const [op, ...more] = rest
      if ((DEVICE_OPS as readonly string[]).includes(op)) {
        const [x, y, x2, y2] = more
        const r = await rpc('device', op === 'shot' ? { op, app: more.join(' ') } : op === 'type' ? { op, text: more.join(' ') } : { op, x, y, x2, y2 }, 45000)
        const text = op === 'shot' ? r.path : op === 'windows' ? (r as { id: number; app: string; title: string }[]).map(w => `${w.app}${w.title ? `  ${w.title}` : ''}`).join('\n') : op === 'describe' ? JSON.stringify(r, null, 2) : 'ok'
        return out(r, text)
      }
      const text = await rpc('screen', { target: rest[0], lines: Number(flags.lines) || 30 }, 150000)
      return out(text, text)
    }
    case 'diff': {
      const d = await rpc('diff', { ws: rest[0] })
      return out(d, d.diff)
    }
    case 'run': {
      const t = await rpc('run', { ws: rest[0], script: rest[1] })
      return out(t, `started ${t.name} (${t.id})`)
    }
    case 'ship': {
      // --force: past the extensions' gates; yours only (the daemon refuses it from an agent's tab)
      const t = await rpc('ship', { ws: rest[0], message: flags.m || flags.message, force: !!flags.force, from: caller() })
      if (t.held) {
        out(t, ['Not shipped:', ...t.held.map((h: GateHeld) => `  ${h.name}: ${h.why}${h.fix ? `\n    fix: ${h.fix.split('\n')[0]}` : ''}`), 'laki ship --force does it anyway (you, not an agent)'].join('\n'))
        process.exit(1)
      }
      return out(t, `shipping in tab ${t.name} (${t.id})`)
    }
    case 'schedule': {
      const [sub = 'ls', id, ...words] = rest
      const at = (t?: number) => (t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
      const line = (s: Schedule) => `${s.id}  ${s.on ? 'on ' : 'off'}  ${describe(s.rule)}${s.next ? `, next ${at(s.next)}` : ''}  ${s.project} · ${s.widget ? `extension ${s.widget}: ${s.action ?? 'fetch'}` : s.workflow ? `workflow ${s.workflow}` : `${s.preset} · ${({ local: 'folder', 'local-new': 'folder-new' } as Record<string, string>)[s.ws] ?? s.ws}`}  ${s.name || s.prompt}`
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
    case 'flow':
    case 'flows':
    case 'workflow': {
      // workflows (experimental): laki flow [ls] | run <workflow> [project] <task…> [--ws <ws|.>] [--dry] [--set name=value…] | again <run> [--from <block>] | show|stop <run> | answer <run> <n> [words]
      const [sub = 'ls', id, ...words] = rest
      const status = (r: FlowView | FlowRun) => `${r.status}${!FLOW_ENDED.includes(r.status) && r.cur ? ` at ${r.cur}` : ''}`
      if (sub === 'ls') {
        const list: WorkflowItem[] = await rpc('flowList', {})
        const runs: FlowView[] = (await rpc('state')).flows ?? []
        return out({ workflows: list.map(({ text, blocks, ...w }) => w), runs }, [
          ...list.map(w => `${w.id}  ${w.source === 'project' ? `${w.project}'s` : w.source}  ${w.name}${w.problems.length ? `  ⚠ ${w.problems[0]}` : ''}`),
          ...(runs.length ? ['', ...runs.map(r => `${r.id}  ${status(r)}  ${r.name}: ${r.task}`)] : []),
        ].join('\n'))
      }
      if (sub === 'run') {
        // --ws: a workspace you have (`.`: this tab's), its project unless one is named first
        const ws = flags.ws === '.' ? process.env.LAKI_WORKSPACE : typeof flags.ws === 'string' ? flags.ws : undefined
        if (flags.ws === '.' && !ws) throw new Error("--ws .: only in a Laki tab ($LAKI_WORKSPACE): name the workspace")
        const named = !ws || ((await rpc('state')) as View).projects.some(p => p.id === words[0] || p.name === words[0])
        const [project, ...task] = named ? words : [undefined, ...words]
        if (!id || (!project && !ws)) throw new Error('usage: laki flow run <workflow> [project] <task…> [--ws <ws|.>] [--dry] [--set name=value…]')
        const inputs = Object.fromEntries(sets.map(x => (x.includes('=') ? [x.slice(0, x.indexOf('=')).trim(), x.slice(x.indexOf('=') + 1)] : [x.trim(), ''])))
        const r: FlowRun = await rpc('flowStart', { workflow: id, project, ws, task: task.join(' '), dry: !!flags.dry, ...(sets.length && { inputs }), caller: caller() }, 180000)
        return out(r, `${r.id}  ${status(r)}${r.ws ? `  in ${r.ws}` : ''}`)
      }
      if (sub === 'trash') {
        const list: { trash: string; id: string; name: string; path: string; at: number }[] = await rpc('flowTrash')
        return out(list, list.map(x => `${x.trash}  ${x.name}  ${new Date(x.at).toLocaleString()}  ${x.path}`).join('\n') || 'the trash is empty')
      }
      if (sub === 'restore') {
        if (!id) throw new Error('usage: laki flow restore <trash-id> (laki flow trash lists them)')
        const w: WorkflowItem = await rpc('flowRestore', { trash: id })
        return out(w, `restored ${w.id}${w.path ? ` in ${w.path}` : ''}`)
      }
      if (sub === 'again') {
        // an ended run again (its task and inputs, the workflow as it is now), or --from a block: in its workspace, its state kept
        if (!id) throw new Error('usage: laki flow again <run> [--from <block>]')
        const r: FlowRun = await rpc('flowStart', { ...(typeof flags.from === 'string' ? { from: { run: id, block: flags.from } } : { again: id }), caller: caller() }, 180000)
        return out(r, `${r.id}  ${status(r)}${r.ws ? `  in ${r.ws}` : ''}`)
      }
      if (sub === 'show') {
        const r: FlowRun = await rpc('flowGet', { id })
        const ask = r.wait && 'options' in r.wait ? [`asks: ${r.wait.question}`, ...r.wait.options.map((o, n) => `  ${n}. ${o}`)] : []
        return out(r, [`${r.flow.name}: ${r.task}  ${status(r)}`, ...ask, '', ...r.decisions.map(d => `${blockName(r.flow.blocks.find(b => b.id === d.block) ?? { id: d.block, kind: 'agent' })} → ${d.exit}: ${d.why}`)].join('\n'))
      }
      if (sub === 'answer') return out(await rpc('flowAnswer', { id, n: Number(words[0]), text: words.slice(1).join(' ') }), 'answered')
      if (sub === 'stop') return out(await rpc('flowStop', { id }), `stopped ${id}`)
      throw new Error('usage: laki flow [ls] | run <workflow> [project] <task…> [--ws <ws|.>] [--dry] [--set name=value…] | again <run> [--from <block>] | check [file.md… | folder] | trash | restore <trash-id> | show|stop <run> | answer <run> <n> [words]')
    }
    case 'widget':
    case 'widgets': {
      const [sub = 'ls', id, action, ...arg] = rest
      const ws = typeof flags.ws === 'string' ? flags.ws : undefined // a per-workspace one's instance
      if (sub === 'ls') {
        const list: WidgetView[] = (await rpc('state')).widgets ?? []
        const line = (w: WidgetView) => `${w.id}  ${w.on ? 'on ' : 'off'}  ${w.size.join('×')}  ${w.every ? `every ${w.every}m` : 'no fetch'}${w.scope ? '  per workspace' : ''}${w.project ? `  from ${w.project}${w.changed ? ' (changed: off until you look)' : ''}` : ''}  ${w.error ? `✗ ${w.error}` : w.at ? '✓' : ''}  ${w.dir}`
        return out(list, list.map(line).join('\n') || 'no widgets')
      }
      if (sub === 'reload') return out(await rpc('widgetReload'), 'reloaded')
      if (sub === 'kit') return kit(id)
      if (sub === 'dev') return dev(id)
      if (sub === 'new') {
        const name = rest.slice(1).join(' ')
        if (!name) throw new Error(`usage: laki widget new <name> [--kind ${STARTER_KINDS.join('|')}] [--dir <folder>]`)
        const r: { id: string; dir: string; found: boolean; repo?: boolean } = await rpc('widgetNew', { name, kind: typeof flags.kind === 'string' ? flags.kind : undefined, dir: typeof flags.dir === 'string' ? resolve(flags.dir) : undefined }, 130000)
        return out(r, [`made ${r.id} in ${r.dir}${r.repo ? `: the repo's, off until you look (laki widget what ${r.id})` : r.found ? ': on, in Settings › Extensions' : ''}`, 'next:', `  laki widget dev ${r.dir}   reloads it as you save, prints each fetch`, `  laki widget check ${r.found ? r.id : r.dir}   says what's wrong with it`].join('\n'))
      }
      if (sub === 'check') {
        const at = id === undefined ? resolve('.') : existsSync(id) ? resolve(id) : undefined
        const r: { id?: string; problems: UiProblem[] } = await rpc('widgetCheck', { ...(at ? { dir: at } : { id }), run: !flags['no-run'], ws, from: caller() }, 130000)
        const bad = r.problems.some(p => p.level === 'error')
        out(r, r.problems.map(p => `${{ ok: '✓', warn: '!', error: '✗' }[p.level]} ${p.where}: ${p.text}`).join('\n') || 'nothing to check')
        if (bad) process.exitCode = 1
        return
      }
      // what turning it on runs, and its files' hash: laki widget on <id> --seen <hash> holds only for those files
      if (sub === 'what') {
        const r: { name: string; on: boolean; text: string; hash: string } = await rpc('widgetWhat', { id })
        return out(r, `${r.name} (${r.on ? 'on' : 'off'})\n\n${r.text}\n\nlaki widget on ${id} --seen ${r.hash}`)
      }
      if (sub === 'on' || sub === 'off') return out(await rpc('widgetSet', { id, on: sub === 'on', ...(sub === 'on' && typeof flags.seen === 'string' && { seen: flags.seen }), from: caller() }), `${id} ${sub}`)
      if (sub === 'set') {
        // where it shows, its size, every, view, what it hides and its settings (key=value): an agent's too, never on
        if (!id) throw new Error('usage: laki widget set <id> [--place desk,side] [--size 2x1] [--every 5] [--view s|m|l] [--hide refresh,at|none] [key=value …]')
        const kv = [action, ...arg].filter(x => x !== undefined)
        const bad = kv.find(x => !/^[\w-]+=/.test(x))
        if (bad) throw new Error(`a setting as key=value, not ${bad}`)
        const size = typeof flags.size === 'string' ? cellsOf(flags.size) : undefined
        if (flags.size !== undefined && !size) throw new Error(`a size: across x down, e.g. 2x1 (not ${flags.size})`)
        if (flags.view !== undefined && !['s', 'm', 'l'].includes(String(flags.view))) throw new Error(`--view: s, m or l (not ${flags.view})`)
        const every = flags.every === undefined ? undefined : Number(flags.every)
        if (every !== undefined && !(every > 0)) throw new Error(`--every: minutes (not ${flags.every})`)
        const hide = typeof flags.hide === 'string' ? flags.hide.split(',').map(x => x.trim()) : undefined
        const r: WidgetView = await rpc('widgetSet', {
          id,
          place: typeof flags.place === 'string' ? flags.place.split(',').map(x => x.trim()).filter(Boolean) : undefined, // '': its own again
          size,
          every,
          view: typeof flags.view === 'string' ? flags.view : undefined,
          hide: hide && { refresh: hide.includes('refresh'), at: hide.includes('at') },
          config: kv.length ? Object.fromEntries(kv.map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)])) : undefined,
          from: caller(),
        })
        return out(r, `${id}: ${placesOf(r).join(', ')} · ${r.size.join('×')}${r.every ? ` · every ${r.every}m` : ''}${r.on ? '' : ' · off (only you turn it on)'}`)
      }
      if (sub === 'tools') {
        // what agents may call: each extension's actions with a tool, and its AGENTS.md
        type T = { tool: string; name: string; description: string; ask: string; scope?: string; agents?: string; input: { properties: Record<string, { type: string; enum?: unknown[]; description?: string }>; required: string[] } }
        const list: T[] = await rpc('widgetTools', { ws: process.env.LAKI_WORKSPACE })
        const field = (t: T, k: string, f: T['input']['properties'][string]) => `  ${k}: ${f.type === 'array' ? 'string[]' : f.type}${f.enum ? ` (${f.enum.join('|')})` : ''}${t.input.required.includes(k) ? ', required' : ''}${f.description ? ` · ${f.description}` : ''}`
        return out(list, list.map(t => [`${t.tool}  ${t.description}  (${t.name}${t.scope ? ', per workspace' : ''}, asks ${t.ask === 'always' ? 'every time' : t.ask})`, ...Object.entries(t.input.properties).map(([k, f]) => field(t, k, f)), ...(t.agents ? t.agents.split('\n').map(l => `  │ ${l}`) : [])].join('\n')).join('\n\n') || 'no tools: an extension that is on with an action that has a "tool"')
      }
      if (sub === 'tool') {
        // one tool, from this tab's workspace ($LAKI_WORKSPACE, $LAKI_TAB): the user may be asked first
        if (!id || !action) throw new Error("usage: laki widget tool <id> <action> [json input] [--ws <workspace>]")
        let input: unknown = {}
        try {
          if (arg.length) input = JSON.parse(arg.join(' '))
        } catch {
          throw new Error(`not JSON: ${arg.join(' ').slice(0, 80)}`)
        }
        const r: { ok: boolean; output: string; error?: string } = await rpc('widgetToolCall', { id, action, input, from: { ws: ws ?? process.env.LAKI_WORKSPACE, tab: process.env.LAKI_TAB } }, 300000)
        if (json) return out(r)
        process.stdout.write(r.output)
        if (!r.ok) (console.error(`✗ ${r.error}`), (process.exitCode = 1))
        return
      }
      // a line in its log from a hook or a cron job: never fails a script (its log off: nothing written, exit 0)
      if (sub === 'log') {
        const text = [action, ...arg].filter(x => x !== undefined).join(' ')
        if (!id || !text.trim()) throw new Error('usage: laki widget log <id> [--level debug|info|warn|error] [--ws <workspace>] <text…>')
        try {
          const r: { kept: boolean; note?: string } = await rpc('widgetLog', { id, text, level: typeof flags.level === 'string' ? flags.level : undefined, ws })
          if (r.note) console.error(r.note)
          return json ? out(r) : undefined
        } catch (e) {
          return void console.error(`laki widget log: ${(e as Error).message}`)
        }
      }
      // its log: the last -n lines (100), -f following it as lines come
      if (sub === 'logs') {
        if (!id) throw new Error('usage: laki widget logs <id> [-n 100] [-f] [--level error] [--ws <workspace>] [--json]')
        type R = { on: boolean; lines: WidgetLogLine[]; next: number; file: string }
        const q = { id, level: typeof flags.level === 'string' ? flags.level : undefined, ws }
        const show = (l: WidgetLogLine) => console.log(json ? JSON.stringify(l) : `${new Date(l.at).toLocaleTimeString([], { hour12: false })} ${l.level.padEnd(5)} ${l.src}${l.ws ? ` (${l.ws})` : ''}  ${l.text}`)
        let r: R = await rpc('widgetLogs', { ...q, limit: Math.max(1, Number(flags.n) || 100) })
        if (!r.lines.length && !flags.f) console.error(r.on ? 'nothing logged yet' : `no log: it's off (Settings › Extensions › ${id} › Keep a log)`)
        r.lines.forEach(show)
        while (flags.f) {
          await new Promise(f => setTimeout(f, 1000))
          const since = r.next
          r = await rpc('widgetLogs', { ...q, since })
          if (r.next < since) r = await rpc('widgetLogs', { ...q, since: 0 }) // cleared and begun again
          r.lines.forEach(show)
        }
        return
      }
      if (sub === 'emit') {
        // an event of your own: custom.<name>, its data as an argument or on stdin (-); from an extension's command, its
        // LAKI_WIDGET and the event it handles (LAKI_EVENT_HOPS: a loop stops)
        if (!id) throw new Error('usage: laki widget emit <name> [json | -] [--ws <workspace>]')
        const text = action === '-' ? await new Promise<string>(r => {
          let s = ''
          process.stdin.on('data', d => (s += d)).on('end', () => r(s)).on('error', () => r(s))
        }) : [action, ...arg].filter(x => x !== undefined).join(' ')
        let data: unknown
        try {
          data = text.trim() ? JSON.parse(text) : undefined
        } catch {
          throw new Error(`not JSON: ${text.trim().slice(0, 80)}`)
        }
        const r = await rpc('widgetEmit', { name: id, data, ws: ws ?? process.env.LAKI_WORKSPACE, from: { ...caller(), widget: process.env.LAKI_WIDGET }, hops: process.env.LAKI_EVENT_HOPS, agent: process.env.LAKI_EVENT_AGENT })
        return out(r, r.ok ? `${r.event}: ${[...r.widgets, ...r.flows.map((f: string) => `workflow ${f}`)].join(', ') || 'nothing answers it'}` : `✗ ${r.dropped}`)
      }
      if (sub === 'events') {
        const r = (await rpc('widgetEvents', {})) as EventSent[]
        const line = (e: EventSent) => [new Date(e.at).toLocaleTimeString(), e.event, e.ws && `ws ${e.ws}`, e.from?.widget && `from ${e.from.widget}`, e.from?.agent && `by ${e.from.agent}`, e.hops && `${e.hops} hops`, `→ ${[...e.widgets, ...e.flows.map(f => `workflow ${f}`)].join(', ') || 'nothing'}`, ...(e.refused ?? []).map(x => `✗ ${x}`)].filter(Boolean).join('  ')
        return out(r, r.map(line).join('\n') || 'no events yet')
      }
      if (sub === 'push') {
        // its data from a cron job, a git hook, CI: JSON as an argument, or on stdin (- or none)
        if (!id) throw new Error('usage: laki widget push <id> [json | -] [--ws <workspace>] [--merge]')
        const text = action === undefined || action === '-' ? await new Promise<string>(r => {
          let s = ''
          process.stdin.on('data', d => (s += d)).on('end', () => r(s)).on('error', () => r(s))
        }) : [action, ...arg].join(' ')
        let data: unknown
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error(`not JSON: ${text.trim().slice(0, 80) || '(nothing)'}`)
        }
        return out(await rpc('widgetPush', { id, data, ws, merge: !!flags.merge }), `pushed to ${id}${ws ? ` (${ws})` : ''}`)
      }
      if (sub === 'run') {
        const r = await rpc('widgetRun', { id, ws, from: caller() }, 130000)
        return out(r, r.ok ? 'fetched' : `✗ ${r.error}`)
      }
      if (sub === 'render') {
        const html: string | null = await rpc('widgetRender', { id, full: !!flags.full, ws })
        return out(html, html ?? `${id} has no ${flags.full ? 'full' : 'preview'} view`)
      }
      if (sub === 'trash') {
        const list: { trash: string; id: string; name: string; from: string; at: number }[] = await rpc('widgetTrash')
        return out(list, list.map(x => `${x.trash}  ${x.name}  ${new Date(x.at).toLocaleString()}  ${x.from}`).join('\n') || 'the trash is empty')
      }
      if (sub === 'restore') {
        if (!id) throw new Error('usage: laki widget restore <trash-id> (laki widget trash lists them)')
        const w: WidgetView = await rpc('widgetRestore', { trash: id })
        return out(w, `restored ${w.id}${w.dir ? ` in ${w.dir}` : ''}${w.on ? ', on' : ''}`)
      }
      if (sub === 'remix') {
        if (!id) throw new Error('usage: laki widget remix <id> [new-id]')
        const r: { id: string } = await rpc('widgetRemix', { id, newId: action || undefined })
        return out(r, `made ${r.id}, a copy of ${id}: yours, off (laki widget on ${r.id})`)
      }
      if (sub === 'action') {
        const r = await rpc('widgetAction', { id, action, arg: arg.join(' '), ws, from: caller() }, 300000) // an agent's: you may be asked first
        return out(r, r.ok ? r.out || [r.toast, r.modal?.title, r.modal?.text].filter(Boolean).join('\n') || 'done' : `✗ ${r.error}`) // what the app would show
      }
      throw new Error('usage: laki widget [ls] | reload | what <id> | on <id> [--seen <hash>] | off|run <id> | logs <id> [-n 100] [-f] [--level l] | log <id> [--level l] <text> | render <id> [--full] | action <id> <action> [arg] [--ws <workspace>] | kit [element] | dev [folder] [--off <id|folder>] [--list] | new <name> [--kind <k>] [--dir <folder>] | check [id|folder] [--no-run] [--ws <workspace>] | push <id> [json | -] [--ws <workspace>] [--merge] | tools | tool <id> <action> [json] | remix <id> [new-id] | trash | restore <trash-id>')
    }
    case 'ai': {
      const [sub] = rest
      const money = (n?: number) => (n === undefined ? '' : `$${n.toFixed(4)}`)
      if (sub === 'new') return out(await rpc('aiNew'), 'a new conversation')
      if ((!rest.length && !flags.image) || sub === 'log') {
        const a: { chat: AiMsg[]; calls: AiCall[]; totals: AiTotals } = await rpc('aiState')
        if (!rest.length) return out(a.chat, a.chat.map(m => `${{ user: '>', ai: '', tool: '  ·', error: '  ✗' }[m.role]} ${m.text}`.trim()).join('\n') || 'no conversation yet: laki ai <ask>')
        const t = (k: 'today' | 'month') => `${k}: ${a.totals[k].calls} calls, ${a.totals[k].in} in / ${a.totals[k].out} out, ${money(a.totals[k].cost)}`
        return out(a, [t('today'), t('month'), ...a.calls.map(c => `${new Date(c.at).toLocaleString()}  ${c.ok ? '✓' : '✗'}  ${c.backend} ${c.model}  ${c.in}/${c.out}  ${money(c.cost)}  ${(c.ms / 1000).toFixed(1)}s  ${c.ask}`)].join('\n'))
      }
      // an image goes through the daemon's images folder: the only one the AI may send to a model
      const img = typeof flags.image === 'string' ? [await rpc('imageSave', { data: readFileSync(flags.image).toString('base64'), ext: extname(flags.image).slice(1).toLowerCase() })] : []
      const r = await rpc('aiAsk', { text: rest.join(' '), images: img }, 600000)
      return out(r, r.text)
    }
    default:
      throw new Error(`unknown command ${cmd}\n\n${USAGE}`)
  }
}

main().catch(e => {
  console.error(`laki: ${e.message}`)
  process.exit(1)
})
