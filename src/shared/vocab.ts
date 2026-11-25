// #V1: speech-to-text that knows this project's words: the names of workspaces, tabs, projects, branches and agents, and
// the files the focused workspace changed (their base names). The daemon (ai.ts voiceText) sends them to the model as
// its prompt where the endpoint takes one, and fixes the transcript after: a term with a hyphen, an underscore, a dot or
// camelCase has a spoken form (its words, lower case: checkout-flow → "checkout flow", useSession → "use session"),
// and that run of words in the transcript, whole words only, becomes the term. Never by sound. Pure: test/vocab.test.ts
export const VOCAB_MAX = 100
export type VocabWs = { id: string; name?: string; branch?: string; project: string; hidden?: boolean; tabs?: string[] }
export type VocabIn = { focused?: string; files?: string[]; workspaces: VocabWs[]; projects: { id: string; name?: string; hidden?: boolean }[]; agents?: string[] }
// at most VOCAB_MAX, the focused workspace's first (its name, branch, tabs, changed files), then the rest; nothing
// hidden (Recording mode's Private), each once
export function vocabOf(v: VocabIn): string[] {
  const out = new Set<string>()
  const add = (t?: string) => {
    const s = (t ?? '').trim()
    if (s && s.length <= 60 && !/[\r\n]/.test(s) && out.size < VOCAB_MAX) out.add(s)
  }
  const shown = v.workspaces.filter(w => !w.hidden && !v.projects.find(p => p.id === w.project)?.hidden)
  const f = shown.find(w => w.id === v.focused)
  if (f) {
    add(f.name)
    add(f.branch?.split('/').pop())
    f.tabs?.forEach(add)
    for (const p of v.files ?? []) add(p.split('/').pop()?.replace(/\.[^.]+$/, ''))
  }
  for (const w of shown) w !== f && (add(w.name), add(w.branch?.split('/').pop()), w.tabs?.forEach(add))
  for (const p of v.projects) if (!p.hidden) add(p.name)
  v.agents?.forEach(add)
  return [...out]
}
// how it's said: its words, lower case; undefined for one plain word (nothing to fix)
export function spokenOf(term: string): string | undefined {
  const words = term
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[-_./\s]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
  return words.length > 1 && words.every(w => /^[\p{L}\p{N}]+$/u.test(w)) ? words.join(' ') : undefined
}
// the transcript with each spoken run as its term (the longest first); swaps: each one made, for the voice box (a click
// puts heard back)
export function vocabFix(text: string, terms: string[]): { text: string; swaps: { term: string; heard: string }[] } {
  const rules = terms.flatMap(t => (s => (s ? [[s, t] as const] : []))(spokenOf(t))).sort((a, b) => b[0].length - a[0].length)
  if (!rules.length) return { text, swaps: [] }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+')
  const re = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${rules.map(([s]) => `(${esc(s)})`).join('|')})(?![\\p{L}\\p{N}_-])`, 'giu')
  const swaps: { term: string; heard: string }[] = []
  const out = text.replace(re, (heard, ...g) => {
    const term = rules[g.findIndex(x => x !== undefined)][1]
    if (heard !== term) swaps.push({ term, heard })
    return term
  })
  return { text: out, swaps }
}
