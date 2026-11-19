// F15: graduated autonomy, its first step. Your Allows of one kind of ask (shared/ask.ts streakOf: a command's first
// words, a file's folder) are counted per project, in a row: a Deny of it starts that one over, a failed Done check, an
// Undo of a turn, a rewind or a revert in the project starts them all over (core.ts streakReset). At STREAK_AT, one
// notice in Laki's window asks "make it a rule?": Make it a rule adds it through projectSet's allow (the user's own
// path: the pick is alertAnswer's, never an agent's), No starts it over, Don't suggest again keeps it off (state.ruleNo).
// Only your answers count (main.ts' answer, never a rule's own Allow: autoAllow calls core's answer), and never what no
// rule may take: risky or chained commands, paths outside the worktree, what Always ask for holds. Each suggestion and
// its answer is in daemon.log, as rule answers are
import { STREAK_AT, standing, streakOf } from '../shared/ask.ts'
import type { Perm } from '../shared/ask.ts'
import { alertShow } from './alerts.ts'
import { log, projectSet, save, state } from './core.ts'
import { policy } from './policy.ts'

const asking = new Set<string>() // project and key: its card is up

const ALLOW = /^(yes|allow|approve|proceed|run)\b/i
const DENY = /^(no|deny|reject|cancel|don['’]t)\b/i

// an answer you gave (main.ts' answer: a card's, a notification's, a phone's, Allow all's): picked, its option's words
export function answered(ws: string | undefined, perm: Perm | undefined, picked: string) {
  const p = state.projects.find(x => x.id === state.workspaces.find(w => w.id === ws)?.project)
  if (!p || !perm || standing(picked)) return // a "don't ask again" is the agent's own rule
  const s = streakOf(perm, p.alwaysAsk)
  if (!s) return
  const all = (state.askStreaks ??= {})
  const mine = (all[p.id] ??= {})
  if (DENY.test(picked)) {
    if (mine[s.key]) delete mine[s.key], save()
    return
  }
  if (!ALLOW.test(picked)) return
  mine[s.key] = (mine[s.key] ?? 0) + 1
  save()
  const no = state.ruleNo?.[p.id]?.includes(s.key)
  const ruled = p.allow?.some(r => r.tool === s.tool && r.pattern === s.pattern)
  if (mine[s.key] < STREAK_AT || no || ruled || policy()?.allowRules === false || asking.has(`${p.id} ${s.key}`)) return
  void suggest(p.id, ws!, s)
}

async function suggest(project: string, ws: string, s: { key: string; tool: string; pattern: string }) {
  const k = `${project} ${s.key}`
  asking.add(k)
  const x = s.tool === 'Bash' ? s.pattern : `${s.tool} in ${s.pattern}`
  log(`rule suggestion ${project}: ${s.tool} ${s.pattern} (allowed ${STREAK_AT} times in a row)`)
  try {
    const a = (await alertShow({ title: 'Make it a rule?', text: `You allowed ${x} ${STREAK_AT} times here: make it a rule?`, choices: ['Make it a rule', 'No', "Don't suggest again"], to: ws }, 'notice', 'Laki')) as { choice?: string }
    const choice = a.choice ?? 'No'
    log(`rule suggestion ${project}: ${s.tool} ${s.pattern}: ${a.choice ?? 'closed'}`)
    const p = state.projects.find(x => x.id === project)
    if (!p) return
    delete state.askStreaks?.[project]?.[s.key]
    if (choice === 'Make it a rule' && !p.allow?.some(r => r.tool === s.tool && r.pattern === s.pattern)) projectSet(project, { allow: [...(p.allow ?? []), { tool: s.tool, pattern: s.pattern, addedAt: Date.now() }] })
    else if (choice === "Don't suggest again") (state.ruleNo ??= {})[project] = [...new Set([...(state.ruleNo[project] ?? []), s.key])]
    save()
  } catch (e) {
    log(`rule suggestion ${project}: ${(e as Error).message}`)
  } finally {
    asking.delete(k)
  }
}
