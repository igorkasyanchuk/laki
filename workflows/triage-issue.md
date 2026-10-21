# Triage an issue
An agent in plan mode reads a GitHub issue and the code it touches: what it is, how big, where to start. Saved to Artifacts.

runs in: main

## start
inputs: issue:number
next: read
at: 70,20

## read
name: Read it
agent: claude · perm: plan
> Run gh issue view {{inputs.issue}} --comments, then read the code it touches. Change no files.
> Answer in short Markdown: what it is (bug, feature, question), how big (S, M or L), the files to start in, and the open questions.
next: keep
at: 70,110

## keep
name: Save it
save: triage/issue-{{inputs.issue}}.md
> {{steps.read.answer}}
ok: done
at: 70,200

## done
name: Done
end: success · notify: yes
> {{steps.read.answer}}
at: 70,290
