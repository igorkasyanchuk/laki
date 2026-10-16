// Memory's compaction: a project's learned memories (agents' auto-memory, never the user's own) to Laki AI's model as a
// list, back as a shorter one (duplicates merged, overlaps joined, each the gist in a line or two, stale or one-off ones
// dropped) that replaces them; the project keeps the run (`compacted`) and <data>/memory-compact.jsonl each one's texts.
// memoryTick (every 30 minutes, with Laki AI on and settings.memoryCompact not off) runs it every days (COMPACT_DAYS)
// and as the learned ones reach MEMORY_MAX; a project's Memory tab's *Compact now* is memoryCompact.
import { appendFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { COMPACT_DAYS, type CompactLogLine, type CompactRun, type Memory, MEMORY_AUTO_LEN, MEMORY_MAX } from '../shared/types.ts'
import { aiOnce } from './ai.ts'
import { changed, dir, findProject, save, state } from './core.ts'

const logPath = join(dir, 'memory-compact.jsonl')
const DAY = 86400000
const going = new Set<string>() // projects being compacted

const SYSTEM = `You compact a software project's memory: notes coding agents saved about the project for their later sessions
(approaches that work or don't, gotchas, conventions, where things live, how to run and test it). You get them as a JSON
array of {id, text}. Return a JSON object {"memories": [{"text": "...", "from": ["id", ...]}]}: the same knowledge in fewer,
better items. Merge duplicates and items that say the same thing; join related ones; keep each the gist in a line or two
(${MEMORY_AUTO_LEN} characters at most), concrete (commands, paths, names kept exactly); drop what's plainly stale,
contradicted by a newer item (a higher index is newer) or about one task only. Never invent anything. "from": the ids an
item came from. Answer with the JSON object only.`

// the model's answer: its items, each a text cut to MEMORY_AUTO_LEN, and when the newest of what it came from was added
function parse(text: string, given: Memory[]): Memory[] {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) // a fenced block, words around it
  let items: unknown
  try {
    items = JSON.parse(json).memories
  } catch {
    throw new Error('the model answered something else than the list')
  }
  if (!Array.isArray(items)) throw new Error('the model answered no list')
  const at = (ids: unknown) => Math.max(0, ...given.filter(m => Array.isArray(ids) && ids.includes(m.id)).map(m => m.at)) || Date.now()
  const out = items
    .filter(i => i && typeof i.text === 'string' && i.text.trim())
    .map(i => ({ id: randomUUID().slice(0, 6), text: i.text.trim().slice(0, MEMORY_AUTO_LEN), at: at(i.from), auto: true as const, by: 'compacted' }))
  if (!out.length) throw new Error('the model gave back an empty list: nothing changed')
  if (out.length > given.length) throw new Error(`the model gave back more (${out.length}) than it got (${given.length}): nothing changed`)
  return out
}

export async function memoryCompact(o: { project: string; why?: CompactRun['why'] }) {
  if (!state.settings?.ai?.on) throw new Error('Laki AI is off: it does the compacting (Settings › AI)')
  const p = findProject(o.project)
  if (going.has(p.id)) throw new Error(`${p.name}'s memory is being compacted`)
  const given = (p.memory ?? []).filter(m => m.auto)
  const run: CompactRun = { at: Date.now(), why: o.why ?? 'you', ok: false, before: given.length, after: given.length }
  if (given.length < 2) return { ...run, ok: true }
  going.add(p.id)
  let made: Memory[] = []
  try {
    const text = await aiOnce({ system: SYSTEM, prompt: JSON.stringify(given.map(m => ({ id: m.id, text: m.text }))), ask: `Compact ${p.name}'s memory (${given.length})`, json: true })
    made = parse(text, given)
    // what changed meanwhile stays (learned since, pinned as yours, edited): only the ones as it was given are replaced
    const now = findProject(p.id)
    const was = new Map(given.map(m => [m.id, m.text]))
    now.memory = [...(now.memory ?? []).filter(m => !(m.auto && was.get(m.id) === m.text)), ...made].sort((a, b) => a.at - b.at)
    Object.assign(run, { ok: true, after: made.length })
  } catch (e) {
    run.error = (e as Error).message
  } finally {
    going.delete(p.id)
    run.ms = Date.now() - run.at
    const now = state.projects.find(x => x.id === p.id)
    if (now) now.compacted = run
    try {
      const line: CompactLogLine = { ...run, project: p.id, was: given.map(m => m.text), ...(run.ok && { now: made.map(m => m.text) }) }
      appendFileSync(logPath, JSON.stringify(line) + '\n', { mode: 0o600 })
    } catch {}
    save()
    changed()
  }
  if (!run.ok) throw new Error(run.error)
  return run
}

// a project's runs, newest first (its Memory tab's log), with the texts before and after
export function memoryCompactLog(o: { project?: string; n?: number }) {
  let lines: CompactLogLine[] = []
  try {
    lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch {}
  return lines.filter(l => !o.project || l.project === o.project).reverse().slice(0, o.n ?? 20)
}

// due ones, one at a time: every days since the last run (never run: since its oldest learned one), or the learned list
// full; with Laki AI on and the setting not off (now: tests move the clock)
export async function memoryTick(now = Date.now()) {
  const s = state.settings
  if (!s?.ai?.on || s.memoryCompact?.off) return []
  const days = s.memoryCompact?.days ?? COMPACT_DAYS
  const done: string[] = []
  for (const p of state.projects) {
    const learned = (p.memory ?? []).filter(m => m.auto)
    if (learned.length < 2 || going.has(p.id)) continue
    const last = p.compacted?.at ?? Math.min(...learned.map(m => m.at))
    const full = learned.length >= MEMORY_MAX && (p.compacted?.after ?? 0) < MEMORY_MAX // full again since; a run that left it full (failed, or no shorter): its days then
    const why = full ? 'full' : days > 0 && now - last >= days * DAY ? 'days' : undefined
    if (!why) continue
    await memoryCompact({ project: p.id, why }).then(() => done.push(p.id), () => {}) // a failure is its run, logged
  }
  return done
}
