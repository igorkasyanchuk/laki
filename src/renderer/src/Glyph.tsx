// ◆ needs you, spinner running (setup: a setup script), ● finished while you looked away, ◷ usage limit,
// ✖ exited, ○ idle, ✓ ended fine. The same file is in both apps (laki-electron, laki-go).
export function Glyph({ s }: { s: string }) {
  if (s === 'running' || s === 'setup') return <span className={`glyph spin g-${s}`} title={s} />
  const ch = { waiting: '◆', done: '●', idle: '○', exited: '✖', ok: '✓', finished: '✓', limit: '◷' }[s] ?? '·'
  return (
    <span className={`glyph g-${s || 'none'}`} title={s || 'shell'}>
      {ch}
    </span>
  )
}
