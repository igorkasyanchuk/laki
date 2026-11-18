// Ready-made setups for trusted clients (laki client add <name> --for <recipe>, laki client show <name> --for <recipe>,
// Settings › Security › Trusted clients' Copy config for…): each with the narrowest scopes that make it useful (reads
// only for a status script; create and send for an assistant; never cmd, yolo, remove or ship) and what to paste where,
// with real paths. Every snippet names the token's file (LAKI_CLIENT_TOKEN_FILE), never the token. Pure: no file is
// written here (the CLI saves files only into a folder you name: --write <dir>)
export type RecipeCtx = { tokenFile: string; lakiBin: string; name: string; home?: string }
export type RecipeOut = { files?: { suggestedPath: string; content: string }[]; snippet: string; steps: string[] }
export type Recipe = { title: string; scopes: ('create' | 'send')[]; make: (c: RecipeCtx) => RecipeOut }

// a word a shell takes as it is: in single quotes, a ' inside as '\''
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client'

export const RECIPES: Record<string, Recipe> = {
  mcp: {
    title: 'An MCP client (Claude Desktop, Cursor, …): Laki as its tools',
    scopes: ['create', 'send'],
    make: c => ({
      snippet: JSON.stringify({ mcpServers: { laki: { command: c.lakiBin, args: ['mcp'], env: { LAKI_CLIENT_TOKEN_FILE: c.tokenFile } } } }, null, 2),
      steps: ["Open the MCP client's config (Claude Desktop: Settings › Developer › Edit Config)", 'Add the "laki" entry under its mcpServers (keep the ones there)', 'Restart the client: its tools list has laki_* now'],
    }),
  },
  raycast: {
    title: 'A Raycast script command: a new Laki task from Raycast',
    scopes: ['create'],
    make: c => {
      const path = `${c.home ?? '~'}/raycast-scripts/laki-new.sh`
      const content = [
        '#!/bin/bash',
        '# Required parameters:',
        '# @raycast.schemaVersion 1',
        '# @raycast.title New Laki task',
        '# @raycast.mode silent',
        '# Optional parameters:',
        '# @raycast.packageName Laki',
        '# @raycast.argument1 { "type": "text", "placeholder": "project" }',
        '# @raycast.argument2 { "type": "text", "placeholder": "what to do" }',
        `export LAKI_CLIENT_TOKEN_FILE=${shq(c.tokenFile)}`,
        `exec ${shq(c.lakiBin)} new "$1" --prompt "$2"`,
        '',
      ].join('\n')
      return { files: [{ suggestedPath: path, content }], snippet: content, steps: [`Save it as ${path} and make it runnable: chmod +x ${shq(path)}`, 'In Raycast: Settings › Extensions › Script Commands › Add Directories, that folder', 'Type "New Laki task", a project and what to do'] }
    },
  },
  launchd: {
    title: 'A launchd job: a script of yours every day at 9',
    scopes: ['create'],
    make: c => {
      const id = slug(c.name)
      const home = c.home ?? '~'
      const script = `${home}/bin/laki-${id}.sh`
      const plist = `${home}/Library/LaunchAgents/sh.laki.${id}.plist`
      const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>sh.laki.${xml(id)}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(script)}</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LAKI_CLIENT_TOKEN_FILE</key><string>${xml(c.tokenFile)}</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
`
      const body = `#!/bin/sh\n# runs daily at 9 (${plist}); LAKI_CLIENT_TOKEN_FILE is set by launchd\n${shq(c.lakiBin)} new myrepo --prompt "Update the dependencies and run the tests"\n`
      return {
        files: [
          { suggestedPath: plist, content },
          { suggestedPath: script, content: body },
        ],
        snippet: content,
        steps: [`Save the plist as ${plist} and the script as ${script} (change myrepo and the prompt)`, `Load it: launchctl bootstrap gui/$(id -u) ${shq(plist)}`, `Try it now: launchctl kickstart gui/$(id -u)/sh.laki.${id}`],
      }
    },
  },
  shortcuts: {
    title: 'A Shortcuts action: a new Laki task from a shortcut',
    scopes: ['create'],
    make: c => ({
      snippet: `LAKI_CLIENT_TOKEN_FILE=${shq(c.tokenFile)} ${shq(c.lakiBin)} new myrepo --prompt "$1"`,
      steps: ['In Shortcuts: add a Run Shell Script action', 'Set Pass Input to "as arguments", paste the line, change myrepo', "The shortcut's input is the prompt"],
    }),
  },
  script: {
    title: 'A status script: reads only (laki ls, laki agents, laki wait)',
    scopes: [],
    make: c => {
      const content = `#!/bin/sh\nexport LAKI_CLIENT_TOKEN_FILE=${shq(c.tokenFile)}\n${shq(c.lakiBin)} agents --json\n`
      return { files: [{ suggestedPath: `${c.home ?? '~'}/bin/laki-status.sh`, content }], snippet: content, steps: ['Save it anywhere and chmod +x it', 'It reads only: no scope to start or send anything'] }
    },
  },
}
export const RECIPE_IDS = Object.keys(RECIPES)
export function recipeOf(id: unknown): Recipe {
  const r = typeof id === 'string' ? RECIPES[id] : undefined
  if (!r) throw new Error(`--for ${String(id)}? one of: ${RECIPE_IDS.join(', ')}`)
  return r
}
// as the CLI prints it: the title, the snippet, then the steps numbered
export const recipeText = (r: Recipe, o: RecipeOut) => [r.title, '', o.snippet.trimEnd(), '', ...o.steps.map((s, i) => `${i + 1}. ${s}`)].join('\n')
