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

// how to brainstorm with the user (the laki-specs skill's, Laki AI's brainstorm chats'): the method of obra/superpowers'
// brainstorming skill (Jesse Vincent, MIT; as aitmpl.com's development/brainstorming 2.0 has it), in Laki's words, its
// output a Laki spec or brainstorm instead of a repo's docs/plans file
export const BRAINSTORM_METHOD = `Find out what the user wants and why before anything is built: what you think they want is usually thinner than it feels, and with the why you can make the unsaid choices their way. Everything already in the request (a one-line, fully said task): just do it.
1. Look before you ask. Read what you were given (the brief, its files, the project's code) until you can say how it works today and what the change touches. Never ask what the project already answers.
2. First message. A detailed ask: say it back in your own words in about 200 words (what, for whom, why), what you found, anything that would change it (a constraint, a conflict, a cheaper way), then the one question whose answer changes the most. A thin ask: one open question about the biggest unsettled thing, and why you ask. Not asked to brainstorm: offer in a line to just start instead.
3. One question per message, one sentence, in the user's words, no list of sample answers and no talk of this method. Open questions first; a short menu only when they're stuck; "just guess": propose something concrete. A proposal they can correct, with its reason, often beats a question. Settle early which choices are theirs (platform, libraries, look) and build on what exists; a choice you make is written down as yours, never as agreed. Cover, as it comes up: what it is, why now and what success looks like, goals, non-goals and what would make it a failure even if it works, what they liked or hated elsewhere, what they tried.
4. Show, don't tell: for screens, flows or options that would look different, offer once a mockup (a prototype page, a diagram); declined, stay in words.
5. Approaches, in a message of their own, before writing anything up: think of several, drop the weak ones, give the 2-3 left with what each trades off, lead with your pick and why, and ask which. Only one sensible way: say so and why.
6. Play it back: once a part is clear, say it back in 200-300 words (only what they said is theirs; what you filled in is marked as your proposal), then ask what's wrong or missing.
7. Size it once they've picked: a small change gets a short design in the chat (a line or two a point); a project gets it written into Laki (below). Both say the approaches, the pick and why. It grows: say so. Several independent projects: agree an order, one at a time.
8. Nothing is built until they approve the written design: no code, scaffolding, installs or new projects; reading, exploring and agreed mockups are fine. A throwaway spike they agreed to may be built; keeping it is a new ask. After approval the next step is the plan (a spec's Steps), not code.
Write it into Laki: an idea to explore is a brainstorm (its README.md is the user's brief; your options, prototypes and diagrams are files beside it); a design to build is a spec, written for a capable builder to work from alone: ## Goal (and why), ## Context, ## Decisions (the user's, as they said them; yours marked as yours), ## Approaches (considered, the pick, why), ## Steps as a - [ ] checklist, ## How to verify, ## Not doing. YAGNI: cut what nobody asked for. The user reads, edits and approves it in Laki.`

const where = (p: Pick<Plan, 'path'>) => `${p.path}/README.md`

// the spec's Start: the new-workspace page's prompt (the user picks the agent and can change it)
// the spec page's Copy for a prompt: a line naming its README.md, to paste into any agent's prompt
export const planRef = (p: Pick<Plan, 'kind' | 'path'>) => `${p.kind === 'spec' ? 'Spec' : 'Brainstorm'}: ${where(p)} (read it, and the files beside it: attachments, diagrams)`
export const specPrompt = (p: Plan) => `Implement the spec "${p.title}": ${where(p)}. Read it first, and the files beside it (attachments, diagrams), then do what it says; ask me when it is unclear.`

// the brainstorm's button: the first ask in its own chat with Laki AI (the chat's instructions name the brainstorm too)
export const brainstormPrompt = (p: Plan) =>
  `Brainstorm session for "${p.title}": read the brief with laki_plan_read (project ${p.project}, kind brainstorm, slug ${p.slug}), and the project's code where it helps. When the brief leaves something big open, ask me first, one question at a time; once it's clear, write your options into it with laki_plan_write and end with them in a sentence each, and which files you wrote.`

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
