// The agent's plan, live: its own to-do list as its tools write it, on its tab and row. Claude's TodoWrite (the whole
// list each time) or, in newer versions, TaskCreate and TaskUpdate (a task at a time), from its hooks' tool payloads;
// codex's update_plan (the whole list) from its transcript (share.ts meterOf). stale: from an earlier turn (a prompt
// came since and it wrote none)

export type PlanItem = { id?: string; text: string; state: 'todo' | 'now' | 'done' }
export type TabPlan = { items: PlanItem[]; stale?: boolean }

const STATE: Record<string, PlanItem['state']> = { pending: 'todo', in_progress: 'now', completed: 'done' }
const words = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 200) : '')
const MAX = 50

// what a tool call makes of the list (undefined: not a list tool, or nothing to change); claude's TaskCreate gets its id
// from its result, so it counts after it ran (PostToolUse), the others before (PreToolUse: the list as it goes)
export function planFrom(was: TabPlan | undefined, o: { tool: string; input?: any; result?: unknown; post: boolean }): TabPlan | undefined {
  const inp = o.input && typeof o.input === 'object' ? o.input : {}
  const fresh = !was || was.stale ? [] : was.items
  if (o.tool === 'TodoWrite' && !o.post && Array.isArray(inp.todos))
    return { items: inp.todos.slice(0, MAX).map((t: any) => ({ text: words(t?.content) || words(t?.activeForm), state: STATE[t?.status] ?? 'todo' })).filter((t: PlanItem) => t.text) }
  if (o.tool === 'update_plan' && Array.isArray(inp.plan))
    return { items: inp.plan.slice(0, MAX).map((t: any) => ({ text: words(t?.step), state: STATE[t?.status] ?? 'todo' })).filter((t: PlanItem) => t.text) }
  if (o.tool === 'TaskCreate' && o.post && words(inp.subject)) {
    const r = typeof o.result === 'string' ? o.result : JSON.stringify(o.result ?? '')
    const id = String((o.result as any)?.task?.id ?? (o.result as any)?.id ?? /#(\d+)|"id"\s*:\s*"?(\w+)/.exec(r)?.slice(1).find(Boolean) ?? fresh.length + 1)
    return { items: [...fresh.filter(t => t.id !== id), { id, text: words(inp.subject), state: 'todo' as const }].slice(-MAX) }
  }
  if (o.tool === 'TaskUpdate' && !o.post && inp.taskId !== undefined && was) {
    const id = String(inp.taskId)
    if (!was.items.some(t => t.id === id)) return
    if (inp.status === 'deleted') return { items: was.items.filter(t => t.id !== id) }
    return { items: was.items.map(t => (t.id === id ? { ...t, ...(STATE[inp.status] && { state: STATE[inp.status] }), ...(words(inp.subject) && { text: words(inp.subject) }) } : t)) }
  }
}

// "3/5", how many are done of how many
export const planCount = (p: TabPlan) => `${p.items.filter(t => t.state === 'done').length}/${p.items.length}`
// the step under way (else the next to do)
export const planNow = (p: TabPlan) => (p.items.find(t => t.state === 'now') ?? p.items.find(t => t.state === 'todo'))?.text
export const planDone = (p: TabPlan) => p.items.length > 0 && p.items.every(t => t.state === 'done')
