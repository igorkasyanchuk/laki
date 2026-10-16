// Specs and brainstorms' words for agents (daemon/plans.ts keeps the folders): what a brainstorm's output looks like,
// the prompts the app's Start and Brainstorm buttons give, MCP's tool descriptions
import { type Plan, PLAN_KINDS, type PlanTemplate } from './types.ts'

// a diagram file (<name>.diagram.json) the app draws (specdrop's format, renderer's diagram.tsx)
export const DIAGRAM_FORMAT = `A diagram file (<name>.diagram.json) is {"kind", "nodes": [{"id", "shape", "label", "sub"?, "tag"?, "accent"?, "x"?, "y"?, "w"?, "h"?}], "edges": [{"from", "to", "label"?, "dashed"?}]}. kind and its shapes: flowchart (terminal, process, decision, io, note), architecture (service, database, queue, external, zone), state (initial, state, final), er (entity, fields in sub one per line), swimlane (lane, process, decision, terminal), screenflow (screen, phone, action, note; what's on a screen in sub, one line each). Leave out x and y for an automatic layout; accent on 1-2 nodes at most.`

// what a brainstorm session leaves in its folder (Laki AI's laki_plan_write, or any agent writing files there)
export const BRAINSTORM_OUTPUT = `Explore the idea, don't build it. Write what you find as files in the brainstorm's folder, never README.md (the brief) or spec.json:
- ideas.md: the options, each with what changes for the user, pros, cons and what it takes; a mind map of the idea as a \`\`\`mermaid mindmap block, and other diagrams as \`\`\`mermaid blocks (flowchart, sequence, state, er) where they help;
- prototype-<option>.html: one self-contained page per option (inline <style> and <script>, fonts from Google Fonts at most, no other requests), clickable where the interaction is the idea, with a short note on top: which option, what changes, what it takes; in the product's look (its colors, fonts and real names, not lorem ipsum);
- <name>.diagram.json for an architecture or a flow worth editing by hand. ${DIAGRAM_FORMAT}
Ask the user when the direction depends on them.`

const where = (p: Pick<Plan, 'path'>) => `${p.path}/README.md`

// the spec's Start: the new-workspace page's prompt (the user picks the agent and can change it)
// the spec page's Copy for a prompt: a line naming its README.md, to paste into any agent's prompt
export const planRef = (p: Pick<Plan, 'kind' | 'path'>) => `${p.kind === 'spec' ? 'Spec' : 'Brainstorm'}: ${where(p)} (read it, and the files beside it: attachments, diagrams)`
export const specPrompt = (p: Plan) => `Implement the spec "${p.title}": ${where(p)}. Read it first, and the files beside it (attachments, diagrams), then do what it says; ask me when it is unclear.`

// the brainstorm's button: the first ask in its own chat with Laki AI (the chat's instructions name the brainstorm too)
export const brainstormPrompt = (p: Plan) =>
  `Brainstorm session for "${p.title}": read the brief with laki_plan_read (project ${p.project}, kind brainstorm, slug ${p.slug}), and the project's code where it helps, then write your options into it with laki_plan_write. End with the options in a sentence each, and which files you wrote.`

// a spec's or brainstorm's own chat with Laki AI (daemon/ai.ts keeps it in its folder, .chat.json)
export const planChat = (p: { project: string; kind: string; slug: string }) => `plan:${p.project}/${p.kind}/${p.slug}`
export const PLAN_CHAT_IDLE = 12 * 3600_000 // unused this long, a chat ends: what's typed next starts a new one

// the templates that come with Laki (the Specs page's Templates changes them: settings.planTemplates)
export const PLAN_TEMPLATES: PlanTemplate[] = [
  { name: 'Feature', kind: 'spec', text: '## Goal\n\n\n## Context\n\n\n## Steps\n\n- [ ] \n\n## How to verify\n' },
  { name: 'Idea', kind: 'brainstorm', text: "## The idea\n\n\n## Who it's for\n\n\n## Constraints\n\n\n## Questions to explore\n" },
]
// only whole ones: an imported or hand-edited list may hold others
export const planTemplates = (s?: { planTemplates?: PlanTemplate[] }) =>
  Array.isArray(s?.planTemplates) ? s.planTemplates.filter(t => t && typeof t.name === 'string' && typeof t.text === 'string' && PLAN_KINDS.includes(t.kind)) : PLAN_TEMPLATES
