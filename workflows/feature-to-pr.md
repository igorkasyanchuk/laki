# Feature to PR
Plan it, you approve the plan, build it, test (twice more on a fail), open a PR, wait for CI.

runs in: worktree · when done: archive

## start
input: task
next: plan
at: 70,20

## plan
name: Plan
agent: claude · perm: plan · session: new
> Make a plan for: {{task}}
> Read the code first. Say what you'd change, file by file, and how you'd test it. Change nothing yet.
next: approve
at: 70,110

## approve
name: Build this?
ask: Build this plan?
show: {{steps.plan.answer}}
- Build it → build
- Stop → stopped
at: 70,200

## build
name: Build
agent: claude · perm: acceptEdits
> Build this plan, with tests:
> {{steps.plan.answer}}
next: test
at: 70,290

## test
name: Tests
run: npm test
retry: 2
ok: ship
fail: stopped
at: 70,380

## ship
name: Open a PR
action: ship
> {{task}}
ok: ci
error: stopped
at: 70,470

## ci
name: Wait for CI
wait: checks
fail: stopped
at: 70,560

## stopped
name: Stopped
end: stopped · notify: yes
> {{task}}: stopped. The run's log says where.
at: 300,470
