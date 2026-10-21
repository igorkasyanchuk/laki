# Release notes
When a PR merges, an agent in plan mode writes its release notes for users; they go to Artifacts.

runs in: main · on: pr.merged

## start
next: write
at: 70,20

## write
name: Write them
agent: claude · perm: plan
> PR #{{event.pr.number}} merged: {{event.pr.title}} ({{event.pr.url}}).
> Read it (gh pr view {{event.pr.number}} --comments, gh pr diff {{event.pr.number}}) and write its release notes for users: what changed and why it matters, in a few short lines of Markdown. Change no files.
next: keep
at: 70,110

## keep
name: Save them
save: release-notes/pr-{{event.pr.number}}.md
> {{steps.write.answer}}
ok: done
at: 70,200

## done
name: Done
end: success
at: 70,290
