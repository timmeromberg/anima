# Anima Grammar

This directory contains the formal grammar definition for the Anima language.

## Files

- **`anima.ebnf`** — The canonical grammar in Extended Backus-Naur Form (ISO 14977). This is the single source of truth for the syntax.

## Relationship to Spec

The human-readable grammar with examples and explanations is in [`docs/spec/02-grammar.md`](../docs/spec/02-grammar.md). Both files must stay in sync — if you change one, update the other.

## Future

When implementation begins, this directory will also contain:

- `tree-sitter-anima/` — Tree-sitter grammar for incremental parsing
- `textmate/` — TextMate grammar for syntax highlighting (VS Code, etc.)
- `monarch/` — Monarch grammar for Monaco editor integration

## Conventions

- The EBNF uses ISO 14977 notation:
  - `=` for definition
  - `,` for concatenation
  - `|` for alternation
  - `{ }` for repetition (zero or more)
  - `[ ]` for optional
  - `(* *)` for comments
  - `;` terminates each rule
