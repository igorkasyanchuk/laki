// A spec's blocks (BlockNote's JSON) as the Markdown agents read: README.md, written beside spec.json on each save.
// Ported from specdrop (server/markdown.ts: blocksToMarkdown, diagramToText); a diagram block is its text (nodes and
// edges, a wireframe's components back to front) and its PNG in files/. Headings sit a level under README.md's title.

type Inline = { type: string; text?: string; href?: string; styles?: Record<string, unknown>; content?: Inline[]; props?: Record<string, any> }
export type Block = { type: string; props?: Record<string, any>; content?: Inline[] | { rows?: { cells: any[] }[] }; children?: Block[] }

// z: layer, higher on top; fill: a palette name (FILLS in diagram.tsx)
export type DiagramNode = { id: string; shape: string; label: string; sub?: string; tag?: string; accent?: boolean; fill?: string; x?: number; y?: number; w?: number; h?: number; z?: number }
export type DiagramEdge = { id?: string; from: string; to: string; label?: string; dashed?: boolean; accent?: boolean; fromSide?: string; toSide?: string }
export type Diagram = { kind: string; nodes: DiagramNode[]; edges: DiagramEdge[] }

// a diagram file an agent wrote (<name>.diagram.json): only object nodes and edges, every field its type
const text = (v: unknown) => (v == null || v === '' ? undefined : String(v).slice(0, 1000))
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const side = (v: unknown) => (['l', 'r', 't', 'b'].includes(v as string) ? (v as string) : undefined)
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 1000) : [])
export function normalizeDiagram(d: any): Diagram | null {
  if (!Array.isArray(d?.nodes)) return null
  const nodes = objects(d.nodes)
  const ids = new Set(nodes.map(n => text(n.id)))
  let k = 0
  const fresh = () => {
    while (ids.has(`n${k}`)) k++
    ids.add(`n${k}`)
    return `n${k}`
  }
  return {
    kind: String(d.kind ?? 'flowchart'),
    nodes: nodes.map(n => ({
      id: text(n.id) ?? fresh(),
      shape: text(n.shape) ?? 'process',
      label: text(n.label) ?? '',
      sub: text(n.sub),
      tag: text(n.tag),
      accent: n.accent === true || undefined,
      fill: typeof n.fill === 'string' && /^[a-z]{1,16}$/.test(n.fill) ? n.fill : undefined,
      x: num(n.x),
      y: num(n.y),
      w: num(n.w),
      h: num(n.h),
      z: num(n.z),
    })),
    edges: objects(d.edges)
      .filter(e => text(e.from) && text(e.to))
      .map(e => ({ id: text(e.id), from: String(e.from), to: String(e.to), label: text(e.label), dashed: e.dashed === true || undefined, accent: e.accent === true || undefined, fromSide: side(e.fromSide), toSide: side(e.toSide) })),
  }
}

