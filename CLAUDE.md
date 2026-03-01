# Anima — Project Instructions

## What This Is

Anima is an AI-first programming language — a design exploration and prototype. It has Kotlin/TypeScript-flavored syntax with novel constructs for AI concepts (confidence types, agents, intents, fuzzy predicates, evolution, NL types).

The project was built as an experiment to explore what "AI-first" language constructs could look like. It has a complete grammar, parser, interpreter, and typechecker. However, as of March 2026, the project is at a crossroads: the implementation is solid as a prototype, but the path to real-world adoption is unclear. See "Project Status & Honest Assessment" below.

## Project Structure

- `docs/spec/` — The canonical language specification (12 documents). Source of truth.
- `docs/rfcs/` — Proposals for language changes. Follow the template in `0000-template.md`.
- `grammar/` — Formal grammar in EBNF. Must stay in sync with `docs/spec/02-grammar.md`.
- `tree-sitter-anima/` — Tree-sitter parser grammar, highlight queries, and test corpus.
- `interpreter/` — TypeScript tree-walking interpreter (uses tree-sitter for parsing).
- `typechecker/` — TypeScript type checker with bidirectional inference and subtyping.
- `mcp-server/` — MCP server for AI agents to validate Anima code.
- `editors/intellij/` — IntelliJ plugin with TextMate grammar for syntax highlighting.
- `examples/` — Example `.anima` programs. All 10 parse with 0 errors.
- `.github/workflows/ci.yml` — CI pipeline: parser tests, interpreter tests, typechecker tests, example parsing, runtime demo execution.

## Current Implementation State (March 2026)

### What Works

**Parser (tree-sitter-anima/):**
- 39/39 corpus tests passing
- All 10 example files parse with 0 errors
- Covers: functions, entities, sealed classes, interfaces, agents, intents, fuzzy predicates, evolution blocks, NL types, confidence types, try/catch/finally, lambdas, when expressions, for/while, imports, modules

**Interpreter (interpreter/):**
- 96/96 tests passing
- Runtime demo (`examples/runtime-demo.anima`) runs end-to-end exercising all features
- Core language: variables, functions, closures, nested functions, control flow (if/else/when/for/while/break/continue), entities with invariants/copy/equality, sealed classes with pattern matching, lambdas with trailing lambda syntax, string interpolation, nullable types with safe calls (?.) and elvis (?:), extension functions, recursion
- Collections: List (map, filter, reduce, fold, flatMap, sortedBy, any, all, none, find, zip, take, drop, distinct, reversed, joinToString, associateBy, groupBy), Map (iteration, filter, mapValues, getOrDefault, containsKey, keys, values), Set (contains), mutable lists
- AI-first features (basic/stub level): confidence types (`@ 0.9`, propagation, decompose), intent functions (ensure clauses as post-conditions), fuzzy predicates (weighted sum), agents (spawn, context, boundaries, methods), memory (remember/recall/forget with keyword matching), NL operations (semantic equality, entity extraction — stub implementations), evolution (fitness tracking, pin/unpin — no actual evolution)

**Typechecker (typechecker/):**
- 81/81 tests passing
- Bidirectional type inference, subtyping, generics
- Covers all builtins including memory, evolution, NL operations

### What Doesn't Work / Known Limitations

