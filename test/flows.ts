// The workflow files the workflow tests share

export const FLOW = `# Test flow
Plans, checks, asks, builds, saves.

runs in: worktree · session: new

## start
input: task
next: plan

## plan
agent: claude
> plan {{task}}
next: check

## check
run: test -f README.md && echo fine {{task}}
ok: said
fail: bad

## said
choice: steps.plan.answer contains "answer: plan"
- Yes → gate
- No → bad

## gate
ask: Go on?
show: {{steps.check.output}}
- Build → build
- Stop → bad

## build
agent: claude
> build it: {{answer}}
next: keep

## keep
save: notes/out.md
> {{steps.build.answer}}
ok: approve

## approve
action: approve
ok: done
error: bad

## done
end: success · notify: yes

## bad
end: failed
`

// one agent block, its error way an end of its own
export const AGENT = (agent: string, prompt: string) => `# Agent
One turn.

runs in: worktree · session: new

## start
input: task
next: work

## work
agent: ${agent}
> ${prompt}
next: done
error: bad

## done
end: success

## bad
end: failed
`
