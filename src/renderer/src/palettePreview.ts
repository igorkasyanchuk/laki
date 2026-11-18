// ⌘K's preview (Palette's right column at 720px and wider): the highlighted item as a plain object, from the view alone
// (no daemon call as the arrows move): a workspace's or a tab's agents, plan, PR, diff, next step and its focused agent's
// last line; a command's words, key and what it acts on. Recording mode's private workspaces: none. Pure
// (test/units-more.test.ts). ponytail: a tab's last line only, the view has no more of its screen; files and settings
// aren't palette items, so no preview of theirs
import type { View } from '../../shared/types.ts'
import { planCount, planNow } from '../../shared/todos.ts'
import { nextStep } from '../../shared/nextStep.ts'
import { KEYS, cmdMap, keyShow } from '../../shared/keys.ts'

export type PreviewAct = 'open' | 'changes' | 'ship'
export type PreviewRow = { label: string; value: string; tone?: 'ok' | 'bad' | 'ask' }
export type Preview = { title: string; sub?: string; rows: PreviewRow[]; tail?: string[]; acts: PreviewAct[]; ws?: string }
export type PreviewItem = { kind?: string; label: string; hint?: string; id?: string; ws?: string; tab?: string; on?: string }

const STATUS = { running: 'working', waiting: 'needs you', idle: 'idle', exited: 'exited' } as const
const took = (ms: number) => (ms < 60e3 ? `${Math.max(1, Math.round(ms / 1e3))} s` : ms < 3600e3 ? `${Math.round(ms / 60e3)} min` : `${(ms / 3600e3).toFixed(1)} h`)

export function previewOf(it: PreviewItem, view: Pick<View, 'workspaces' | 'tabs' | 'projects' | 'settings'>, now = Date.now()): Preview | null {
  if (it.ws || it.tab) {
    const tab = it.tab ? view.tabs.find(t => t.id === it.tab) : undefined
    const w = view.workspaces.find(x => x.id === (it.ws ?? tab?.workspace))
    const p = w && view.projects.find(x => x.id === w.project)
    if (!w || (view.settings.recording && (w.private || p?.private))) return null
    const tabs = view.tabs.filter(t => t.workspace === w.id)
    const agents = tabs.filter(t => t.kind === 'agent')
    const rows: PreviewRow[] = agents.slice(0, 6).map(t => ({
      label: t.name,
      value: [t.failed ? 'stopped' : STATUS[t.status], t.status === 'running' && t.runAt ? took(now - t.runAt) : ''].filter(Boolean).join(' · '),
      tone: t.failed ? 'bad' : t.status === 'waiting' ? 'ask' : undefined,
    }))
    const planned = [tab, ...agents].find(t => t?.plan && !t.plan.stale && t.plan.items.length)?.plan
    if (planned) rows.push({ label: 'Plan', value: [planCount(planned), planNow(planned)].filter(Boolean).join(' · ') })
    if (w.pr) rows.push({ label: 'PR', value: [`#${w.pr.number}`, w.pr.draft ? 'draft' : w.pr.state.toLowerCase(), w.pr.checks && `checks ${w.pr.checks}`].filter(Boolean).join(' · '), tone: w.pr.checks === 'fail' ? 'bad' : w.pr.checks === 'pass' ? 'ok' : undefined })
    const changed = !!w.stat && (w.stat.files > 0 || w.stat.dirty > 0)
    if (changed) rows.push({ label: 'Diff', value: `+${w.stat!.add} −${w.stat!.del} in ${w.stat!.files} file${w.stat!.files === 1 ? '' : 's'}` })
    const git = p?.git !== false
    const step = nextStep(w, tabs, { git })
    if (step) rows.push({ label: 'Next', value: step.label, tone: step.tone === 'bad' ? 'bad' : step.tone === 'ask' ? 'ask' : undefined })
    const focus = tab ?? agents.find(t => t.status === 'waiting') ?? agents[0]
    const acts: PreviewAct[] = ['open', ...(git ? (['changes'] as const) : []), ...(w.kind === 'worktree' && !w.pr && changed ? (['ship'] as const) : [])]
    return { title: tab ? `${w.name || w.id} / ${tab.name}` : w.name || w.id, sub: [p?.name, w.branch].filter(Boolean).join(' · ') || undefined, rows, tail: focus?.last ? focus.last.split('\n').slice(-6) : undefined, acts, ws: w.id }
  }
  // a command: its words (Settings › Keys' for one it has, else the label's after its colon), its key, what it acts on
  const k = KEYS.find(x => x.id === it.id)
  const bound = it.id ? cmdMap(view.settings.cmdKeys)[it.id] : undefined
  const [name, ...words] = it.label.split(': ')
  const key = bound ? keyShow(bound) : k?.key ?? (it.hint && /^[⌘⌥⇧⌃]/.test(it.hint) ? it.hint : undefined)
  const rows: PreviewRow[] = [...(key ? [{ label: 'Key', value: key }] : []), ...(it.on ? [{ label: 'On', value: it.on }] : [])]
  return { title: name, sub: k?.label ?? (words.join(': ') || (it.hint && it.hint !== 'action' && it.hint !== key ? it.hint : undefined)), rows, acts: ['open'] }
}
