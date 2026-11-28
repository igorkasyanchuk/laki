// npm run prices: LiteLLM's model price table (model_prices_and_context_window.json) into src/shared/prices.json, the
// rows Laki prices transcripts by (src/shared/types.ts costOf): claude-*, gpt-5*, grok-*, gemini-*, glm-*, kimi-* and
// MiniMax-* chat models (a first party's own row, its provider's prefix dropped: xAI's "xai/", z.ai's "zai/", Moonshot's
// "moonshot/", MiniMax's "minimax/": the ids their APIs say in a transcript's message.model, glm-5.1, kimi-k2.6, MiniMax-M2.5), each with its input, output, cache read, 5-minute and 1-hour cache write and a long prompt's
// rates (above_200k, above_272k…: the first such line), USD per million tokens; sorted, with the date. The app never
// fetches prices: this runs by hand before a release (docs/release.md; dmg.sh warns when the file is over 30 days old).
// A model LiteLLM lacks or gets wrong goes in types.ts' PRICE_OWN, which wins. Run: npm run prices [-- <file.json>]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const OUT = join(import.meta.dirname, '..', 'src', 'shared', 'prices.json')
const KEEP = /^(claude-|gpt-5|grok-|gemini-|glm-|kimi-|MiniMax-)/
const FIRST: Record<string, string> = { 'xai/': 'grok-', 'zai/': 'glm-', 'moonshot/': 'kimi-', 'minimax/': 'MiniMax-' } // a provider's own prefix: the ids it keeps

type Row = Record<string, unknown>
type Rates = { in: number; out: number; rd?: number; w5?: number; w1?: number }
export type PriceRow = Rates & { long?: Rates & { above: number } }

const m = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x * 1e6 * 1e6) / 1e6 : undefined) // per token to per million, no float dust
const FIELDS: [keyof Rates, string][] = [['in', 'input_cost_per_token'], ['out', 'output_cost_per_token'], ['rd', 'cache_read_input_token_cost'], ['w5', 'cache_creation_input_token_cost'], ['w1', 'cache_creation_input_token_cost_above_1hr']]

export function rowOf(r: Row): PriceRow | undefined {
  if (r.mode !== 'chat' && r.mode !== 'responses') return
  const base = Object.fromEntries(FIELDS.flatMap(([k, f]) => (m(r[f]) !== undefined ? [[k, m(r[f])]] : []))) as Partial<Rates>
  if (base.in === undefined || base.out === undefined) return
  // a long prompt's line: the smallest above_<n>k_tokens a base field has (batches', flex's and priority's left out)
  const lines = [...new Set(Object.keys(r).flatMap(k => (x => (x ? [Number(x[1]) * 1000] : []))(/^(?:input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost(?:_above_1hr)?)_above_(\d+)k_tokens$/.exec(k))))].sort((a, b) => a - b)
  const above = lines[0]
  const long = above !== undefined ? (Object.fromEntries(FIELDS.flatMap(([k, f]) => (v => (v !== undefined ? [[k, v]] : []))(m(r[`${f}_above_${above / 1000}k_tokens`])))) as Partial<Rates>) : undefined
  return { ...(base as Rates), ...(long && long.in !== undefined && { long: { above, ...(long as Rates) } }) }
}

export function pricesOf(all: Record<string, Row>, date: string) {
  const models: Record<string, PriceRow> = {}
  for (const [key, r] of Object.entries(all)) {
    const pre = Object.keys(FIRST).find(x => key.startsWith(x))
    const id = pre ? key.slice(pre.length) : key
    if (id.includes('/') || !KEEP.test(id) || (pre && !id.startsWith(FIRST[pre])) || !r || typeof r !== 'object') continue
    const row = rowOf(r)
    if (row && !(id in models && !pre)) models[id] = row // the first party's own row wins over a reseller's same id
  }
  return { date, source: URL, models: Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b))) }
}

if (import.meta.main) {
  const file = process.argv[2]
  const text = file ? readFileSync(file, 'utf8') : await fetch(URL, { signal: AbortSignal.timeout(30_000) }).then(r => (r.ok ? r.text() : Promise.reject(new Error(`LiteLLM's table: HTTP ${r.status}`))))
  const out = pricesOf(JSON.parse(text), new Date().toISOString().slice(0, 10))
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)
  console.log(`${Object.keys(out.models).length} models, ${out.date} → ${OUT}`)
}
