# Anima — Project Instructions

## What This Is

Anima is a programming language specification. There is no compiler or runtime yet — the project is currently documentation, grammar definitions, and example code.

## Project Structure

- `docs/spec/` — The canonical language specification. These are the source of truth.
- `docs/rfcs/` — Proposals for language changes. Follow the template in `0000-template.md`.
- `grammar/` — Formal grammar in EBNF. Must stay in sync with `docs/spec/02-grammar.md`.
- `examples/` — Example `.anima` programs. Must be valid according to the current grammar.

## Conventions

- Spec documents are numbered (`01-`, `02-`, ...) to establish reading order.
- Code examples in spec docs use ` ```anima ` fenced blocks.
- The grammar in `grammar/anima.ebnf` is the formal reference. The grammar in `docs/spec/02-grammar.md` is the human-readable version with explanations. Keep them in sync.
- Version is tracked in `VERSION` (single line, semver). Update it and `CHANGELOG.md` together.
- Anima syntax follows Kotlin/TypeScript conventions: `fun`, `val`/`var`, `when`, trailing lambdas, data classes, extension functions.

## Naming

- The language is called **Anima** (capital A).
- File extension is `.anima`.
- The spec refers to novel constructs with these canonical names:
  - `intent fun` — intent function (goal-oriented)
  - `@ Confidence` — confidence annotation
  - `fuzzy fun` — fuzzy predicate
  - `agent` — agent declaration
  - `ensure` / `prefer` / `avoid` — constraint clauses
  - `evolve` — evolution block
  - `NL` — natural language type

## When Editing

- If you change the grammar, update both `grammar/anima.ebnf` AND `docs/spec/02-grammar.md`.
- If you add a new language construct, add it to the keyword map in `docs/spec/02-grammar.md`.
- If you add a new spec document, update the table in `README.md`.
- Example files should demonstrate real use cases, not toy examples.
