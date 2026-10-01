# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in 本地资料/scratch/. That folder is git-ignored and kept only on the local machine; it is not published to GitHub.

## Conventions

- One feature per directory: 本地资料/scratch/<feature-slug>/
- The spec is 本地资料/scratch/<feature-slug>/spec.md
- Implementation issues are one file per ticket at 本地资料/scratch/<feature-slug>/issues/<NN>-<slug>.md, numbered from 01, never a single combined tickets file
- Triage state is recorded as a Status: line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a ## Comments heading

## When a skill says publish to the issue tracker

Create a new file under 本地资料/scratch/<feature-slug>/, creating the directory if needed.

## When a skill says fetch the relevant ticket

Read the referenced Markdown file. The user should provide the path or issue number directly.

## Wayfinding operations

The /wayfinder map is 本地资料/scratch/<effort>/map.md. Each child ticket lives at 本地资料/scratch/<effort>/issues/NN-<slug>.md.
