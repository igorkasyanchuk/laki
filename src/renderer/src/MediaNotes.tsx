// #7: Comment on a picture or a video artifact (the Artifacts gallery's big view): a click marks a spot, a drag a box,
// each numbered with your note; a video pauses as you mark it, each mark keeps its time and the seek bar has a dot per
// note (a click on one goes there). Send to the agent: each frame (the picture, or the video at each note's time) drawn
// with its marks, saved (shot: imageSave's path) and named in one message with where each note is (artPick.ts mediaNotes)
import { useEffect, useRef, useState } from 'react'
import { clock, type MediaMark, mediaNotes } from '../../shared/artPick'
import { Icon, IconButton } from './ui'
import './mediaNotes.css'

type Draft = Omit<MediaMark, 'note'> & { note: string }
const NEAR = 0.3 // s: a video's marks show on the frame this close to their time
const MAX_W = 1600 // px: a frame's picture at most this wide

export function MediaNotes({ path, src, video, shot, onSend, onStop }: { path: string; src: string; video: boolean; shot?: (png: string) => Promise<string>; onSend: (text: string) => Promise<unknown>; onStop: () => void }) {
  const [marks, setMarks] = useState<MediaMark[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const media = useRef<HTMLVideoElement & HTMLImageElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const from = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => (setMarks([]), setDraft(null)), [path])
  const next = () => Math.max(0, draft?.n ?? 0, ...marks.map(m => m.n)) + 1
  const at = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const keepDraft = () => draft?.note.trim() && setMarks(m => [...m, draft])
  const down = (e: React.PointerEvent) => {
    if (e.button) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (video) media.current?.pause()
    from.current = at(e)
    setDrag({ ...from.current, w: 0, h: 0 })
  }
  const move = (e: React.PointerEvent) => {
    if (!from.current) return
    const p = at(e)
    setDrag({ x: Math.min(p.x, from.current.x), y: Math.min(p.y, from.current.y), w: Math.abs(p.x - from.current.x), h: Math.abs(p.y - from.current.y) })
  }
  const up = () => {
    if (!from.current || !drag) return
    from.current = null
    const box = drag.w > 0.01 || drag.h > 0.01 ? drag : { ...drag, w: 0, h: 0 }
    keepDraft()
    setDraft({ n: next(), ...box, ...(video && { t: media.current?.currentTime ?? 0 }), note: '' })
    setDrag(null)
  }
  const shown = (m: { t?: number }) => !video || m.t === undefined || Math.abs(m.t - t) < NEAR
  const seek = (s: number) => media.current && ((media.current.currentTime = s), setT(s))
  // a frame with its marks drawn on: the picture, or the video at s (seeked, then drawn)
  const frame = async (ms: MediaMark[], s?: number) => {
    const el = media.current!
    if (video && s !== undefined && Math.abs(el.currentTime - s) > 0.01) await new Promise<void>(ok => ((el.onseeked = () => ((el.onseeked = null), ok())), (el.currentTime = s)))
    const w0 = video ? el.videoWidth : el.naturalWidth
    const h0 = video ? el.videoHeight : el.naturalHeight
    const k = Math.min(1, MAX_W / (w0 || 1))
    const c = document.createElement('canvas')
    c.width = Math.round(w0 * k)
    c.height = Math.round(h0 * k)
    const g = c.getContext('2d')!
    g.drawImage(el, 0, 0, c.width, c.height)
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8743b'
    const r = Math.max(10, c.width / 70)
    for (const m of ms) {
      const [x, y, w, h] = [m.x * c.width, m.y * c.height, m.w * c.width, m.h * c.height]
      g.lineWidth = Math.max(2, c.width / 400)
      g.strokeStyle = ink
      if (w || h) g.strokeRect(x, y, w, h)
      g.fillStyle = ink
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#fff'
      g.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(m.n), x, y + 1)
    }
    return c.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
  }
  const send = async () => {
    const all = draft?.note.trim() ? [...marks, draft] : marks
    if (!all.length || sending) return
    setSending(true)
    setErr('')
    try {
      // one picture per moment (a video's notes at one time share it), the picture's once
      const tenth = (m: MediaMark) => Math.round((m.t ?? 0) * 10)
      const groups = video ? [...new Set(all.map(tenth))].map(k => (ms => ({ s: ms[0].t, ms }))(all.filter(m => tenth(m) === k))) : [{ s: undefined, ms: all }]
      const shots: { path: string; ns: number[] }[] = []
      if (shot) for (const g of groups) shots.push({ path: await shot(await frame(g.ms, g.s)), ns: g.ms.map(m => m.n) })
      await onSend(mediaNotes(path, video, all, shots))
      setMarks([])
      setDraft(null)
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setSending(false)
    }
  }
  const box = (m: { n?: number; x: number; y: number; w: number; h: number }, cls = '') => (
    <span key={m.n ?? 'drag'} className={`mn-mark ${m.w || m.h ? 'box' : 'spot'} ${cls}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}>
      {m.n !== undefined && <b className="art-n">{m.n}</b>}
    </span>
  )
  const count = marks.length + (draft?.note.trim() ? 1 : 0)
  return (
    <div className="mn">
      <div className="mn-stage" ref={stage}>
        {video ? (
          <video ref={media} src={src} preload="auto" playsInline onTimeUpdate={e => setT(e.currentTarget.currentTime)} onLoadedMetadata={e => setDur(e.currentTarget.duration || 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        ) : (
          <img ref={media} src={src} alt={path} draggable={false} />
        )}
        <div className="mn-layer" role="presentation" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => ((from.current = null), setDrag(null))}>
          {marks.filter(shown).map(m => box(m))}
          {draft && shown(draft) && box(draft, 'draft')}
          {drag && box(drag, 'draft')}
        </div>
      </div>
      {video && (
        <div className="mn-bar">
          <IconButton icon={playing ? 'pause' : 'run'} title={playing ? 'Pause' : 'Play'} onClick={() => (playing ? media.current?.pause() : void media.current?.play())} />
          <span className="mn-time mono small">{clock(t)}</span>
          <span className="mn-seek">
            <input type="range" min={0} max={dur || 0} step={0.05} value={t} aria-label="Seek" onChange={e => seek(Number(e.target.value))} />
            {dur > 0 && [...marks, ...(draft ? [draft] : [])].map(m => <button key={m.n} type="button" className="mn-dot" style={{ left: `${((m.t ?? 0) / dur) * 100}%` }} aria-label={`Note ${m.n} at ${clock(m.t ?? 0)}`} data-tip={`${m.n}. ${m.note || '…'}`} onClick={() => (media.current?.pause(), seek(m.t ?? 0))} />)}
          </span>
          <span className="mn-time mono small">{clock(dur)}</span>
        </div>
      )}
      <div className="art-notes">
        {!marks.length && !draft && <span className="muted small">{video ? 'Pause where it goes wrong, then click a spot or drag a box on the frame and say what to change. Each note keeps its time.' : 'Click a spot or drag a box on the picture, then say what to change there.'} They go to the agent in one message, with {video ? 'each frame' : 'the picture'} and the marks drawn on.</span>}
        {marks.map(m => (
          <div key={m.n} className="art-note">
            <b className="art-n">{m.n}</b>
            {video && m.t !== undefined && (
              <button type="button" className="link small mono" onClick={() => (media.current?.pause(), seek(m.t!))}>
                {clock(m.t)}
              </button>
            )}
            <span className="grow">{m.note}</span>
            <IconButton icon="x" title="Take it out" onClick={() => setMarks(x => x.filter(y => y.n !== m.n))} />
          </div>
        ))}
        {draft && (
          <div className="art-note art-draft">
            <b className="art-n">{draft.n}</b>
            {video && draft.t !== undefined && <span className="muted small mono">{clock(draft.t)}</span>}
            <input autoFocus value={draft.note} placeholder={draft.w || draft.h ? 'What to change in this box…' : 'What to change here…'} onChange={e => setDraft({ ...draft, note: e.target.value })} onKeyDown={e => (e.key === 'Enter' ? (e.preventDefault(), draft.note.trim() && (setMarks(m => [...m, draft]), setDraft(null))) : e.key === 'Escape' && (e.preventDefault(), e.stopPropagation(), setDraft(null)))} />
            <button type="button" disabled={!draft.note.trim()} onClick={() => (setMarks(m => [...m, draft]), setDraft(null))}>
              Add
            </button>
          </div>
        )}
        {err && <span className="warn small">{err}</span>}
      </div>
      <div className="buttons">
        <button className="primary" disabled={!count || sending} onClick={() => void send()} data-tip="Each note with where it is, and the picture with its marks, into the workspace's agent's prompt">
          {sending ? 'Sending…' : `Send to the agent${count ? ` (${count})` : ''}`}
        </button>
        <button onClick={onStop}>
          <Icon name="x" size={12} /> Stop commenting
        </button>
      </div>
    </div>
  )
}
