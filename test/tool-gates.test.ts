// Tool gates: an extension's action with gate "tool" sees each tool call claude is about to make (its PreToolUse hook),
// in turn and within 3 s: {"ok": false, "why"} denies it, {"input": …} changes it (claude asks you, Laki never grants);
// an error or a timeout lets it go. The hook (src/cli/hook.ts) waits only while the tool-gates file says one is on, and
// prints claude's JSON. The tool.call event goes to extensions' on (never a workflow's start)
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { check } from '../src/shared/workflow.ts'
import { fresh, until } from './helpers.ts'

const make = (rig: any, id: string, m: object) => {
  mkdirSync(join(rig.data, 'widgets', id), { recursive: true })
  writeFileSync(join(rig.data, 'widgets', id, 'widget.json'), JSON.stringify(m))
}
const pre = (tool: string, input: object) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input })
// the hook as claude runs it: the payload on stdin, what it prints
const hookRun = (rig: any, tab: string, payload: object) =>
  new Promise<{ out: string; ms: number }>(done => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const t0 = Date.now()
    const p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(root, 'src/cli/hook.ts'), 'hook', 'running'], { env: { ...rig.env, LAKI_TAB: tab } })
    let out = ''
    p.stdout.on('data', d => (out += d))
    p.on('exit', () => done({ out, ms: Date.now() - t0 }))
    p.stdin.end(JSON.stringify(payload))
  })

test('tool gates: a no denies the call, a changed input is asked of you, the rest goes; the hook prints it, and waits only while one is on', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => await rig.tab(ws.id), 'its tab')
  const flag = join(rig.data, 'tool-gates')
  // none on: no flag, nothing printed, the hook as quick as before
  assert.equal((await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Bash', { command: 'ls' }) })) ?? null, null)
  assert.ok(!existsSync(flag))
  const plain = await hookRun(rig, tab.id, pre('Bash', { command: 'ls' }))
  assert.equal(plain.out, '')

  // rm -rf refused, git push gets --dry-run, the rest goes; a second gate sees the first's change
  make(rig, 'guard', { name: 'Guard', actions: { check: { run: `node -e 'const e=JSON.parse(require("fs").readFileSync(0,"utf8")); require("fs").writeFileSync(process.env.HOME+"/guard.in", JSON.stringify(e)); const c=e.input.command||""; console.log(JSON.stringify(/rm -rf/.test(c)?{ok:false,why:"no rm -rf here"}:/^git push/.test(c)?{input:{...e.input,command:c+" --dry-run"}}:{ok:true}))'`, gate: ['tool'] } } })
  make(rig, 'second', { name: 'Second', actions: { see: { run: `cat > "$HOME/second.in"; echo '{"ok": true}'`, gate: ['tool'] } } })
  await rig.rpc('widgetReload')
  for (const id of ['guard', 'second']) await rig.rpc('widgetSet', { id, on: true })
  assert.ok(existsSync(flag), 'the flag: the hook waits')
  assert.deepEqual((await rig.rpc('state')).widgets.find((w: any) => w.id === 'guard').gates, ['tool'])
  assert.match((await rig.rpc('widgetWhat', { id: 'guard' })).text, /It sees each tool call Claude makes/)

  const no = await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Bash', { command: 'rm -rf build' }) })
  assert.deepEqual(no, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Guard: no rm -rf here' } })
  const got = JSON.parse(readFileSync(join(rig.env.HOME, 'guard.in'), 'utf8'))
  assert.deepEqual([got.gate, got.tool, got.input, got.ws.id, got.tab.id, got.tab.agent], ['tool', 'Bash', { command: 'rm -rf build' }, ws.id, tab.id, 'claude'])

  const changed = await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Bash', { command: 'git push', description: 'push' }) })
  assert.deepEqual(changed.hookSpecificOutput.updatedInput, { command: 'git push --dry-run', description: 'push' })
  assert.equal(changed.hookSpecificOutput.permissionDecision, 'ask', 'a change is asked of you: never allowed for you')
  assert.equal(JSON.parse(readFileSync(join(rig.env.HOME, 'second.in'), 'utf8')).input.command, 'git push --dry-run')
  assert.equal((await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Read', { file_path: '/x' }) })) ?? null, null, 'ok: goes')
  assert.equal((await rig.rpc('hook', { tab: tab.id, state: 'running', payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } } })) ?? null, null, 'after the fact: no gate')

  // past 1 MB: the gates see it cut, can still refuse it, never change it
  const pad = ` # ${'x'.repeat(2 << 20)}`
  const bigNo = await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Bash', { command: `rm -rf build${pad}` }) })
  assert.equal(bigNo.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(JSON.parse(readFileSync(join(rig.env.HOME, 'guard.in'), 'utf8')).input.command, /^rm -rf build # x+… \(cut\)$/)
  assert.equal((await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Bash', { command: `git push${pad}` }) })) ?? null, null, 'a change to a cut input: not taken')

  // the hook itself: claude's JSON on stdout
  const h = await hookRun(rig, tab.id, pre('Bash', { command: 'rm -rf /' }))
  assert.equal(JSON.parse(h.out).hookSpecificOutput.permissionDecision, 'deny')

  // a gate that hangs: the call goes after 3 s, the run logged
  make(rig, 'slow', { name: 'Slow', actions: { wait: { run: 'sleep 10', gate: ['tool'] } } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'slow', on: true })
  await rig.rpc('widgetSet', { id: 'guard', on: false })
  await rig.rpc('widgetSet', { id: 'second', on: false })
  const t0 = Date.now()
  assert.equal((await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Bash', { command: 'rm -rf build' }) })) ?? null, null)
  assert.ok(Date.now() - t0 < 4500, `${Date.now() - t0} ms`)
  const slow = await hookRun(rig, tab.id, pre('Bash', { command: 'ls' }))
  assert.equal(slow.out, '')
  assert.ok(slow.ms < 5000, `the hook: ${slow.ms} ms`)

  // all off: the flag goes
  await rig.rpc('widgetSet', { id: 'slow', on: false })
  assert.ok(!existsSync(flag))
})

test('tool gates: tool.call reaches an extension\'s on; a workflow never starts on it', async t => {
  const rig = await fresh(t)
  const p = await rig.rpc('projectAdd', { path: rig.repo })
  const ws = await rig.rpc('wsNew', { project: p.id, preset: 'claude' })
  const tab = await until(async () => await rig.tab(ws.id), 'its tab')
  make(rig, 'watch', { name: 'Watch', on: { 'tool.call': 'seen' }, actions: { seen: `cat >> "$HOME/calls.jsonl"; echo >> "$HOME/calls.jsonl"` } })
  await rig.rpc('widgetReload')
  await rig.rpc('widgetSet', { id: 'watch', on: true })
  await rig.rpc('hook', { tab: tab.id, state: 'running', payload: pre('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }) })
  const e = await until(() => (f => existsSync(f) && JSON.parse(readFileSync(f, 'utf8').trim().split('\n')[0]))(join(rig.env.HOME, 'calls.jsonl')), 'tool.call')
  assert.deepEqual([e.event, e.tool, e.input.file_path, e.ws.id, e.tab.id], ['tool.call', 'Edit', 'a.ts', ws.id, tab.id])
  assert.match(check({ id: 'x', name: 'x', where: 'worktree', session: 'new', on: 'tool.call', blocks: [{ id: 'start', kind: 'start', to: { next: 'done' } }, { id: 'done', kind: 'end', result: 'success' }] } as any).join('\n'), /on: tool\.call: every tool call/)
})
