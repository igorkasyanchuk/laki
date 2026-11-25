// #1: a SQLite database in Files (daemon/db.ts, its worker through files.ts): tables, rows, schema, a read-only query
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { dbRead, DB_ROWS } from '../src/daemon/db.ts'
import { fresh } from './helpers.ts'

const make = (file: string) => {
  const d = new DatabaseSync(file)
  d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, note TEXT, pic BLOB); CREATE INDEX users_email ON users (email);
    CREATE TABLE "odd ""name""" (x); CREATE VIEW recent AS SELECT * FROM users WHERE id > 200;`)
  const add = d.prepare('INSERT INTO users (email, note, pic) VALUES (?, ?, ?)')
  for (let i = 1; i <= 250; i++) add.run(`u${i}@example.com`, i % 50 ? `note ${i}` : null, i === 3 ? Buffer.from('abc') : null)
  d.close()
}

test('db: tables with their rows and schema; a table sorted and filtered; SELECT only, read-only', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'laki-db-')), 'dev.sqlite3')
  make(file)
  const { tables } = dbRead(file, { op: 'tables' }) as { tables: any[] }
  assert.deepEqual(tables.map(t => [t.name, t.kind, t.rows]), [['odd "name"', 'table', 0], ['recent', 'view', undefined], ['users', 'table', 250]])
  assert.match(tables[2].sql, /CREATE TABLE users[\s\S]*;\n\nCREATE INDEX users_email/)
  let r = dbRead(file, { op: 'rows', table: 'users' }) as any
  assert.deepEqual(r.cols, ['id', 'email', 'note', 'pic'])
  assert.equal(r.rows.length, DB_ROWS)
  assert.equal(r.cut, true)
  assert.deepEqual(r.rows[2], ['3', 'u3@example.com', 'note 3', '(blob, 3 bytes)'])
  r = dbRead(file, { op: 'rows', table: 'users', sort: 'id', desc: true, filter: 'u25' }) as any
  assert.deepEqual(r.rows.map((x: string[]) => x[0]), ['250', '25'])
  assert.equal(r.cut, undefined)
  r = dbRead(file, { op: 'rows', table: 'users', filter: '50%' }) as any // % and _ are the words', not wildcards
  assert.deepEqual(r.rows, [])
  assert.equal((dbRead(file, { op: 'rows', table: 'users', sort: 'id; DROP TABLE users' }) as any).rows[0][0], '1', 'a column it has, else no sort')
  assert.deepEqual((dbRead(file, { op: 'rows', table: 'odd "name"' }) as any).cols, ['x'])
  assert.throws(() => dbRead(file, { op: 'rows', table: 'nope' }), /no table nope/)
  r = dbRead(file, { op: 'query', sql: 'SELECT count(*) AS n, max(id) AS top FROM users WHERE note IS NULL;' }) as any
  assert.deepEqual([r.cols, r.rows], [['n', 'top'], [['5', '250']]])
  assert.throws(() => dbRead(file, { op: 'query', sql: 'DELETE FROM users' }), /a SELECT/)
  assert.throws(() => dbRead(file, { op: 'query', sql: 'SELECT 1; DELETE FROM users' }), /one statement/)
  assert.deepEqual((dbRead(file, { op: 'query', sql: "SELECT 'a;b' AS x;" }) as any).rows, [['a;b']], 'a ; in a string is one statement')
  assert.throws(() => dbRead(file, { op: 'query', sql: 'WITH x AS (SELECT 1) INSERT INTO users (email) SELECT * FROM x' }), /readonly|read-only|attempt to write/i)
  assert.equal((dbRead(file, { op: 'tables' }) as any).tables[2].rows, 250, 'nothing written')
  // a WAL database is read through a clone: its folder keeps no -shm or -wal of Laki's
  const dir = mkdtempSync(join(tmpdir(), 'laki-wal-'))
  const wal = join(dir, 'app.db')
  const w = new DatabaseSync(wal)
  w.exec('PRAGMA journal_mode=WAL; CREATE TABLE t (x); INSERT INTO t VALUES (1)')
  w.close()
  const tmp = mkdtempSync(join(tmpdir(), 'laki-db-'))
  assert.deepEqual((dbRead(wal, { op: 'query', sql: 'SELECT x FROM t' }, tmp) as any).rows, [['1']])
  assert.deepEqual(readdirSync(dir), ['app.db'])
})

test('db: Files gives a database its tables, and dbRead its rows, through the worker; a .db that is not one is a file', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'shell' })
  make(join(ws.path, 'dev.sqlite3'))
  writeFileSync(join(ws.path, 'notes.db'), 'just text')
  const f = await rig.rpc('fileRead', { ws: ws.id, path: 'dev.sqlite3' })
  assert.deepEqual(f.db.tables.map((x: any) => x.name), ['odd "name"', 'recent', 'users'])
  const r = await rig.rpc('dbRead', { ws: ws.id, path: 'dev.sqlite3', op: 'rows', table: 'users', sort: 'id', desc: true })
  assert.equal(r.rows[0][1], 'u250@example.com')
  await assert.rejects(rig.rpc('dbRead', { ws: ws.id, path: 'dev.sqlite3', op: 'query', sql: 'DROP TABLE users' }), /a SELECT/)
  await assert.rejects(rig.rpc('dbRead', { ws: ws.id, path: 'notes.db' }), /isn't a SQLite database/)
  await assert.rejects(rig.rpc('dbRead', { ws: ws.id, path: '../../etc/x.db' }), /outside|not in|inside/i)
  assert.equal((await rig.rpc('fileRead', { ws: ws.id, path: 'notes.db' })).text, 'just text')
})
