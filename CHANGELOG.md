# Changelog

All notable changes to the Anima language specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-03-01

### Added
- Tree-sitter parser grammar (`tree-sitter-anima/`)
  - Complete `grammar.js` covering all language constructs
  - Syntax highlighting queries (`queries/highlights.scm`)
  - 37 corpus tests, 100% pass rate
- TypeScript tree-walking interpreter (`interpreter/`)
  - Evaluates expressions, functions, control flow, basic types
  - Uses tree-sitter for parsing `.anima` files
- IntelliJ IDE plugin (`editors/intellij/`)
  - TextMate grammar for full syntax highlighting
  - Plugin wrapper targeting IntelliJ 2024.1+
- 5 new example programs
  - `error-handling.anima` — payment processing, diagnosable classes, try/catch
  - `multi-agent-collaboration.anima` — protocols, delegation, spawn, parallel
  - `type-system.anima` — generics, sealed classes, NL types, confidence
  - `context-memory.anima` — memory tiers, autoLearn, decay, recall/ask
  - `evolving-strategies.anima` — evolving intents, fitness metrics, review gates
- Formal semantics specifications
  - Type system formal treatment (subtyping, confidence algebra, inference)
  - Execution model (intent resolution, agent lifecycle, concurrency)
  - Confidence propagation rules

### Fixed
- Tree-sitter grammar: comment tokenization precedence bug
- Tree-sitter grammar: sealed_data_class now supports type parameters
- Tree-sitter grammar: typed lambda parameters (`{ x: Int -> expr }`)
- Synced EBNF grammar and spec doc with ~40 new constructs

## [0.1.0] - 2026-02-28

### Added
- Initial language specification
  - Core grammar (EBNF) with Kotlin/TypeScript-flavored syntax
  - Type system: primitives, structural types, union types, generics
  - Confidence types (`T @ Confidence`) with propagation rules
  - Natural language type (`NL`, `NL<Domain>`)
  - Intent functions (`intent fun`) with `ensure`, `prefer`, `avoid` constraints
  - Agent declarations with context, tools, boundaries, and teams
  - Fuzzy predicates (`fuzzy fun`) for AI-evaluated soft constraints
  - Memory model: persistent, session, and ephemeral tiers with semantic retrieval
  - Evolution engine: self-modifying code with governance and fitness metrics
  - Diagnosable error model with self-healing capabilities
  - Runtime architecture: compiler pipeline and runtime components
- Formal grammar file (`grammar/anima.ebnf`)
- Example programs
- RFC process and template
- Project documentation
