// The header's fun button (daemon/fun.ts): a meme from Reddit, else its mirror, never NSFW, the picture as a data: URL.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { fresh } from './helpers.ts'

test('a meme: Reddit first (NSFW skipped), the mirror when Reddit says no, an error when neither has one', async t => {
  let reddit = 200
  let mirror = true
  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const json = (b: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(b))
    const post = (title: string, file: string, o = {}) => ({ data: { title, url: `${base}/${file}`, permalink: `/r/memes/comments/${file}`, author: 'ann', ...o } })
    if (req.url === '/r/memes/random.json')
      return reddit === 200 ? json([{ data: { children: [post('nope', 'x.png', { over_18: true }), post('Monday', 'a.png')] } }]) : res.writeHead(reddit, { 'content-type': 'text/html' }).end('<body>blocked</body>')
    if (req.url === '/gimme/memes') return json(mirror ? { title: 'Friday', postLink: 'https://redd.it/b', url: `${base}/b.gif`, nsfw: false, author: 'bob' } : { title: 'x', url: `${base}/b.gif`, nsfw: true })
    if (req.url === '/a.png' || req.url === '/b.gif') return res.writeHead(200, { 'content-type': req.url.endsWith('png') ? 'image/png' : 'image/gif' }).end(Buffer.from('pic'))
    res.writeHead(404).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => void server.close())
  const rig = await fresh(t, { env: { LAKI_MEME_API: `http://127.0.0.1:${(server.address() as { port: number }).port}` } })
  assert.deepEqual(await rig.rpc('meme'), { title: 'Monday', link: 'https://www.reddit.com/r/memes/comments/a.png', by: 'ann', image: `data:image/png;base64,${Buffer.from('pic').toString('base64')}` })
  reddit = 403
  assert.deepEqual(await rig.rpc('meme'), { title: 'Friday', link: 'https://redd.it/b', by: 'bob', image: `data:image/gif;base64,${Buffer.from('pic').toString('base64')}` })
  mirror = false
  await assert.rejects(rig.rpc('meme'), /no meme this time/)
})
