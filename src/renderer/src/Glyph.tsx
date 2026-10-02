// ◆ needs you, spinner running, ● finished while you looked away, ◷ usage limit, ✖ exited, ○ idle
export function Glyph({ s }: { s: string }) {
  if (s === 'running') return <span className="glyph spin" title="running" />
  const ch = { waiting: '◆', done: '●', idle: '○', exited: '✖', limit: '◷' }[s] ?? ''
  return (
    <span className={`glyph g-${s}`} title={s}>
      {ch}
    </span>
  )
}
