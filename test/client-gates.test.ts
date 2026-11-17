// T1: which methods a trusted client may call, given its scopes (gates.ts clientMethod), over every method of api (the
// agent gate's three classes are all of them, main.ts checks so as it loads): the reads always, a scope's methods only
// with it, anything else never. No daemon: test:fast
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENT_NO, AGENT_OK, AGENT_OWN, CLIENT_READ, CLIENT_SCOPE, CLIENT_WS, clientMethod } from '../src/daemon/gates.ts'
import { SCOPES } from '../src/daemon/clients.ts'

const methods = [...Object.keys(AGENT_NO), ...AGENT_OWN, ...AGENT_OK]
const scopes = Object.keys(CLIENT_SCOPE)

test("T1: a client's methods: the reads, its scopes' own, nothing else even with every scope", () => {
  assert.ok(methods.length > 250, 'every method read')
  assert.deepEqual([...scopes].sort(), Object.keys(SCOPES).sort(), 'one list of scopes')
  for (const m of [...CLIENT_READ, ...Object.values(CLIENT_SCOPE).flat()]) assert.ok(methods.includes(m), `${m} is a method`)
  const theirs = new Set([...CLIENT_READ, ...Object.values(CLIENT_SCOPE).flat()])
  for (const m of methods) {
    if (theirs.has(m)) assert.equal(clientMethod(m, scopes), undefined, m)
    else assert.deepEqual(clientMethod(m, scopes), { scope: undefined }, `${m}: no client's`)
  }
  for (const m of CLIENT_READ) assert.equal(clientMethod(m, []), undefined, `${m}: a read, no scope`)
  // each scope's methods: with it alone, yes; with every other one, no, naming it
  for (const [s, ms] of Object.entries(CLIENT_SCOPE))
    for (const m of ms) {
      assert.equal(clientMethod(m, [s]), undefined, `${m} with ${s}`)
      assert.deepEqual(clientMethod(m, scopes.filter(x => x !== s)), { scope: s }, `${m} without ${s}`)
    }
  // a client starts from what an agent may do: none of the user's alone (AGENT_NO) in any scope
  assert.deepEqual([...theirs].filter(m => Object.hasOwn(AGENT_NO, m)), [], 'none of the user-only methods')
  // each says which parameter names its workspace (the daemon throws as it loads otherwise), and only those
  assert.deepEqual([...theirs].filter(m => !Object.hasOwn(CLIENT_WS, m)), [], 'in CLIENT_WS')
  assert.deepEqual(Object.keys(CLIENT_WS).filter(m => !theirs.has(m)), [], "CLIENT_WS: a client's methods only")
  assert.deepEqual(clientMethod('clientAdd', scopes), { scope: undefined })
  assert.deepEqual(clientMethod('nope', scopes), { scope: undefined }, 'an unknown name: no')
})
