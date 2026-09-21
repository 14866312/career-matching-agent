# Domain Docs

This repository uses a single-context domain documentation layout.

## Before exploring

- Read CONTEXT.md at the repository root when it exists.
- Read ADRs in docs/adr/ that touch the area being changed.
- If these files do not exist, proceed without flagging their absence. Create them when domain modeling or an architectural decision requires them.

## File structure

/ 
  CONTEXT.md
  docs/adr/
  src/

## Use the glossary vocabulary

When an applicable CONTEXT.md exists, use its domain terms in issue titles, refactor proposals, hypotheses, and test names. If a needed concept is missing, record the gap for domain modeling rather than silently inventing competing terminology.

## Flag ADR conflicts

If a proposed change contradicts an existing ADR, surface the conflict explicitly before proceeding.
