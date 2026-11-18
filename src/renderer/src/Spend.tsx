// Where it went (wsSpend, shared/spend.ts): a workspace's tokens by what entered the context and by what its agents wrote,
// a bar each with its share, and up to three hints; every number an estimate. Read when it's opened (a click), not before:
// Info's section and the Proof card's line
import { useState } from 'react'
import type { Spend } from '../../shared/spend'

export type SpendView = Spend & { tabs: number }
const k = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : String(x))
const pc = (x: number) => `${Math.round(x * 100)}%`
const OUT = { edits: 'edits', messages: 'messages', thinking: 'thinking', tools: 'tool calls' } as const

function Bars({ rows }: { rows: { label: string; share: number; tip?: string }[] }) {
  return (
    <ul className="spend-bars">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} title={r.tip ?? r.label}>
          <span className="spend-pct num">{pc(r.share)}</span>
          <span className="spend-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} />
          </span>
          <span className="spend-what">{r.label}</span>
        </li>
      ))}
    </ul>
  )
}

export function SpendSection({ load, title = 'Where it went' }: { load: () => Promise<SpendView>; title?: string }) {
  const [s, setS] = useState<SpendView | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const toggle = () => {
    setOpen(!open)
    if (!open) void load().then(setS, (e: Error) => setErr(e.message)) // read anew each time it opens: the transcript grows
  }
  return (
    <section className="spend">
      <button type="button" className="link small spend-head" aria-expanded={open} onClick={toggle}>
        {title}
      </button>
      {open && (err ? <p className="err small">{err}</p> : !s ? <p className="muted small">Reading its transcripts…</p> : !s.tabs ? <p className="muted small">No claude or codex transcript to read yet.</p> : (
        <div className="spend-body small">
          <p className="muted">
            Estimates{s.exact ? ': totals from the transcripts, spread by size' : ': by size (its transcript has no usage)'} · {s.turns} turn{s.turns === 1 ? '' : 's'}
          </p>
          <div className="spend-h">Input · {k(s.input.total)} tokens</div>
          <Bars rows={s.input.parts.filter(p => p.share >= 0.01).slice(0, 12).map(p => ({ label: `${p.label}${p.kind === 'file' && p.reads ? ` · read ${p.reads}×` : p.kind === 'command' && p.reads ? ` · ${p.reads} runs` : ''}`, share: p.share, tip: `${p.label}: ≈${k(p.tokens)} tokens` }))} />
          <div className="spend-h">Output · {k(s.output.total)} tokens</div>
          <Bars rows={s.output.parts.map(p => ({ label: OUT[p.kind], share: p.share, tip: `${OUT[p.kind]}: ≈${k(p.tokens)} tokens` }))} />
          {s.hints.length > 0 && (
            <ul className="spend-hints">
              {s.hints.map(h => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}
