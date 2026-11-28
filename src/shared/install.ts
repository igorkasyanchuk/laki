// R12: an agent that isn't installed: its own install command and where its docs are (data only), and how a tab says
// so. An agent starts through your login shell (core.ts spawnTab: $SHELL -lic), so a missing one is the shell's
// "command not found", exit 127, before the agent drew anything
import { type Agent, AGENTS } from './types.ts'

// ponytail: grok has no command here (several CLIs carry that name: none is named as the one, so none is suggested)
export const INSTALL: Record<Agent, { cmd?: string; docs?: string }> = {
  claude: { cmd: 'curl -fsSL https://claude.ai/install.sh | bash', docs: 'https://docs.claude.com/en/docs/claude-code/setup' },
  codex: { cmd: 'npm install -g @openai/codex', docs: 'https://github.com/openai/codex' },
  gemini: { cmd: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', docs: 'https://antigravity.google/docs/cli' }, // Antigravity CLI (agy), Gemini CLI's successor
  grok: {},
  opencode: { cmd: 'curl -fsSL https://opencode.ai/install | bash', docs: 'https://opencode.ai/docs' },
  pi: { cmd: 'npm install -g @mariozechner/pi-coding-agent', docs: 'https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent' },
}
// the agent a tab runs: its profile's (a profile named as an agent is that agent's)
export const tabAgent = (t: { preset?: string }, presets: { name: string; agent?: string }[] = []): Agent | undefined =>
  (a => ((AGENTS as readonly string[]).includes(a ?? '') ? (a as Agent) : undefined))(presets.find(p => p.name === t.preset)?.agent ?? t.preset)
// its command wasn't found: the tab ended with the shell's 127
export const notInstalled = (t: { kind?: string; status?: string; code?: number | null }) => t.kind === 'agent' && t.status === 'exited' && t.code === 127

// C6: Cursor's agent CLI, a ready-made profile: a command that speaks ACP (daemon/acp.ts), not one of AGENTS (no
// terminal, no hooks: ACP's own turns). Settings › Agents & profiles' Add a profile for… › Cursor, and a fresh install's
// list when cursor-agent is on PATH
export const CURSOR = { name: 'cursor', agent: 'command' as const, cmd: 'cursor-agent acp', acp: true }
export const CURSOR_INSTALL = { cmd: 'curl https://cursor.com/install -fsS | bash', docs: 'https://cursor.com/docs/cli/overview' }
export const isCursor = (p?: { cmd?: string; acp?: boolean }) => !!p?.acp && /^\s*(?:\S*\/)?cursor-agent(?:\s|$)/.test(p.cmd ?? '')
// GitHub Copilot CLI: its ACP server (`copilot --acp`, stdio; public preview, docs.github.com/en/copilot/reference/acp-server),
// a ready-made profile as Cursor's, in a fresh install's list when copilot is on PATH. Its hooks live only in its own
// files (~/.copilot/hooks, .github/hooks): ACP's turns are what Laki hears
export const COPILOT = { name: 'copilot', agent: 'command' as const, cmd: 'copilot --acp', acp: true }
export const COPILOT_INSTALL = { cmd: 'npm install -g @github/copilot', docs: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli' }
export const isCopilot = (p?: { cmd?: string; acp?: boolean }) => !!p?.acp && /^\s*(?:\S*\/)?copilot(?:\s|$)/.test(p.cmd ?? '')
