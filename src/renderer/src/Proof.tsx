// The Proof card (verify.ts): what Laki saw of a checked turn itself, a line each: its scripts with their end (a click
// opens the output Laki kept), the Preview's pictures (before and after), git's facts on what the turn touched. Never
// the agent's words. Under the Reader's last turn and on Needs you's finish card, for that tab's turn only
import type { Proof } from '../../shared/types'
import { Icon } from './ui'

const TOUCHED = [
  ['tests', 'tests'],
  ['ci', 'CI config'],
  ['migrations', 'migrations'],
  ['lockfiles', 'lockfiles'],
] as const

export function ProofList({ p, open }: { p: Proof; open: (path: string) => void }) {
  const touched = TOUCHED.filter(([k]) => p.facts[k]).map(([, w]) => w)
  return (
    <div className="proof small" onClick={e => e.stopPropagation()}>
      <div className="muted">Laki saw</div>
      {p.checks.map(c => (
        <button type="button" key={c.name} className={`proof-line ${c.ok ? 'proof-ok' : 'proof-bad'}`} disabled={!c.file} data-tip={c.file ? 'Its output, as Laki kept it' : undefined} onClick={() => c.file && open(c.file)}>
          <Icon name={c.ok ? 'check' : 'x'} size={12} />
          <span className="mono">{c.name}</span>
          <span className="muted">{c.summary}</span>
        </button>
      ))}
      {p.shots.after && (
        <div className="proof-line">
          <Icon name="image" size={12} />
          {p.shots.before && (
            <button type="button" className="link" onClick={() => open(p.shots.before!)}>
              Before
            </button>
          )}
          <button type="button" className="link" onClick={() => open(p.shots.after!)}>
            {p.shots.before ? 'After' : 'Screenshot'}
          </button>
        </div>
      )}
      <div className="proof-line muted">
        <Icon name="file" size={12} />
        {p.facts.files} file{p.facts.files === 1 ? '' : 's'} changed{touched.length ? `, with ${touched.join(', ')}` : ''}
      </div>
    </div>
  )
}
