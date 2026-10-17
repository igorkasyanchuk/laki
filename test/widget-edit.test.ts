// An extension's files edited by hand (its page's Files: widgetFileSave) and its made-up variants (fixtures/<name>.json:
// every starter's three more, My PRs' too; widgetRender's sample by name, the view's fixtures)
import { strict as assert } from 'node:assert'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { STARTER_KINDS } from '../src/shared/widgetStarters.ts'
import { fresh, until } from './helpers.ts'

const find = async (rig: any, id: string) => ((await rig.rpc('state')).widgets ?? []).find((w: any) => w.id === id)

test('files edited by hand: saved in place, read again; refused when changed meanwhile, not JSON, or built in', async t => {
  const rig = await fresh(t)
  const { id } = await rig.rpc('widgetNew', { kind: 'number', name: 'Visits' })
  await until(async () => !(await find(rig, id)).running, 'its first fetch')
  const dir = join(rig.data, 'widgets', id)
  const { files } = await rig.rpc('widgetFiles', { id })
  const was = files['widget.json']
  const mode = statSync(join(dir, 'fetch.sh')).mode

  const text = was.replace('"visits today"', '"people today"')
  await rig.rpc('widgetFileSave', { id, path: 'widget.json', text, was })
  assert.equal(readFileSync(join(dir, 'widget.json'), 'utf8'), text)
  assert.match(await rig.rpc('widgetRender', { id }), /people today/, 'read again at once')

  await assert.rejects(rig.rpc('widgetFileSave', { id, path: 'widget.json', text, was }), /changed since you opened it/)
  await rig.rpc('widgetFileSave', { id, path: 'widget.json', text: text.replace('people', 'folks'), was, force: true })
  assert.match(await rig.rpc('widgetRender', { id }), /folks today/, 'Save anyway')
  const now = readFileSync(join(dir, 'widget.json'), 'utf8')
  await assert.rejects(rig.rpc('widgetFileSave', { id, path: 'widget.json', text: '{ broken', was: now }), /not JSON/)
  await assert.rejects(rig.rpc('widgetFileSave', { id, path: 'widget.json', text: '[]', was: now }), /an object/)
  await assert.rejects(rig.rpc('widgetFileSave', { id, path: 'fixtures/spike.json', text: 'nope', was: readFileSync(join(dir, 'fixtures/spike.json'), 'utf8') }), /not JSON/)
  await assert.rejects(rig.rpc('widgetFileSave', { id, path: '../../state.json', text: '{}' }), /not one of its files/)
  await assert.rejects(rig.rpc('widgetFileSave', { id, path: 'new.sh', text: 'echo' }), /not one of its files/)
  await assert.rejects(rig.rpc('widgetFileSave', { id: 'my-prs', path: 'widget.json', text: '{}' }), /comes with Laki: Remix/)

  // a script keeps its mode; a fixture edited shows as its sample
  const sh = readFileSync(join(dir, 'fetch.sh'), 'utf8')
  await rig.rpc('widgetFileSave', { id, path: 'fetch.sh', text: `${sh}# edited\n`, was: sh })
  assert.equal(statSync(join(dir, 'fetch.sh')).mode, mode)
  const fx = readFileSync(join(dir, 'fixtures/flat.json'), 'utf8')
  await rig.rpc('widgetFileSave', { id, path: 'fixtures/flat.json', text: JSON.stringify({ visits: 777, change: '0%', week: [1, 1] }), was: fx })
  assert.match(await rig.rpc('widgetRender', { id, sample: 'flat' }), />777</)
})

test('made-up variants: each starter with data has three more fixtures, My PRs too; a preview shows one by name', async t => {
  const rig = await fresh(t)
  for (const kind of STARTER_KINDS) {
    if (kind === 'launcher' || kind === 'onefile') continue // no data of its own, one file
    const { id } = await rig.rpc('widgetNew', { kind, name: `v ${kind}` })
    const w = await find(rig, id)
    const more = (w.fixtures ?? []).filter((f: string) => f !== 'sample' && f !== 'empty')
    assert.ok(more.length >= 3, `${kind}: ${w.fixtures}`)
    for (const f of w.fixtures) {
      const r = await rig.rpc('widgetRender', { id, sample: f })
      assert.ok(r === null ? w.button : typeof r === 'string', `${kind}: ${f}`) // a button: no view, its face only
    }
  }
  const prs = await find(rig, 'my-prs')
  assert.deepEqual(prs.fixtures, ['busy', 'clean', 'none', 'sample'])
  assert.match(await rig.rpc('widgetRender', { id: 'my-prs', sample: 'busy' }), /<div class="k-v">14<\/div>/)
  assert.match(await rig.rpc('widgetRender', { id: 'my-prs', sample: 'none', full: true }), /No open PRs/)
  await assert.rejects(rig.rpc('widgetRender', { id: 'my-prs', sample: 'nope' }), /no fixtures\/nope.json/)
  // the check fits the ui to each of them
  const check = await rig.cli('widget', 'check', 'my-prs', '--no-run')
  assert.doesNotMatch(check.out, /✗/)
})
