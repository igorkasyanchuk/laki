// npm run dmg, after the version bump: the release notes' "## Next" becomes that version and today's date
import { readFileSync, writeFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const file = 'docs/release-notes.md'
const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const text = readFileSync(file, 'utf8')
if (/^## Next$/m.test(text)) writeFileSync(file, text.replace(/^## Next$/m, `## ${version} · ${date}`))
else console.log(`${file}: no "## Next" to stamp`)
