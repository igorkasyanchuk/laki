# Review a PR
An agent reviews the workspace's PR in plan mode; you approve it, or post the review as a comment.

runs in: here

## start
input: task
inputs: depth:choice(quick|full)=quick
next: review
at: 70,20

## review
name: Review
agent: claude · perm: plan
> Review this workspace's PR ({{pr.url}}) against {{base}}: {{task}}
> Depth: {{inputs.depth}} (quick: correctness and real risks; full: also design, tests and naming).
> List the problems by severity, each with file:line, then say whether it's ready to approve. Change no files.
next: decide
at: 70,110

## decide
name: What now?
ask: Approve the PR, or post the review as a comment?
show: {{steps.review.answer}}
- Approve → approve
- Comment → comment
- Neither → done
at: 70,200

## approve
name: Approve
action: approve
ok: done
error: failed
at: 70,290

## comment
name: Comment
run: gh pr comment "{{pr.url}}" --body "{{steps.review.answer}}"
ok: done
fail: failed
at: 300,290

## done
name: Done
end: success
at: 70,380

## failed
name: Didn't go through
end: failed · notify: yes
> The approve or the comment failed: the run's log says why.
at: 300,380
