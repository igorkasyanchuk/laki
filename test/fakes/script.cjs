// FAKE_SCRIPT=<file> (scripts/demo.ts sets it, for the README's stills; not LAKI_…, which the daemon keeps from tabs): a
// fake agent's words in the look of the real one's instead of its echo. The file: { "<workspace id or its folder's name>": {
// "lines": [...], "summary": "..." }, "*": … }. Unset (every test): undefined, the fakes as ever; set without an entry for
// this folder: {}, the real one's banner only
module.exports = () => {
  if (!process.env.FAKE_SCRIPT) return undefined
  try {
    const all = JSON.parse(require('fs').readFileSync(process.env.FAKE_SCRIPT, 'utf8'))
    return all[process.env.LAKI_WORKSPACE] ?? all[require('path').basename(process.cwd())] ?? all['*'] ?? {}
  } catch {
    return {}
  }
}
