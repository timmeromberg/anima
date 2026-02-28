# Changelog

All notable changes to the Anima language specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
