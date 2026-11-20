import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { seedOf } from './text'

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

// ⌘F over the terminal: incremental search through the tab's screen and scrollback.
// ⏎ next, ⇧⏎ previous, esc closes. seq changes on every ⌘F: focus the field again, with the terminal's selection as
// the query when there is one (seedOf) and it isn't the match the search itself selected (hit).
export function FindBar({ term, search, seq, onClose }: { term: Terminal; search: SearchAddon; seq: number; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [cs, setCs] = useState(false)
  const [re, setRe] = useState(false)
  const [res, setRes] = useState<{ i: number; n: number } | null>(null)
  const [bad, setBad] = useState(false)
  const inp = useRef<HTMLInputElement>(null)
  const hit = useRef('') // the terminal's selection a find left: its match, not yours
  const seeded = useRef('') // the seed set, to select once it's the field's value

  useEffect(() => {
    const d = search.onDidChangeResults(r => setRes({ i: r.resultIndex, n: r.resultCount }))
    return () => d.dispose()
  }, [search])
  useLayoutEffect(() => {
    const s = seedOf(term.getSelection())
    if (s && s !== hit.current && s !== q) (seeded.current = s), setQ(s)
    inp.current?.focus()
    inp.current?.select()
  }, [seq]) // before the next key arrives
  useLayoutEffect(() => void (seeded.current && seeded.current === q && ((seeded.current = ''), inp.current?.select())), [q]) // the seed, selected (not on the first render, before it's in)
  // matches are bright (--find): while the bar is open, text darkens or lightens to stay readable on them
  useEffect(() => {
    const was = term.options.minimumContrastRatio
    term.options.minimumContrastRatio = 4.5
    return () => { term.options.minimumContrastRatio = was }
  }, [term])

  const find = (dir: 1 | -1, incremental = false) => {
    if (!q) { search.clearDecorations(); setRes(null); return }
    const m = css('--find'), a = css('--find-active')
    const opts = { caseSensitive: cs, regex: re, incremental, decorations: { matchBackground: m, matchOverviewRuler: m, activeMatchBackground: a, activeMatchColorOverviewRuler: a } }
    try {
      setBad(false)
      const found = dir > 0 ? search.findNext(q, opts) : search.findPrevious(q, opts)
      hit.current = term.getSelection().trim()
      if (!found) setRes({ i: -1, n: 0 }) // no results event when nothing matches
    } catch { setBad(true) } // a regex that doesn't parse
  }
  useEffect(() => find(1, true), [q, cs, re])

  const close = () => { search.clearDecorations(); onClose(); term.focus() }
  const label = !q ? '' : bad ? 'bad regex' : !res ? '' : res.n === 0 ? 'no results' : res.i < 0 ? `${res.n}+` : `${res.i + 1}/${res.n}`
  return (
    <div className="find">
      <input ref={inp} value={q} placeholder="Find" spellCheck={false} aria-label="Find in terminal"
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); close() }
        }} />
      <span className="find-count">{label}</span>
      <button className={cs ? 'on' : ''} title="Match case" onClick={() => setCs(v => !v)}>Aa</button>
      <button className={re ? 'on' : ''} title="Regular expression" onClick={() => setRe(v => !v)}>.*</button>
      <button title="Previous (⇧⏎)" onClick={() => find(-1)}>↑</button>
      <button title="Next (⏎)" onClick={() => find(1)}>↓</button>
      <button title="Close (esc)" onClick={close}>×</button>
    </div>
  )
}
