# Anima — Project Instructions

## What This Is

Anima is an AI-first programming language. Code is written by agentic coding agents. The project has a complete grammar, tree-sitter parser, and basic interpreter.

## Project Structure

- `docs/spec/` — The canonical language specification. These are the source of truth.
- `docs/rfcs/` — Proposals for language changes. Follow the template in `0000-template.md`.
- `grammar/` — Formal grammar in EBNF. Must stay in sync with `docs/spec/02-grammar.md`.
- `tree-sitter-anima/` — Tree-sitter parser grammar, highlight queries, and test corpus.
- `interpreter/` — TypeScript tree-walking interpreter (uses tree-sitter for parsing).
- `editors/intellij/` — IntelliJ plugin with TextMate grammar for syntax highlighting.
- `examples/` — Example `.anima` programs. Must parse with 0 errors via tree-sitter.

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

- If you change the grammar, update `grammar/anima.ebnf`, `docs/spec/02-grammar.md`, AND `tree-sitter-anima/grammar.js`.
- If you change the tree-sitter grammar, run `npx tree-sitter generate && npx tree-sitter test` to verify.
- If you add a new language construct, add it to the keyword map in `docs/spec/02-grammar.md`.
- If you add a new spec document, update the table in `README.md`.
- Example files should demonstrate real use cases, not toy examples.
- All example files must parse with 0 errors: `cd tree-sitter-anima && npx tree-sitter parse ../examples/FILE.anima`.
