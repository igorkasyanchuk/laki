// The Proof card (verify.ts): what Laki saw of a checked turn itself, a line each: its scripts with their end (a click
// opens the output Laki kept), the Preview's pictures (before and after), git's facts on what the turn touched. Never
// the agent's words. Under the Reader's last turn and on Needs you's finish card, for that tab's turn only
import { useEffect, useState } from 'react'
import type { Proof } from '../../shared/types'
import { SpendSection } from './Spend'
import type { SpendView } from './Spend'
import { Icon } from './ui'

const TOUCHED = [
  ['tests', 'tests'],
  ['ci', 'CI config'],
  ['migrations', 'migrations'],
  ['lockfiles', 'lockfiles'],
] as const

// spend: its workspace's Where it went (wsSpend), its cost's line: read when clicked; image: a picture of its storage
// folder as a data URL (fileRead's), for Compare
export function ProofList({ p, open, spend, image }: { p: Proof; open: (path: string) => void; spend?: () => Promise<SpendView>; image?: (path: string) => Promise<string | undefined> }) {
  const touched = TOUCHED.filter(([k]) => p.facts[k]).map(([, w]) => w)
  const [cmp, setCmp] = useState(false)
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
          {p.shots.before && image && (
            <button type="button" className="link" aria-expanded={cmp} onClick={() => setCmp(!cmp)}>
              Compare
            </button>
          )}
          {p.shots.diff !== undefined && <span className="tag" data-tip="The share of the picture's pixels that changed">{p.shots.diff}% changed</span>}
        </div>
      )}
      {cmp && p.shots.before && p.shots.after && image && <Compare before={p.shots.before} after={p.shots.after} image={image} />}
      <div className="proof-line muted">
        <Icon name="file" size={12} />
        {p.facts.files} file{p.facts.files === 1 ? '' : 's'} changed{touched.length ? `, with ${touched.join(', ')}` : ''}
      </div>
      {spend && <SpendSection load={spend} title="Where its tokens went" />}
    </div>
  )
}

// before and after, side by side in one frame: Slider (the after over the before, cut at the range's value), Side by
// side, or Overlay (the after at half over the before)
const HOW = [['slider', 'Slider'], ['side', 'Side by side'], ['overlay', 'Overlay']] as const
function Compare({ before, after, image }: { before: string; after: string; image: (path: string) => Promise<string | undefined> }) {
  const [src, setSrc] = useState<[string, string] | null | false>(null)
  const [how, setHow] = useState<(typeof HOW)[number][0]>('slider')
  const [x, setX] = useState(50)
  useEffect(() => {
    let on = true
    void Promise.all([image(before), image(after)]).then(([a, b]) => on && setSrc(a && b ? [a, b] : false), () => on && setSrc(false))
    return () => void (on = false)
  }, [before, after])
  if (!src) return <div className="muted">{src === false ? 'The pictures can’t be read' : 'Loading the pictures…'}</div>
  return (
    <div className="proof-cmp">
      <span className="seg" role="group" aria-label="How to compare">
        {HOW.map(([k, words]) => (
          <button type="button" key={k} className={how === k ? 'on' : ''} aria-pressed={how === k} onClick={() => setHow(k)}>
            {words}
          </button>
        ))}
      </span>
      {how === 'side' ? (
        <div className="proof-cmp-side">
          <img src={src[0]} alt="Before" />
          <img src={src[1]} alt="After" />
        </div>
      ) : (
        <div className="proof-cmp-stack">
          <img src={src[0]} alt="Before" />
          <img src={src[1]} alt="After" style={how === 'slider' ? { clipPath: `inset(0 ${100 - x}% 0 0)` } : { opacity: 0.5 }} />
        </div>
      )}
      {how === 'slider' && <input type="range" min={0} max={100} value={x} aria-label="How much of the after shows, from the left" aria-valuetext={`${x}% after`} onChange={e => setX(Number(e.target.value))} />}
    </div>
  )
}
