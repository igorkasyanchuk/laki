// Laki's menu items (ui.tsx MenuItem) as a plain model macOS can draw (main's menu-popup, guards.ts menuModelOk), and
// what each id runs. Pure (test/units-more.test.ts). A color grid is a Color submenu, the picked one checked; a menu with
// another piece of Laki's own (an emoji grid, a filter field) has no model: it stays Laki's
import type { NativeItem } from '../../main/guards'
import type { MenuItem } from './ui'

const ON = '✓' // ui.tsx' ON: not imported, so node's tests load this without React

export function menuModel(items: MenuItem[]): { model: NativeItem[]; runs: Map<string, () => void> } | undefined {
  const runs = new Map<string, () => void>()
  const walk = (list: MenuItem[]): NativeItem[] | undefined => {
    const out: NativeItem[] = []
    for (const it of list) {
      if (it === null) {
        if (out.length && !out[out.length - 1].separator) out.push({ separator: true })
        continue
      }
      if ('head' in it) {
        out.push({ label: it.head, enabled: false })
        continue
      }
      if ('colors' in it) {
        const pick = it.pick
        out.push({ label: 'Color', sub: it.colors.map(c => {
          const id = String(runs.size + 1)
          runs.set(id, () => pick(c))
          return { id, label: c[0].toUpperCase() + c.slice(1), ...(c === it.value && { checked: true }) }
        }) })
        continue
      }
      if (!('label' in it)) return // emojis, a filter: Laki's own
      const sublabel = it.hint && it.hint !== ON ? it.hint : it.sub
      const base = { label: it.label, ...(sublabel && { sublabel }), ...(it.off && { enabled: false }), ...(it.hint === ON && { checked: true }) }
      if (it.items) {
        const sub = walk(it.items)
        if (!sub) return
        out.push({ ...base, sub })
      } else {
        const id = String(runs.size + 1)
        runs.set(id, it.run)
        out.push({ ...base, id })
      }
    }
    while (out.length && out[out.length - 1].separator) out.pop()
    return out
  }
  const model = walk(items)
  return model && { model, runs }
}
