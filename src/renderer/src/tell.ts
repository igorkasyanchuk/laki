// The quick bar's hand-off (Q1, and Q7's show and tell: a screenshot, then what you say about it): the call its target
// gets. The pictures go as their paths in the words, as pasted images do (withPaths): an agent tab's send, a new
// workspace's prompt; Laki AI takes them as images. Pure (no DOM): test/tell.test.ts
import { withPaths } from './text.ts'

export type HandTo = { kind: 'new'; project: string } | { kind: 'send'; tab: string } | { kind: 'ai' }
// the new-workspace page's last picks, when they were for that project (its agent, model, place…)
export type LastPicks = { project?: string; place?: string; preset?: string; cmd?: string; local?: boolean; model?: string; effort?: string; perm?: string; fast?: boolean; sandbox?: boolean }

export function handOff(to: HandTo, text: string, paths: string[], last: LastPicks = {}): { method: string; params: Record<string, unknown> } {
  if (to.kind === 'ai') return { method: 'aiAsk', params: { text: text.trim(), images: paths, queue: true } }
  const body = withPaths(text, paths)
  if (to.kind === 'send') return { method: 'send', params: { target: to.tab, text: body, whenIdle: true, agent: true } }
  const same = last.project === to.project
  return { method: 'wsNew', params: { project: to.project, prompt: body, place: same && last.place ? last.place : 'top', ...(same && { preset: last.preset, cmd: last.cmd, local: last.local, model: last.model, effort: last.effort, perm: last.perm, fast: last.fast, sandbox: last.sandbox }) } }
}
