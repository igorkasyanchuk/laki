// The numbers the docs state, kept true: AGENTS.md's API range and achievements count, docs/api-history.md's last entry,
// and the themes count in docs/features.md and docs/guide.md (no daemon: in test:fast)
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { AGENT_SETTINGS_NO, AGENT_SETTINGS_OK, REMOTE_KEYS } from '../src/daemon/gates.ts'
import { THEMES } from '../src/renderer/src/themes.ts'
import { ACHIEVEMENTS } from '../src/shared/achievements.ts'
import { API } from '../src/shared/types.ts'

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test("the docs' numbers: API's range and last entry, the achievements, the themes", () => {
  const agents = read('AGENTS.md')
  assert.equal(Number(/what each `API` number added, 1 to (\d+)/.exec(agents)?.[1]), API, 'AGENTS.md: "1 to N" is src/shared/types.ts API')
  const last = read('docs/api-history.md').trimEnd().split('\n').reverse().find(l => /^\d+: /.test(l))
  assert.equal(Number(last?.split(':')[0]), API, "docs/api-history.md's last entry is API")
  assert.equal(Number(/the achievements \((\d+)\)/.exec(agents)?.[1]), ACHIEVEMENTS.length, 'AGENTS.md: achievements (N)')
  const looks = THEMES.filter(t => t.look).length
  assert.match(read('docs/features.md'), new RegExp(`\\b${THEMES.length} themes, ${looks} of which`), 'docs/features.md: N themes, M of which change shapes')
  assert.match(read('docs/guide.md'), new RegExp(`\\b${THEMES.length} themes\\b`), 'docs/guide.md: N themes')
})

// type holes: ": any" and "as any" in src, counted with one regex, never above test/any-baseline.txt
test('no more any in src than test/any-baseline.txt', () => {
  const src = new URL('../src/', import.meta.url).pathname
  let n = 0
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f)) n += readFileSync(p, 'utf8').match(/:\s*any\b|\bas\s+any\b/g)?.length ?? 0
    }
  }
  walk(src)
  const base = Number(read('test/any-baseline.txt').trim())
  assert.ok(n <= base, `${n} ": any" or "as any" in src, the baseline ${base}: remove the any you added (a real type, unknown, a narrower one), or raise test/any-baseline.txt to ${n} on purpose in the same commit`)
})

// T14: the api table's handlers whose params are typed ((p: In<typeof fn>), or a shape of their own): their calls get
// params and results checked. Never fewer than this floor (raise it as more are typed; lower it only on purpose)
const TYPED_MIN = 49
test(`main.ts' api: ${TYPED_MIN} handlers with typed params at least`, () => {
  const table = read('src/daemon/main.ts').split('\nconst api = {')[1].split('\n} satisfies Record<string, Handler>')[0]
  const n = table.match(/^  \w+: (async )?\(p: (In<typeof [\w.]+>|\{[^}]*\})\) =>/gm)?.length ?? 0
  assert.ok(n >= TYPED_MIN, `${n} handlers with typed params, the floor ${TYPED_MIN}: type the params of the one you changed (p: In<typeof fn>), or lower TYPED_MIN on purpose`)
})

// T14: a daemon call by a name made at run time (conn.ts rpcAny, the window's callAny) skips the typecheck's name and
// params: kept to the few that must, never above this ceiling (lower it as they go; raise it only on purpose)
const RPC_ANY_MAX = 10
test(`rpcAny and callAny: ${RPC_ANY_MAX} uses at most`, () => {
  const src = new URL('../src/', import.meta.url).pathname
  const own = new Set(['shared/conn.ts', 'renderer/src/api.ts', 'shared/api.ts']) // where they're made and said
  let n = 0
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f) && !own.has(p.slice(src.length))) n += readFileSync(p, 'utf8').match(/\b(rpcAny|callAny)\b/g)?.length ?? 0
    }
  }
  walk(src)
  assert.ok(n <= RPC_ANY_MAX, `${n} uses of rpcAny or callAny in src, the ceiling ${RPC_ANY_MAX}: call rpc or call by a name the typecheck knows, or raise RPC_ANY_MAX on purpose`)
})

// SECURITY.md's paragraph on what settings an agent can change, by their names in Settings, against gates.ts
const CAN: Record<string, string[]> = { 'the theme': ['theme'], fonts: ['fontFamily', 'fontSize', 'uiFont'], 'the accent': ['accent'], corners: ['radius'], density: ['density'], glass: ['glass'], icons: ['iconPack'], "the sidebar's rows": ['sideStyle', 'rowMarks'], 'the rail': ['railOrder', 'railHide'], 'where the tabs are': ['tabsAt'], 'the status bar': ['statusBar'], 'saved layouts': ['layouts'], "the Reader's switch": ['reader'] }
const CANT: Record<string, string[]> = { 'Global memory': ['memory'], "workflows' variables": ['flowVars'], 'where storage folders and worktrees go': ['storageDir', 'worktrees'], notifications: ['notify', 'notifyOn'], env: ['env'], profiles: ['presets'], 'the phone webhook': ['webhook'], 'extension folders': ['widgetDirs', 'widgetDev'], 'PR prompts': ['prPrompts'], actions: ['actions'], 'prompt templates': ['templates'], "Laki AI's": ['ai', 'aiEndpoint'], voice: ['voice'], keys: ['keys', 'cmdKeys'], '*When everything is done*': ['whenDone'], 'the Done check': ['doneCheck'], 'Recording mode': ['recording'], '*Guess my next prompt*': ['nextPrompt'], 'keep awake': ['keepAwake'], 'how long storage files, archived workspaces and pasted images are kept': ['storageDays', 'archivedDays', 'imageDays'], "memory's compaction": ['memoryCompact'], updates: ['updateCheck', 'updateDelay'], 'the background picture': ['background'] }
test("SECURITY.md: the settings it says an agent can and can't change are gates.ts'", () => {
  const para = /- An agent can change only ([\s\S]*?)\n- /.exec(read('SECURITY.md'))?.[1].replace(/\s+/g, ' ') ?? ''
  const [can, cant] = para.split('Every other setting is yours')
  assert.ok(cant, "SECURITY.md: the paragraph's two halves")
  for (const [name, keys] of Object.entries(CAN)) {
    assert.ok(can.includes(name), `SECURITY.md says an agent can change ${name}`)
    for (const k of keys) assert.ok(AGENT_SETTINGS_OK.has(k) && !AGENT_SETTINGS_NO.has(k) && !REMOTE_KEYS.test(k), `${name}: ${k} is an agent's (AGENT_SETTINGS_OK)`)
  }
  for (const [name, keys] of Object.entries(CANT)) {
    assert.ok(cant.includes(name), `SECURITY.md says an agent can't change ${name}`)
    for (const k of keys) assert.ok(!AGENT_SETTINGS_OK.has(k) && (AGENT_SETTINGS_NO.has(k) || REMOTE_KEYS.test(k)), `${name}: ${k} is the user's`)
  }
})
