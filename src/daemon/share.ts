// A shared tab (core.ts' shareStart, the app's Share live view): a view-only page anyone with its link opens, kept up to date. Here: what it
// shows, as Markdown (Copy, Download) and as the page. An agent's chat from its transcript (claude's, codex's): your
// prompts, its answers, its tool calls a line each; anything else (a shell, gemini…): the terminal's text.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { markdownHtml } from '../shared/markdown.ts'

export type Said = { who: 'you' | 'agent' | 'tool' | 'screen'; text: string }

// claude's: <its config>/projects/<the folder's>/<session>.jsonl; codex's: <its home>/sessions/y/m/d/rollout-…-<thread>.jsonl
export function transcriptOf(agent: string, dir: string, id: string): string | undefined {
  if (!/^[\w-]+$/.test(id)) return // an id, never a path
  try {
    if (agent === 'claude') return readdirSync(join(dir, 'projects')).map(d => join(dir, 'projects', d, `${id}.jsonl`)).find(f => existsSync(f))
    if (agent === 'codex') {
      const f = (readdirSync(join(dir, 'sessions'), { recursive: true }) as string[]).find(f => f.endsWith(`-${id}.jsonl`))
      return f && join(dir, 'sessions', f)
    }
  } catch {}
}

// what the agent adds to a prompt (context, a slash command's output), not what you typed
const NOISE = /^\s*(<(command-|local-command|system-reminder|environment_context|user_instructions|permissions|turn_aborted|user_memory)|# AGENTS\.md instructions)/
const args = (a: unknown) => {
  if (typeof a !== 'string') return a
  try {
    return JSON.parse(a)
  } catch {
    return a
  }
}
// a tool call in a line: its name and what it ran or read
function toolLine(name: string, input: unknown) {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const patch = typeof input === 'string' && [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(m => m[1]) // codex's apply_patch
  const what = patch && patch.length ? patch.join(', ') : (i.command ?? i.cmd ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? (typeof input === 'string' ? input : ''))
  const s = (Array.isArray(what) ? what.join(' ') : String(what)).replace(/\s+/g, ' ').trim()
  return `${name}${s ? `: ${s.length > 160 ? `${s.slice(0, 159)}…` : s}` : ''}`
}

// a transcript (JSON lines) as what was said, in order, onto out (what its earlier lines said); an agent's answers
// and tool calls in a row are one each
export function chatOf(agent: string, jsonl: string, out: Said[] = []): Said[] {
  const add = (who: Said['who'], t: unknown) => {
    const text = String(t ?? '').trim()
    if (!text || (who === 'you' && NOISE.test(text))) return
    const last = out.at(-1)
    if (last && last.who === who && who !== 'you') last.text += (who === 'tool' ? '\n' : '\n\n') + text
    else out.push({ who, text })
  }
  for (const line of jsonl.split('\n')) {
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (agent === 'claude') {
      if (j.isSidechain || j.isMeta) continue // a subagent's, or what Laki or a command added
      const c = j.message?.content
      const parts: any[] = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []
      for (const x of parts) {
        if (j.type === 'user' && x.type === 'text') add('you', x.text)
        else if (j.type === 'user' && x.type === 'image') add('you', '[an image]')
        else if (j.type === 'assistant' && x.type === 'text') add('agent', x.text)
        else if (j.type === 'assistant' && x.type === 'tool_use') add('tool', toolLine(x.name, x.input))
      }
    } else {
      // ponytail: codex's event messages (what its own UI shows); a codex too old to write them shows tool calls only
      const p = j.payload
      if (j.type === 'event_msg' && p?.type === 'user_message') add('you', p.message)
      else if (j.type === 'event_msg' && p?.type === 'agent_message') add('agent', p.message)
      else if (j.type === 'response_item' && ['function_call', 'custom_tool_call', 'local_shell_call'].includes(p?.type)) add('tool', toolLine(p.name ?? 'shell', args(p.arguments ?? p.input ?? p.action)))
    }
  }
  return out
}

const fence = (t: string) => (f => `${f}\n${t}\n${f}`)('`'.repeat(Math.max(3, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1))))
export function shareMd(title: string, agent: string, said: Said[]) {
  const parts = [`# ${title}`]
  for (const s of said) {
    if (s.who === 'screen') parts.push(fence(s.text))
    else if (s.who === 'tool') parts.push(s.text.split('\n').map(l => `> ⚙ ${l}`).join('  \n'))
    else parts.push(`**${s.who === 'you' ? 'You' : agent}**\n\n${s.text}`)
  }
  return `${parts.join('\n\n')}\n`
}

// ---------- the page: everything escaped here (markdown.ts' tree holds no HTML); links http(s) and mailto only

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
// what was said as the page's main part (the page swaps it as it changes)
export function shareBody(agent: string, said: Said[]) {
  if (!said.length) return '<p class="empty">Nothing here yet.</p>'
  return said
    .map(s => {
      if (s.who === 'screen') return `<pre class="screen">${esc(s.text)}</pre>`
      if (s.who === 'tool') {
        const lines = s.text.split('\n').map(l => `<div>${esc(l)}</div>`).join('')
        const n = s.text.split('\n').length
        return `<details class="tools"${n <= 3 ? ' open' : ''}><summary>${n} tool call${n === 1 ? '' : 's'}</summary>${lines}</details>`
      }
      return `<section class="m ${s.who}"><div class="who">${s.who === 'you' ? 'You' : esc(agent)}</div><div class="md">${markdownHtml(s.text)}</div></section>`
    })
    .join('')
}

export function sharePage(o: { id: string; title: string; sub: string; body: string; v: number; nonce: string }) {
  const id = esc(o.id)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(o.title)} · Laki</title>
<style nonce="${o.nonce}">
:root { --bg: #f6f7fb; --panel: #fff; --line: #e4e7ef; --fg: #161a26; --muted: #687087; --accent: #4f6bed; --accent-2: #8b5cf6; --you: #eef1ff; --you-line: #d9e0ff; --code: #f2f4f9; --live: #22c55e; --shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 8px 24px -12px rgba(16, 24, 40, .12); --mono: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, Monaco, monospace; --ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color-scheme: light dark }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0d12; --panel: #13161e; --line: #232836; --fg: #e3e6ef; --muted: #8a92a6; --accent: #8ea2ff; --accent-2: #b794f6; --you: #171c2e; --you-line: #262f4d; --code: #181c26; --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 12px 32px -16px rgba(0, 0, 0, .6) } }
* { box-sizing: border-box }
html { scroll-behavior: smooth }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15.5px/1.65 var(--ui); -webkit-font-smoothing: antialiased }
header { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: saturate(1.6) blur(14px); -webkit-backdrop-filter: saturate(1.6) blur(14px); border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent) }
.bar { max-width: 820px; margin: 0 auto; padding: 12px 20px; display: flex; gap: 14px; align-items: center }
.mark { width: 30px; height: 30px; flex: none; border-radius: 9px; display: grid; place-items: center; color: #fff; font: 700 15px/1 var(--ui); background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--accent) 60%, transparent) }
.t { flex: 1; min-width: 0 }
h1 { margin: 0; font-size: 15.5px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.sub { color: var(--muted); font-size: 12.5px; display: flex; gap: 7px; align-items: center; min-width: 0 }
.sub span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.live { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px 1px 6px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: var(--live); background: color-mix(in srgb, var(--live) 12%, transparent) }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 0 color-mix(in srgb, var(--live) 60%, transparent); animation: pulse 2s infinite }
@keyframes pulse { 70% { box-shadow: 0 0 0 6px transparent } 100% { box-shadow: 0 0 0 0 transparent } }
.ended .live { color: var(--muted); background: color-mix(in srgb, var(--muted) 14%, transparent) }
.ended .dot { background: var(--muted); animation: none }
.acts { display: flex; gap: 6px; align-items: center }
button, .btn { font: inherit; font-size: 13px; font-weight: 500; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 9px; padding: 6px 12px; cursor: pointer; text-decoration: none; white-space: nowrap; transition: border-color .15s, background .15s }
button:hover, .btn:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)) }
button:focus-visible, .btn:focus-visible, .tog:focus-within { outline: 2px solid var(--accent); outline-offset: 2px }
.tog { display: inline-flex; gap: 7px; align-items: center; font-size: 13px; color: var(--muted); white-space: nowrap; cursor: pointer; border-radius: 9px; padding: 4px 6px }
.tog input { appearance: none; width: 28px; height: 16px; margin: 0; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; transition: background .15s }
.tog input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s }
.tog input:checked { background: var(--accent) }
.tog input:checked::after { transform: translateX(12px) }
main { max-width: 820px; margin: 0 auto; padding: 20px 20px 72px; display: flex; flex-direction: column; gap: 14px }
.m { padding: 14px 18px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); min-width: 0 }
.m.you { align-self: flex-end; max-width: 88%; background: var(--you); border-color: var(--you-line); box-shadow: none; border-bottom-right-radius: 6px }
.m.agent { border-bottom-left-radius: 6px }
.who { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 650; color: var(--muted); margin-bottom: 6px; text-transform: capitalize }
.m.agent .who::before { content: ''; width: 18px; height: 18px; border-radius: 6px; background: linear-gradient(135deg, var(--accent), var(--accent-2)) }
.m.you .who { justify-content: flex-end }
.md { overflow-wrap: anywhere }
.md > :first-child { margin-top: 0 } .md > :last-child { margin-bottom: 0 }
.md p { margin: .55em 0 }
.md h1, .md h2, .md h3 { font-size: 1.08em; letter-spacing: -.01em; margin: 1.1em 0 .4em }
.md ul, .md ol { padding-left: 1.4em }
a { color: var(--accent); text-underline-offset: 2px }
code { font: 13px var(--mono); background: var(--code); border-radius: 5px; padding: 1px 5px }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; overflow-x: auto; font-size: 13px; line-height: 1.5 }
pre code { background: none; padding: 0 }
pre.screen { margin: 0; font: 12.5px/1.5 var(--mono); white-space: pre-wrap; word-break: break-word; background: var(--panel); box-shadow: var(--shadow) }
blockquote { margin: 0; padding: 2px 0 2px 14px; border-left: 3px solid color-mix(in srgb, var(--accent) 40%, var(--line)); color: var(--muted) }
.tw { overflow-x: auto } table { border-collapse: collapse; font-size: 14px } th, td { border: 1px solid var(--line); padding: 6px 10px } th { background: var(--code) } .center { text-align: center } .right { text-align: right }
img { max-width: 100%; border-radius: 10px }
.tools { align-self: flex-start; max-width: 100%; color: var(--muted); font: 12.5px/1.6 var(--mono); padding: 4px 12px; border-radius: 10px; border: 1px dashed var(--line) }
.tools[open] { align-self: stretch }
.tools summary { cursor: pointer; font: 500 12.5px var(--ui); list-style: none; display: flex; align-items: center; gap: 6px }
.tools summary::-webkit-details-marker { display: none }
.tools summary::before { content: '›'; display: inline-block; transition: transform .15s; font-size: 15px }
.tools[open] summary::before { transform: rotate(90deg) }
.tools div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 14px }
.empty { color: var(--muted); text-align: center; padding: 72px 0 }
body.notools .tools { display: none }
#latest { position: fixed; bottom: 22px; right: 22px; z-index: 2; border-radius: 999px; padding: 8px 14px; background: var(--accent); color: #fff; border: none; box-shadow: var(--shadow); opacity: 0; pointer-events: none; transform: translateY(6px); transition: opacity .2s, transform .2s }
#latest.on { opacity: 1; pointer-events: auto; transform: none }
footer { max-width: 820px; margin: -48px auto 0; padding: 0 20px 28px; color: var(--muted); font-size: 12px; text-align: center }
.toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 7px 14px; border-radius: 999px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none }
.toast.on { opacity: 1 }
@media (max-width: 600px) { body { font-size: 15px } .bar { flex-wrap: wrap; padding: 10px 14px; gap: 10px } .t { flex-basis: calc(100% - 44px) } .acts { width: 100%; justify-content: flex-end } .dl { display: none } main { padding: 14px 12px 64px } .m { padding: 12px 14px } .m.you { max-width: 94% } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto } .dot { animation: none } }
</style></head>
<body><header><div class="bar"><div class="mark" aria-hidden="true">L</div><div class="t"><h1 id="title">${esc(o.title)}</h1><div class="sub" id="sub"><span class="live"><span class="dot"></span><span id="live">LIVE</span></span><span id="state">${esc(o.sub)}</span></div></div>
<div class="acts"><label class="tog"><input type="checkbox" id="tools" checked> Tool calls</label><button id="copy" type="button">Copy as Markdown</button><a class="btn dl" href="${id}.md?download=1" download>Download .md</a></div></div></header>
<main id="main">${o.body}</main><footer>Shared from Laki · view-only · it updates as it goes</footer><button id="latest" type="button">↓ New below</button><div class="toast" id="toast"></div>
<script nonce="${o.nonce}">
(() => {
  let v = ${o.v}
  const $ = id => document.getElementById(id)
  // tool calls shown or not: the reader's pick, kept in this browser (none kept: shown)
  const tools = on => { document.body.classList.toggle('notools', !on); $('tools').checked = on; try { localStorage.setItem('laki.tools', on ? '1' : '0') } catch {} }
  try { if (localStorage.getItem('laki.tools') === '0') tools(false) } catch {}
  $('tools').onchange = e => tools(e.target.checked)
  const toast = t => { $('toast').textContent = t; $('toast').classList.add('on'); setTimeout(() => $('toast').classList.remove('on'), 1600) }
  // the write starts in the click (Safari's rule), the text comes when fetched
  const md = () => fetch('${id}.md', { cache: 'no-store' }).then(r => r.text())
  $('copy').onclick = () => (window.ClipboardItem ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': md().then(t => new Blob([t], { type: 'text/plain' })) })]) : md().then(t => navigator.clipboard.writeText(t))).then(() => toast('Copied as Markdown'), () => toast('Couldn\\u2019t copy'))
  const end = (why, word = 'ENDED') => { document.body.classList.add('ended'); $('live').textContent = word; $('state').textContent = why }
  const poll = () => fetch('${id}.json?v=' + v, { cache: 'no-store' }).then(r => (r.status === 404 ? end('This share has ended') : r.json().then(j => {
    $('state').textContent = j.sub
    document.body.classList.remove('ended')
    $('live').textContent = 'LIVE'
    if (j.v !== v) {
      const low = innerHeight + scrollY >= document.body.scrollHeight - 80 // at the end: follow what's new
      v = j.v
      const open = [...document.querySelectorAll('main details')].map(d => d.open) // the reader's picks: kept
      $('main').innerHTML = j.body // the server's, escaped there
      document.querySelectorAll('main details').forEach((d, k) => k < open.length && (d.open = open[k]))
      $('title').textContent = j.title
      document.title = j.title + ' \\u00b7 Laki'
      if (low) scrollTo(0, document.body.scrollHeight)
      else $('latest').classList.add('on') // something new below where the reader is
    }
    setTimeout(poll, 2500)
  }))).catch(() => (end('Can\\u2019t reach it now \\u00b7 trying again', 'OFFLINE'), setTimeout(poll, 5000))) // offline, the tunnel's error page
  $('latest').onclick = () => scrollTo(0, document.body.scrollHeight)
  addEventListener('scroll', () => innerHeight + scrollY >= document.body.scrollHeight - 80 && $('latest').classList.remove('on'), { passive: true })
  setTimeout(poll, 2500)
})()
</script></body></html>`
}
