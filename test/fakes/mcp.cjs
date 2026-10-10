// the fake claude -p's and codex exec's MCP client: starts the server they were given and calls one tool
const { spawn } = require('child_process')
module.exports = (server, name, args) =>
  new Promise((resolve, reject) => {
    const c = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] })
    let buf = ''
    c.on('error', reject)
    c.stdout.on('data', d => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const l of lines) {
        const m = JSON.parse(l)
        if (m.id === 2) (c.stdin.end(), resolve(m.result.content[0].text))
      }
    })
    const send = o => c.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n')
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    send({ id: 2, method: 'tools/call', params: { name, arguments: args } })
  })
