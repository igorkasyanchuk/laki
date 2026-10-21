# Nightly dependency bumps
Bumps the dependencies in a worktree, runs the tests, opens a PR. Schedule it: Scheduled tasks › New, this workflow, "every weekday at 2am".

runs in: worktree · when done: archive

## start
next: bump
at: 70,20

## bump
name: Bump
agent: claude · perm: acceptEdits
timeout: 30
> Update this project's dependencies to their latest compatible versions (minor and patch; a major one only when nothing breaks). Say what changed.
next: test
at: 70,110

## test
name: Tests
run: npm test
retry: 2 · retry on: 1
ok: ship
fail: give-up
at: 70,200

## ship
name: Open a PR
action: ship · ask first: no
> Bump dependencies
ok: done
error: give-up
at: 70,290

## done
name: Done
end: success
at: 70,380

## give-up
name: Tests fail
end: failed · notify: yes
> The tests fail after the bump: {{steps.test.output}}
at: 300,290
