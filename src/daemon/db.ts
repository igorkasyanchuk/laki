// #1: a SQLite database in a worktree (Rails' db/development.sqlite3, an app's local store) for the side panel's Files:
// its tables with their row counts and schema, a table's first DB_ROWS rows (sorted by a column, filtered by words in
// any of them), and a read-only query (SELECT or WITH only), DB_QUERY_ROWS at most. Opened read-only (node's own
// node:sqlite, as agentUsage.ts reads agy's): nothing here writes, and SQLite itself refuses a write on that
// connection. In: a clone of it (and its -wal) in a temp folder, as agyRead does: a read-only open of a WAL database
// would leave its -shm and -wal in the worktree, and the app writing it never waits on Laki's lock. Cells as text: NULL,
// a blob's size. Pure (test/db.test.ts); the daemon runs it in a worker (dbWorker.ts, files.ts' dbOf: a time and a heap
// cap, the temp folder its, gone however the worker ends). ponytail: a huge table's count(*) is a scan; the worker's
// time cap ends it
import { constants, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type DbTable = { name: string; kind: 'table' | 'view'; rows?: number; sql: string }
export type DbRows = { cols: string[]; rows: string[][]; cut?: boolean }
export type DbAsk = { op: 'tables' } | { op: 'rows'; table: string; sort?: string; desc?: boolean; filter?: string } | { op: 'query'; sql: string }
export const DB_ROWS = 200
export const DB_QUERY_ROWS = 1000
export const DB_MAX = 2 * 1024 ** 3 // a file past 2 GB: a file card
export const isDb = (head: Buffer) => head.toString('latin1', 0, 16) === 'SQLite format 3\0'
type Sqlite = typeof import('node:sqlite')

const name = (s: string) => `"${s.replace(/"/g, '""')}"`
const cellOf = (v: unknown) => (v === null || v === undefined ? 'NULL' : v instanceof Uint8Array ? `(blob, ${v.length} bytes)` : String(v))
const rowsOf = (it: Iterable<unknown>, max: number): DbRows & { cols: string[] } => {
  const rows: string[][] = []
  let cols: string[] = []
  let cut = false
  for (const r of it as Iterable<Record<string, unknown>>) {
    if (rows.length >= max) {
      cut = true
      break
    }
    if (!rows.length) cols = Object.keys(r)
    rows.push(cols.map(c => cellOf(r[c])))
  }
  return { cols, rows, ...(cut && { cut }) }
}

export function dbRead(path: string, q: DbAsk, tmp?: string): { tables: DbTable[] } | DbRows {
  const sqlite = process.getBuiltinModule?.('node:sqlite') as Sqlite | undefined
  if (!sqlite) throw new Error("this Node can't read SQLite")
  let file = path
  if (tmp) {
    file = join(tmp, 'db')
    copyFileSync(path, file, constants.COPYFILE_FICLONE) // APFS: a clone, no bytes copied; elsewhere node copies
    if (existsSync(`${path}-wal`)) copyFileSync(`${path}-wal`, `${file}-wal`, constants.COPYFILE_FICLONE)
  }
  const d = new sqlite.DatabaseSync(file, { readOnly: true })
  try {
    if (q.op === 'tables') {
      const all = d.prepare("SELECT name, type, sql, tbl_name FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all() as { name: string; type: string; sql: string; tbl_name: string }[]
      return {
        tables: all
          .filter(t => (t.type === 'table' || t.type === 'view') && !t.name.startsWith('sqlite_'))
          .map(t => {
            const extra = all.filter(x => x.type !== 'table' && x.type !== 'view' && x.tbl_name === t.name).map(x => x.sql) // its indexes and triggers
            const rows = t.type === 'table' ? Number((d.prepare(`SELECT count(*) AS n FROM ${name(t.name)}`).get() as { n: number }).n) : undefined
            return { name: t.name, kind: t.type as 'table' | 'view', ...(rows !== undefined && { rows }), sql: [t.sql, ...extra].map(s => `${s.trim()};`).join('\n\n') }
          }),
      }
    }
    if (q.op === 'rows') {
      const t = d.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?").get(q.table) as { name: string } | undefined
      if (!t) throw new Error(`no table ${q.table}`)
      const cols = (d.prepare(`SELECT name FROM pragma_table_info(?)`).all(t.name) as { name: string }[]).map(c => c.name)
      const words = q.filter?.trim()
      const where = words && cols.length ? ` WHERE ${cols.map(c => `CAST(${name(c)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')}` : ''
      const like = `%${(words ?? '').replace(/[\\%_]/g, m => `\\${m}`)}%`
      const sort = q.sort && cols.includes(q.sort) ? ` ORDER BY ${name(q.sort)} ${q.desc ? 'DESC' : 'ASC'}` : ''
      const got = rowsOf(d.prepare(`SELECT * FROM ${name(t.name)}${where}${sort} LIMIT ${DB_ROWS + 1}`).iterate(...(where ? cols.map(() => like) : [])), DB_ROWS)
      return { ...got, cols: got.rows.length ? got.cols : cols }
    }
    const sql = q.sql.trim().replace(/;\s*$/, '')
    if (!/^(select|with)\b/i.test(sql)) throw new Error('a query here is a SELECT (or WITH … SELECT): nothing that changes the database')
    const st = d.prepare(sql)
    if (st.sourceSQL.trim().replace(/;\s*$/, '').length < sql.length) throw new Error('one statement at a time') // more after the first: never run
    return rowsOf(st.iterate(), DB_QUERY_ROWS)
  } finally {
    d.close()
  }
}