function inline(content: Inline[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .map(c => {
      if (c.type === 'link') return `[${inline(c.content)}](${c.href})`
      let t = c.text ?? ''
      if (!t) return t
      const s = c.styles ?? {}
      if (s.code) t = '`' + t + '`'
      if (s.bold) t = `**${t}**`
      if (s.italic) t = `_${t}_`
      if (s.strike) t = `~~${t}~~`
      return t
    })
    .join('')
}

export function diagramToText(d: Diagram): string {
  const name = new Map(d.nodes.map(n => [n.id, n.label || n.id]))
  const wire = d.kind === 'wireframe'
  // a wireframe is a layout: back to front, each component under the one it sits on, with where it sits and how big it is
  const z = (n: DiagramNode) => Number(n.z) || 0
  const nodes = wire ? d.nodes.map((n, i) => [n, i] as const).sort(([a, i], [b, j]) => z(a) - z(b) || i - j).map(([n]) => n) : d.nodes
  const sized = (o: DiagramNode) => o.x != null && o.y != null && !!o.w && !!o.h
  const area = (o: DiagramNode) => o.w! * o.h!
  const kids = new Map<DiagramNode | undefined, DiagramNode[]>()
  nodes.forEach((n, i) => {
    // the smallest component behind it that holds all of it (a tie: the upper one)
    let on: DiagramNode | undefined
    if (wire && sized(n))
      nodes.forEach((o, j) => {
        if (o === n || !sized(o) || !(j < i || (o.z == null && area(o) > area(n)))) return
        if (o.x! <= n.x! && o.y! <= n.y! && o.x! + o.w! >= n.x! + n.w! && o.y! + o.h! >= n.y! + n.h! && (!on || area(o) <= area(on))) on = o
      })
    if (!kids.has(on)) kids.set(on, [])
    kids.get(on)!.push(n)
  })
  const lines = [`Diagram type: ${d.kind}`, wire ? 'Components, back to front (indented: sits on the one above), @ x,y w×h:' : 'Nodes:']
  const put = (n: DiagramNode, pad: string) => {
    const extra = [n.tag && `tag: ${n.tag}`, n.accent && 'highlighted', n.fill && `fill: ${n.fill}`].filter(Boolean).join(', ')
    const at = wire && n.x != null && n.y != null ? ` @ ${n.x},${n.y}${n.w && n.h ? ` ${n.w}×${n.h}` : ''}` : ''
    lines.push(`${pad}- [${n.shape}] ${n.label || n.id}${extra ? ` (${extra})` : ''}${at}`)
    if (n.sub) for (const l of n.sub.split('\n')) lines.push(`${pad}    ${l}`)
    for (const c of kids.get(n) ?? []) put(c, pad + '  ')
  }
  for (const n of kids.get(undefined) ?? []) put(n, '')
  if (d.edges.length) lines.push('Edges:')
  for (const e of d.edges) lines.push(`- ${name.get(e.from) ?? e.from} ${e.dashed ? '-->' : '->'} ${name.get(e.to) ?? e.to}${e.label ? ` : ${e.label}` : ''}`)
  return lines.join('\n')
}

function block(b: Block, depth: number, n: number): string {
  const pad = '  '.repeat(depth)
  const p = b.props ?? {}
  const text = inline(Array.isArray(b.content) ? b.content : undefined)
  let out: string
  switch (b.type) {
    case 'heading':
      out = `${'#'.repeat(Math.min(6, (p.level ?? 1) + 1))} ${text}`
      break
    case 'bulletListItem':
      out = `${pad}- ${text}`
      break
    case 'numberedListItem':
      out = `${pad}${n}. ${text}`
      break
    case 'checkListItem':
      out = `${pad}- [${p.checked ? 'x' : ' '}] ${text}`
      break
    case 'quote':
      out = `> ${text}`
      break
    case 'codeBlock':
      out = '```' + (p.language ?? '') + '\n' + text + '\n```'
      break
    case 'image':
      out = `![${p.caption || p.name || 'image'}](${p.url})`
      break
    case 'file':
    case 'video':
    case 'audio':
      out = `Attachment: [${p.name || 'file'}](${p.url})${p.caption ? ` — ${p.caption}` : ''}`
      break
    case 'table': {
      const cells: any[][] = ((b.content as any)?.rows ?? []).map((r: any) => r.cells)
      const rows = cells.map(r => '| ' + r.map((c: any) => inline(Array.isArray(c) ? c : c.content)).join(' | ') + ' |')
      if (rows.length) rows.splice(1, 0, '|' + ' --- |'.repeat(cells[0].length))
      out = rows.join('\n')
      break
    }
    case 'diagram': {
      let d: Diagram | null = null
      try {
        d = JSON.parse(p.data)
      } catch {}
      out = d ? '```text\n' + diagramToText(d) + '\n```' : ''
      if (p.png) out += `\n\n![Diagram](${p.png})`
      break
    }
    default:
      out = pad + text
  }
  const kids = childBlocks(b.children ?? [], depth + 1)
  return kids ? `${out}\n${kids}` : out
}

function childBlocks(blocks: Block[], depth: number): string {
  let n = 0
  return blocks.map(b => block(b, depth, b.type === 'numberedListItem' ? ++n : (n = 0))).join('\n')
}

export function blocksToMarkdown(blocks: Block[]): string {
  let n = 0
  const parts: string[] = []
  let prev = ''
  for (const b of blocks) {
    const md = block(b, 0, b.type === 'numberedListItem' ? ++n : (n = 0))
    // list items stay tight, everything else separated by a blank line
    if (parts.length && !(/ListItem$/.test(b.type) && /ListItem$/.test(prev))) parts.push('')
    parts.push(md)
    prev = b.type
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// README.md back to what the editor's Markdown parser takes: its title line out, headings a level up (as written),
// outside code blocks. ponytail: a diagram comes back as its text (a code block), not a drawing
export function readmeBody(md: string) {
  let code = false
  return md
    .replace(/\r/g, '')
    .replace(/^#\s+.*\n+/, '')
    .split('\n')
    .map(l => {
      if (/^\s*(```|~~~)/.test(l)) code = !code
      return !code && /^#{2,6}\s/.test(l) ? l.slice(1) : l
    })
    .join('\n')
}
