// R12: an agent that isn't installed: its own install command and where its docs are (data only), and how a tab says
// so. An agent starts through your login shell (core.ts spawnTab: $SHELL -lic), so a missing one is the shell's
// "command not found", exit 127, before the agent drew anything
import { type Agent, AGENTS } from './types.ts'

// ponytail: grok has no command here (several CLIs carry that name: none is named as the one, so none is suggested)
export const INSTALL: Record<Agent, { cmd?: string; docs?: string }> = {
  claude: { cmd: 'curl -fsSL https://claude.ai/install.sh | bash', docs: 'https://docs.claude.com/en/docs/claude-code/setup' },
  codex: { cmd: 'npm install -g @openai/codex', docs: 'https://github.com/openai/codex' },
  gemini: { cmd: 'npm install -g @google/gemini-cli', docs: 'https://github.com/google-gemini/gemini-cli' },
  grok: {},
  opencode: { cmd: 'curl -fsSL https://opencode.ai/install | bash', docs: 'https://opencode.ai/docs' },
}
// the agent a tab runs: its profile's (a profile named as an agent is that agent's)
export const tabAgent = (t: { preset?: string }, presets: { name: string; agent?: string }[] = []): Agent | undefined =>
  (a => ((AGENTS as readonly string[]).includes(a ?? '') ? (a as Agent) : undefined))(presets.find(p => p.name === t.preset)?.agent ?? t.preset)
// its command wasn't found: the tab ended with the shell's 127
export const notInstalled = (t: { kind?: string; status?: string; code?: number | null }) => t.kind === 'agent' && t.status === 'exited' && t.code === 127
