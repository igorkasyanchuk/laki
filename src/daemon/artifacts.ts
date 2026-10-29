// a workspace's storage folder: its artifacts, and the links agents publish, kept there in one hidden file, LINKS
// (.url files an agent or an older Laki left are moved into it). core.ts re-exports it.

import { existsSync } from 'node:fs'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { writeAtomic } from '../shared/conn.ts'
import { type Link, type Tab } from '../shared/types.ts'
import { changed, findWs, type Runtime, state, wsLog } from './core.ts'

// the status bar's Artifacts: the files in each live workspace's storage folder (hidden ones, and hidden folders, not
// walked), with the port scan; one scan at a time, one asked for meanwhile runs after it (a link just removed would be
// read back by the scan under way). ponytail: a full walk each time; cap it if folders get huge
export const artifacts = new Map<string, number>()
export const links = new Map<string, Link[]>() // its kept links, newest first: the info panel's, the gallery's first
let scanning: Promise<void> | undefined
let rescan: Promise<void> | undefined
// a .url file's link (an Internet shortcut: [InternetShortcut], URL=…): http(s), or file:/// (a page an agent made on
// this Mac, opened by main's open-path: a document only)
export const urlOf = (text: string) => /^URL=(https?:\/\/\S+|file:\/\/\/[^\r\n]*?)\s*$/im.exec(text)?.[1] // a path may have spaces (Application Support)
// a storage folder's links: [{ url, title, at }], newest last as kept; hidden, so not an artifact of its own
export const LINKS = '.laki-links.json'
type Kept = { url: string; title: string; at: number }
const readLinks = async (dir: string): Promise<Kept[]> => {
  try {
    const v = JSON.parse(await readFile(join(dir, LINKS), 'utf8'))
    return Array.isArray(v) ? v.filter(x => x && typeof x.url === 'string' && /^(https?:\/\/|file:\/\/\/)/.test(x.url)).map(x => ({ url: x.url, title: String(x.title ?? '') || hostOf(x.url), at: Number(x.at) || 0 })) : []
  } catch {
    return []
  }
}
const writeLinks = (dir: string, ls: Kept[]) => writeAtomic(join(dir, LINKS), `${JSON.stringify(ls, null, 1)}\n`)
// the view's: newest first, each with a key of its own (path: link:<url>, the gallery's and Info's)
const viewOf = (ls: Kept[]): Link[] => ls.map(l => ({ path: `link:${l.url}`, url: l.url, title: l.title, at: l.at })).sort((a, b) => b.at - a.at)
// the files under dir (relative paths), hidden files and folders left out
const walkFiles = async (dir: string, rel = ''): Promise<string[]> => {
  const out: string[] = []
  for (const e of await readdir(join(dir, rel), { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.')) continue
    if (e.isFile()) out.push(rel ? `${rel}/${e.name}` : e.name)
    else if (e.isDirectory()) out.push(...(await walkFiles(dir, rel ? `${rel}/${e.name}` : e.name)))
  }
  return out
}
export function scanArtifacts(): Promise<void> {
  if (!scanning) return (scanning = scanOnce().finally(() => (scanning = undefined)))
  return (rescan ??= scanning.catch(() => {}).then(() => ((rescan = undefined), scanArtifacts())))
}
async function scanOnce() {
  let moved = false
  try {
    for (const m of [artifacts, links]) for (const id of m.keys()) if (!state.workspaces.some(w => w.id === id)) m.delete(id) // removed ones
    for (const w of state.workspaces) {
      let all = w.storage && !w.archived ? await walkFiles(w.storage) : []
      // a .url file (an agent saved one, or an older Laki did): its link moved into LINKS, the file gone
      if (all.some(f => /\.url$/i.test(f)) && (await serial(() => fileUrls(w.storage!, all)))) all = await walkFiles(w.storage!)
      const ls = w.storage && !w.archived ? viewOf(await readLinks(w.storage)) : []
      const n = all.length + ls.length // the status bar's count: a link is one too
      if ((artifacts.get(w.id) ?? 0) !== n) (moved = true), n ? artifacts.set(w.id, n) : artifacts.delete(w.id)
      if (JSON.stringify(ls) !== JSON.stringify(links.get(w.id) ?? [])) (moved = true), ls.length ? links.set(w.id, ls) : links.delete(w.id)
    }
  } finally {
    if (moved) changed()
  }
}

// ---------- what agents publish, kept as links in the storage folder (.url files: the Artifacts, the info panel's links)
// Two ways, at a turn's end: what a publish tool returned during it (claude's PostToolUse: its Artifact tool's publish,
// or any tool named for publishing), and the links its last answer gives to where published things live (any agent
// with a hook). One already there (the agent saved it, as its note says) isn't kept twice.
export type Published = { url: string; title: string }
const URL_END = /[.,;:!?)\]}>'"`*_]+$/ // what follows a link in prose
// ponytail: the hosts published things live on; add one here when an agent's site isn't kept
export const PUBLISHED = /https:\/\/(?:claude\.ai\/(?:code\/)?artifact\/[\w-]+|(?:claude\.site|gist\.github\.com)\/\S+|chatgpt\.com\/(?:canvas\/)?share\/\S+|[\w-]+(?:\.[\w-]+)*\.(?:vercel\.app|netlify\.app|pages\.dev|github\.io|fly\.dev|onrender\.com|surge\.sh|web\.app|workers\.dev)(?:[/?#]\S*)?)/g
const PUBLISH_TOOL = /publish|deploy|upload|share/i // an MCP tool's name that says it puts something online
const sameUrl = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
const hostOf = (u: string) => u.replace(/^https?:\/\//, '').split(/[/?#]/)[0]
// a PostToolUse payload's published link: claude's Artifact tool publishing a page (not reading, listing, or an asset),
// or a tool named for publishing; the first https link its answer gives, named after what it published
export function publishedBy(pl: { tool_name?: string; tool_input?: any; tool_response?: unknown }): Published | undefined {
  const name = String(pl.tool_name ?? '')
  const inp = pl.tool_input && typeof pl.tool_input === 'object' ? pl.tool_input : {}
  const artifact = name === 'Artifact' && (!inp.action || inp.action === 'publish') && !inp.asset
  if (!artifact && !(name.startsWith('mcp__') && PUBLISH_TOOL.test(name.split('__').pop()!))) return
  const said = (typeof pl.tool_response === 'string' ? pl.tool_response : JSON.stringify(pl.tool_response ?? '')).slice(0, 20000)
  const url = (artifact ? said.match(PUBLISHED) : said.match(/https:\/\/[^\s"'\\<>]+/g))?.[0]?.replace(URL_END, '')
  if (!url) return
  const from = [inp.title, inp.name].find(x => typeof x === 'string' && x.trim()) ?? (typeof inp.file_path === 'string' ? basename(inp.file_path).replace(/\.[^.]+$/, '') : '')
  return { url, title: from || hostOf(url) }
}
// the links of a last answer: its words for each ([title](url), else what precedes it on its line, less "I published")
export function publishedIn(text: string): Published[] {
  return [...text.matchAll(PUBLISHED)].map(m => {
    const url = m[0].replace(URL_END, '')
    const before = text.slice(0, m.index)
    const md = /\[([^\]\n]{1,80})\]\($/.exec(before)?.[1]
    const line = before.slice(before.lastIndexOf('\n') + 1).split(/https?:\/\/\S+|[.!?](?:\s|$)/).pop()! // its own sentence
    const words = line
      .replace(/[\s:–—\-(<]+$/, '')
      .replace(/\*\*|`/g, '')
      .replace(/^[\s>*•\-\d.)#,]+/, '')
      .replace(/^(?:(?:and|but|so|then|also)\s+)?(?:(?:i(?:['’]ve| have)?|we(?:['’]ve)?|it(?:['’]s| is))\s+)?/i, '')
      .replace(/^(?:just\s+|now\s+)?(?:published|deployed|made|created|shared|uploaded|posted|put|live)\b\s*(?:it\s+)?(?:at|to|on|here)?\s*/i, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(-8)
      .join(' ')
      .replace(/(?:^|\s+)(?:(?:to|at|on|in|and|or|is|are|was|here|via|from|with)\b\s*)+$/i, '') // "deployed it to", "and"
    const id = /artifact\/([\w-]{6})/.exec(url)?.[1]
    return { url, title: md ?? (words || (id ? `Claude artifact ${id}` : hostOf(url))) }
  })
}
let keeping: Promise<unknown> = Promise.resolve() // one at a time: two tabs ending at once mustn't both write a link
const serial = <T,>(f: () => Promise<T>) => {
  const p = keeping.then(f)
  keeping = p.catch(() => {})
  return p
}
// the .url files among a storage folder's: each one's link into LINKS (named by the file, dated by it; one already kept
// stays as it was), the file removed; how many went. ponytail: one that isn't a link (no URL= line, too big) stays a file
async function fileUrls(dir: string, all: string[]) {
  const kept = await readLinks(dir)
  const have = new Set(kept.map(l => sameUrl(l.url)))
  const gone: string[] = []
  for (const path of all.filter(f => /\.url$/i.test(f))) {
    const abs = join(dir, path)
    const [st, text] = await Promise.all([stat(abs), readFile(abs, 'utf8')]).catch(() => [null, ''] as const)
    const url = st && st.size < 8192 ? urlOf(text) : undefined
    if (!url) continue
    if (!have.has(sameUrl(url))) kept.push({ url, title: basename(path).replace(/\.url$/i, ''), at: Math.round(st!.mtimeMs) }), have.add(sameUrl(url))
    gone.push(abs)
  }
  if (!gone.length) return 0
  writeLinks(dir, kept) // first: a crash between keeps the file, never loses the link
  await Promise.all(gone.map(f => rm(f, { force: true })))
  return gone.length
}
// linkAdd: a link kept as an agent's would be (a workflow's save block); one already kept stays as it was
export async function linkAdd(dir: string, url: string, title: string) {
  await serial(async () => {
    const kept = await readLinks(dir)
    if (!kept.some(l => sameUrl(l.url) === sameUrl(url))) writeLinks(dir, [...kept, { url, title: title.replace(/^[.\s]+/, '').slice(0, 80).trim() || hostOf(url), at: Date.now() }])
  })
  void scanArtifacts()
}
// linkRm: a kept link taken off (the gallery's right click)
export async function linkRm(ref: string, url: string) {
  const ws = findWs(ref)
  if (!ws.storage) return
  await serial(async () => writeLinks(ws.storage!, (await readLinks(ws.storage!)).filter(l => l.url !== url)))
  await scanArtifacts()
}
export function keepPublished(tab: Tab, r: Runtime, last?: string) {
  const found = [...(r.published ?? []), ...(last ? publishedIn(last) : [])]
  r.published = undefined
  return serial(() => keepLinks(tab, found))
}
async function keepLinks(tab: Tab, found: Published[]) {
  const ws = state.workspaces.find(w => w.id === tab.workspace)
  if (!found.length || !ws?.storage || ws.host || !existsSync(ws.storage)) return
  const dir = ws.storage
  await fileUrls(dir, await walkFiles(dir)) // the agent saved one itself: that's the one kept
  const kept = await readLinks(dir)
  const have = new Set(kept.map(l => sameUrl(l.url)))
  const now = Date.now()
  const before = kept.length
  for (const [i, p] of found.entries()) {
    if (have.has(sameUrl(p.url))) continue
    have.add(sameUrl(p.url))
    kept.push({ url: p.url, title: p.title.replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').slice(0, 80).trim() || hostOf(p.url), at: now + i })
    wsLog(ws, `${tab.name}: kept a link it published, ${p.url}`)
  }
  if (kept.length === before) return // all kept already
  writeLinks(dir, kept)
  void scanArtifacts()
}

// artifactList: the storage folder's files for the status bar's gallery, newest first (500 at most)
export async function artifactList(ref: string) {
  const ws = findWs(ref)
  if (!ws.storage) return []
  const list = await Promise.all((await walkFiles(ws.storage)).map(path => stat(join(ws.storage!, path)).then(st => ({ path, size: st.size, at: st.mtimeMs }), () => null)))
  return list.filter(x => !!x).sort((a, b) => b.at - a.at).slice(0, 500) // the links: the view's (links), not files
}