- `data entity` and `intent fun` declarations must be top-level (not inside function bodies) — grammar limitation
- `is Shape.Circle` in when branches doesn't work — grammar precedence issue, use `is Circle` instead
- Multi-line when branch expression bodies can misparse — use block bodies `{ ... }` for multi-line
- AI-first features are mostly stubs: NL operations do string comparison (no embeddings/LLM), evolution tracks metrics but doesn't actually evolve code, memory is in-memory only (no persistence), agent boundaries are checked but there's no real LLM tool-calling
- No module/import resolution (imports parse but don't load files)
- No standard library beyond builtins
- Tree-walking interpreter — inherently slow, no compilation

## Project Status & Honest Assessment

**The prototype is well-engineered.** Clean grammar, proper parser, working interpreter with closures/pattern matching/collections, real type checker. As a language implementation exercise, it's solid.

**As a product people would use? Probably not.** Key issues:

1. **Most "AI-first" features could be libraries.** Confidence types are the one genuinely novel idea that benefits from language-level support. Everything else (agents, intents, memory, fuzzy predicates) could be a TypeScript/Python library with decorators.

2. **No ecosystem.** No packages, no community, no Stack Overflow answers, no training data for AI models to learn from. Python and TypeScript have all of this.

3. **Target audience paradox.** If code is "written by AI agents," those agents are better at writing Python/TypeScript (abundant training data) than Anima (zero training data).

**Ideas worth extracting into libraries (Kotlin/TypeScript):**
- Confidence type wrappers with propagation rules — genuinely useful for ML pipelines and RAG
- Agent boundary/governance model (can/cannot/maxCost/maxToolCalls) — people build this ad-hoc today
- Intent/constraint decorators (ensure/prefer/avoid) with LLM-assisted satisfaction
- The spec documents themselves as design thinking about AI-native programming patterns

**Open question:** What to do next. Options range from "leave it as a completed experiment" to "extract the good ideas into TypeScript libraries" to "continue building toward the spec vision." The owner hasn't decided yet.

## Conventions

- Spec documents are numbered (`01-`, `02-`, ...) to establish reading order.
- Code examples in spec docs use ` ```anima ` fenced blocks.
- The grammar in `grammar/anima.ebnf` is the formal reference. The grammar in `docs/spec/02-grammar.md` is the human-readable version. Keep them in sync.
- Version is tracked in `VERSION` (single line, semver). Update it and `CHANGELOG.md` together.
- Anima syntax follows Kotlin/TypeScript conventions: `fun`, `val`/`var`, `when`, trailing lambdas, data classes, extension functions.

## Naming

- The language is called **Anima** (capital A).
- File extension is `.anima`.
- Canonical construct names: `intent fun`, `@ Confidence`, `fuzzy fun`, `agent`, `ensure`/`prefer`/`avoid`, `evolve`, `NL`.

## When Editing

- If you change the grammar, update `grammar/anima.ebnf`, `docs/spec/02-grammar.md`, AND `tree-sitter-anima/grammar.js`.
- If you change the tree-sitter grammar, run `npx tree-sitter generate && npx tree-sitter test` to verify.
- If you add a new language construct, add it to the keyword map in `docs/spec/02-grammar.md`.
- If you add a new spec document, update the table in `README.md`.
- Example files should demonstrate real use cases, not toy examples.
- All example files must parse with 0 errors: `cd tree-sitter-anima && npx tree-sitter parse ../examples/FILE.anima`.

## Running Things

```bash
# Parser tests
cd tree-sitter-anima && npx tree-sitter generate && npx tree-sitter test

# Parse an example file
cd tree-sitter-anima && npx tree-sitter parse ../examples/runtime-demo.anima

# Interpreter tests
cd interpreter && npx jest

# Run a .anima file
cd interpreter && npx ts-node src/index.ts ../examples/runtime-demo.anima

# Typechecker tests
cd typechecker && npx jest

# Typecheck (via tsc)
cd typechecker && npx tsc --noEmit

# Full CI locally
cd tree-sitter-anima && npx tree-sitter generate && npx tree-sitter test
cd interpreter && npx jest && npx ts-node src/index.ts ../examples/runtime-demo.anima
cd typechecker && npx jest
```

## Key Files

| File | Lines | What It Does |
|------|-------|-------------|
| `tree-sitter-anima/grammar.js` | ~1,300 | Complete tree-sitter grammar |
| `interpreter/src/interpreter.ts` | ~2,900 | Main tree-walking interpreter |
| `interpreter/src/values.ts` | ~200 | Runtime value types (AnimaValue union) |
| `interpreter/src/environment.ts` | ~60 | Scoped variable environments |
| `interpreter/src/builtins.ts` | ~180 | Built-in functions (println, listOf, mapOf, etc.) |
| `interpreter/src/memory.ts` | ~150 | Memory system (remember/recall/forget) |
| `interpreter/src/evolution.ts` | ~120 | Evolution engine (fitness tracking, pin/unpin) |
| `interpreter/src/nl.ts` | ~80 | NL operations (semantic equality, entity extraction) |
| `interpreter/src/intents.ts` | ~60 | Intent constraint evaluation |
| `interpreter/src/errors.ts` | ~60 | Error types and control flow signals |
| `typechecker/src/checker.ts` | ~1,200 | Type checker with bidirectional inference |
| `typechecker/src/types.ts` | ~200 | Type representations |
| `typechecker/src/subtyping.ts` | ~150 | Subtype relation rules |
| `mcp-server/src/index.ts` | ~200 | MCP server (syntax validation) |
| `examples/runtime-demo.anima` | ~220 | Comprehensive runnable demo |
