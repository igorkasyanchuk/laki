// A shared tab (core.ts' shareStart): a read-only page anyone with its link opens, kept up to date. Here: what it
// shows, as Markdown (Copy, Download) and as the page. An agent's chat from its transcript (claude's, codex's): your
// prompts, its answers, its tool calls a line each; anything else (a shell, gemini…): the terminal's text.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type Block, type Inline, markdown } from '../shared/markdown.ts'

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
const url = (u: string) => (/^(https?:|mailto:)/i.test(u) ? esc(u) : '')
const TAG = { b: 'strong', i: 'em', s: 's' } as const
function inl(xs: Inline[]): string {
  return xs
    .map(x => {
      if (typeof x === 'string') return esc(x)
      if (x.t === 'code') return `<code>${esc(x.text)}</code>`
      if (x.t === 'br') return '<br>'
      if (x.t === 'img') return url(x.src) ? `<img src="${url(x.src)}" alt="${esc(x.alt)}" loading="lazy" referrerpolicy="no-referrer">` : esc(x.alt)
      if (x.t === 'a') return url(x.href) ? `<a href="${url(x.href)}" target="_blank" rel="noopener noreferrer nofollow">${inl(x.kids)}</a>` : inl(x.kids)
      return `<${TAG[x.t]}>${inl(x.kids)}</${TAG[x.t]}>`
    })
    .join('')
}
const al = (a: string) => (a ? ` class="${a}"` : '') // a class: the page's CSP has no inline styles
function html(bs: Block[]): string {
  return bs
    .map(b => {
      switch (b.t) {
        case 'h':
          return `<h${b.level}>${inl(b.inl)}</h${b.level}>`
        case 'p':
          return `<p>${inl(b.inl)}</p>`
        case 'code':
          return `<pre><code>${esc(b.text)}</code></pre>`
        case 'quote':
          return `<blockquote>${html(b.blocks)}</blockquote>`
        case 'hr':
          return '<hr>'
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul'
          const items = b.items.map(i => `<li>${i.task === undefined ? '' : `<input type="checkbox" disabled${i.task ? ' checked' : ''}> `}${html(i.blocks)}</li>`).join('')
          return `<${tag}${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''}>${items}</${tag}>`
        }
        case 'table':
          return `<div class="tw"><table><thead><tr>${b.head.map((c, k) => `<th${al(b.align[k])}>${inl(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, k) => `<td${al(b.align[k])}>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      }
    })
    .join('')
}

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
      return `<section class="m ${s.who}"><div class="who">${s.who === 'you' ? 'You' : esc(agent)}</div><div class="md">${html(markdown(s.text))}</div></section>`
    })
    .join('')
}

export function sharePage(o: { id: string; title: string; sub: string; body: string; v: number; nonce: string }) {
  const id = esc(o.id)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(o.title)} · Laki</title>
<style nonce="${o.nonce}">
:root { --bg: #f7f8fa; --panel: #fff; --line: #e3e6ec; --fg: #1d2230; --muted: #6b7385; --accent: #3d6fe0; --you: #eef3fe; --code: #f1f3f7; --mono: 'JetBrains Mono', 'SF Mono', Menlo, Monaco, monospace; --ui: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color-scheme: light dark }
@media (prefers-color-scheme: dark) { :root { --bg: #0e1014; --panel: #161a21; --line: #232833; --fg: #d5d9e3; --muted: #7a8294; --accent: #7aa2f7; --you: #1a2232; --code: #1b2029 } }
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 var(--ui) }
header { position: sticky; top: 0; z-index: 1; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line) }
.bar { max-width: 860px; margin: 0 auto; padding: 12px 16px; display: flex; gap: 12px; align-items: center }
.t { flex: 1; min-width: 0 }
h1 { margin: 0; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.sub { color: var(--muted); font-size: 12px; display: flex; gap: 6px; align-items: center }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #3fb950 }
.ended .dot { background: var(--muted) }
button, .btn { font: inherit; font-size: 13px; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; cursor: pointer; text-decoration: none; white-space: nowrap }
button:hover, .btn:hover { border-color: var(--accent) }
main { max-width: 860px; margin: 0 auto; padding: 16px 16px 48px }
.m { margin: 14px 0; padding: 12px 16px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line) }
.m.you { background: var(--you) }
.who { font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 4px }
.md > :first-child { margin-top: 0 } .md > :last-child { margin-bottom: 0 }
.md h1, .md h2, .md h3 { font-size: 1.1em; margin: 1em 0 .4em }
a { color: var(--accent) }
code { font: 13px var(--mono); background: var(--code); border-radius: 4px; padding: 1px 4px }
pre { background: var(--code); border-radius: 8px; padding: 10px 12px; overflow-x: auto }
pre code { background: none; padding: 0 }
pre.screen { font: 12.5px/1.45 var(--mono); white-space: pre-wrap; word-break: break-word; border: 1px solid var(--line) }
blockquote { margin: 0; padding-left: 12px; border-left: 3px solid var(--line); color: var(--muted) }
.tw { overflow-x: auto } table { border-collapse: collapse } th, td { border: 1px solid var(--line); padding: 4px 8px } .center { text-align: center } .right { text-align: right }
img { max-width: 100% }
.tools { margin: 6px 4px; color: var(--muted); font: 12.5px/1.6 var(--mono) }
.tools summary { cursor: pointer; font-family: var(--ui) }
.tools div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.empty { color: var(--muted); text-align: center; padding: 48px 0 }
.tog { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); white-space: nowrap; cursor: pointer }
body.notools .tools { display: none }
.toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg); padding: 6px 12px; border-radius: 6px; font-size: 13px; opacity: 0; transition: opacity .2s }
.toast.on { opacity: 1 }
@media (max-width: 560px) { .bar { flex-wrap: wrap } .t { flex-basis: 100% } }
</style></head>
<body><header><div class="bar"><div class="t"><h1 id="title">${esc(o.title)}</h1><div class="sub" id="sub"><span class="dot"></span><span id="state">${esc(o.sub)}</span></div></div>
<label class="tog"><input type="checkbox" id="tools" checked> Tool calls</label><button id="copy" type="button">Copy as Markdown</button><a class="btn" href="${id}.md?download=1" download>Download .md</a></div></header>
<main id="main">${o.body}</main><div class="toast" id="toast"></div>
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
  const end = why => { document.body.classList.add('ended'); $('state').textContent = why }
  const poll = () => fetch('${id}.json?v=' + v, { cache: 'no-store' }).then(r => (r.status === 404 ? end('This share has ended') : r.json().then(j => {
    $('state').textContent = j.sub
    document.body.classList.remove('ended')
    if (j.v !== v) {
      const low = innerHeight + scrollY >= document.body.scrollHeight - 80 // at the end: follow what's new
      v = j.v
      const open = [...document.querySelectorAll('main details')].map(d => d.open) // the reader's picks: kept
      $('main').innerHTML = j.body // the server's, escaped there
      document.querySelectorAll('main details').forEach((d, k) => k < open.length && (d.open = open[k]))
      $('title').textContent = j.title
      document.title = j.title + ' \\u00b7 Laki'
      if (low) scrollTo(0, document.body.scrollHeight)
    }
    setTimeout(poll, 2500)
  }))).catch(() => (end('Can\\u2019t reach it now \\u00b7 trying again'), setTimeout(poll, 5000))) // offline, the tunnel's error page
  setTimeout(poll, 2500)
})()
</script></body></html>`
}
