// The header's fun button (daemon/fun.ts): a meme from Reddit, else its mirror, never NSFW, the picture as a data: URL.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

test('a meme: Reddit first (NSFW skipped), not one shown already, the mirror when Reddit says no, an error when neither has one', async t => {
  let reddit = 200
  let mirror = true
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const json = (b: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(b))
    const post = (title: string, file: string, o = {}) => ({ data: { title, url: `${base}/${file}`, permalink: `/r/memes/comments/${file}`, author: 'ann', ...o } })
    const hot = req.url?.match(/^\/r\/(\w+)\/hot\.json\?limit=100&raw_json=1$/)?.[1]
    const gimme = req.url?.match(/^\/gimme\/(\w+)\/50$/)?.[1]
    // only r/memes has pictures: the other subreddits' lists are empty (or a gallery, which isn't one)
    if (hot && reddit !== 200) return res.writeHead(reddit, { 'content-type': 'text/html' }).end('<body>blocked</body>')
    if (hot) return json({ data: { children: hot === 'memes' ? [post('nope', 'x.png', { over_18: true }), post('pinned', 'p.png', { stickied: true }), post('Monday', 'a.png'), post('Tuesday', 'c.png')] : [post('album', 'gallery/1')] } })
    if (gimme) return json({ memes: gimme === 'memes' ? [mirror ? { title: 'Friday', postLink: 'https://redd.it/b', url: `${base}/b.gif`, nsfw: false, author: 'bob' } : { title: 'x', url: `${base}/b.gif`, nsfw: true }] : [] })
    if (['/a.png', '/b.gif', '/c.png'].includes(req.url!)) return res.writeHead(200, { 'content-type': req.url!.endsWith('gif') ? 'image/gif' : 'image/png' }).end(Buffer.from('pic'))
    res.writeHead(404).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const rig = await fresh(t, { env: { LAKI_MEME_API: `http://127.0.0.1:${(server.address() as { port: number }).port}` } })
  const png = `data:image/png;base64,${Buffer.from('pic').toString('base64')}`
  const two = [await rig.rpc('meme'), await rig.rpc('meme')].sort((a, b) => a.title.localeCompare(b.title))
  assert.deepEqual(two, [
    { title: 'Monday', link: 'https://www.reddit.com/r/memes/comments/a.png', by: 'ann', sub: 'memes', image: png },
    { title: 'Tuesday', link: 'https://www.reddit.com/r/memes/comments/c.png', by: 'ann', sub: 'memes', image: png },
  ]) // not the same one twice
  reddit = 403 // both shown: fetched again, from the mirror now
  assert.deepEqual(await rig.rpc('meme'), { title: 'Friday', link: 'https://redd.it/b', by: 'bob', sub: 'memes', image: `data:image/gif;base64,${Buffer.from('pic').toString('base64')}` })
  mirror = false
  await assert.rejects(rig.rpc('meme'), /no meme this time/)
})

test('a meme\'s picture: one redirected off https, or past 8 MB without saying so, is skipped', async t => {
  let big = true
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const json = (b: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(b))
    const post = (title: string, file: string) => ({ data: { title, url: `${base}/${file}`, permalink: `/r/memes/comments/${file}`, author: 'ann' } })
    const hot = req.url?.match(/^\/r\/(\w+)\/hot\.json/)?.[1]
    if (hot) return json({ data: { children: hot === 'memes' ? [post('moved', 'm.png'), post('big', 'b.png')] : [] } })
    if (req.url?.startsWith('/gimme/')) return json({ memes: [] })
    if (req.url === '/m.png') return res.writeHead(302, { location: `http://localhost:${(server.address() as { port: number }).port}/ok.png` }).end() // not the fake's own: as if plain http
    if (req.url === '/b.png') {
      if (!big) return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from('pic'))
      res.writeHead(200, { 'content-type': 'image/png' }) // chunked: no content-length
      const mb = Buffer.alloc(1 << 20)
      for (let i = 0; i < 9; i++) res.write(mb)
      return res.end()
    }
    if (req.url === '/ok.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from('pic'))
    res.writeHead(404).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const rig = await fresh(t, { env: { LAKI_MEME_API: `http://127.0.0.1:${(server.address() as { port: number }).port}` } })
  await assert.rejects(rig.rpc('meme'), /no meme this time/)
  big = false
  assert.equal((await rig.rpc('meme')).title, 'big')
})
