# Anima

**An AI-first, agentic programming language.**

Anima (Latin: *soul, life force*) is a programming language designed from the ground up for a world where AI agents write, maintain, and evolve code. Instead of forcing agents to pretend to be human programmers using human-oriented languages, Anima gives them — and the humans who work alongside them — a language built for how intelligent systems actually think: in intents, confidence levels, delegation, and continuous learning.

> **Status:** Pre-release specification (v0.1.0). Anima is currently a language design — no compiler or runtime exists yet. We are designing in the open and welcome feedback.

## Core Ideas

1. **Intent over Implementation** — Declare *what* you want with constraints, not *how* to do it step by step. The compiler resolves intents into implementations.
2. **Confidence as a Type** — Every value can carry a confidence score. The type system tracks and propagates uncertainty through all computations.
3. **Agents as Primitives** — Agents are first-class language constructs with their own memory, tools, boundaries, and delegation models.
4. **Living Code** — Functions can evolve at runtime based on fitness metrics, within strict governance bounds.
5. **Fuzzy Predicates** — Soft-truth functions evaluated by AI, enabling constraints like "is aesthetically pleasing" or "avoids clickbait."
6. **Memory as Architecture** — Persistent, session, and ephemeral memory tiers with semantic retrieval, built into the language.

## Syntax Philosophy

Anima's syntax is modeled after **Kotlin** and **TypeScript** — familiar, expressive, and ergonomic. The novel constructs (`intent fun`, `ensure`, `@ Confidence`, `agent`, `evolve`) are additive and slot in naturally alongside standard constructs.

```anima
intent fun summarize(document: NL): NL {
    ensure { output.length < document.length * 0.2 }
    ensure { output.preservesKeyPoints(document) }
    prefer { output.isReadable() }

    cost {
        maxTokens = 10_000
        maxLatency = 5.seconds
    }
}
```

## Project Structure

```
anima/
├── docs/
│   ├── spec/          # Language specification (the source of truth)
│   ├── rfcs/          # Proposals for language changes
│   └── guides/        # Tutorials and guides (future)
├── grammar/           # Formal grammar (EBNF) and tree-sitter (future)
├── examples/          # Example .anima programs
├── CHANGELOG.md       # Version history
├── VERSION            # Current spec version
└── LICENSE
```

## Specification

The full language specification lives in [`docs/spec/`](docs/spec/):

| Document | Contents |
|----------|----------|
| [01 — Overview](docs/spec/01-overview.md) | Philosophy, design principles, paradigm |
| [02 — Grammar](docs/spec/02-grammar.md) | Complete EBNF grammar |
| [03 — Type System](docs/spec/03-type-system.md) | Types, confidence types, NL type, fuzzy types |
| [04 — Intents](docs/spec/04-intents.md) | Intent functions, constraints, resolution |
| [05 — Agents](docs/spec/05-agents.md) | Agent model, delegation, boundaries, teams |
| [06 — Memory Model](docs/spec/06-memory-model.md) | Memory tiers, semantic retrieval, decay |
| [07 — Evolution Engine](docs/spec/07-evolution-engine.md) | Self-modifying code, governance, fitness |
| [08 — Error Model](docs/spec/08-error-model.md) | Diagnosable errors, self-healing |
| [09 — Runtime Architecture](docs/spec/09-runtime-architecture.md) | Compiler pipeline, runtime components |

## Versioning

The specification follows [Semantic Versioning](https://semver.org/):

- **MAJOR** — Breaking changes to the language spec (grammar, semantics)
- **MINOR** — Additive features, new constructs, non-breaking extensions
- **PATCH** — Clarifications, typo fixes, example corrections

The current version is tracked in [`VERSION`](VERSION).

## Contributing

Anima is in early design. The best way to contribute is through the RFC process:

1. Copy [`docs/rfcs/0000-template.md`](docs/rfcs/0000-template.md)
2. Fill in your proposal
3. Submit a PR for discussion

## License

MIT — see [LICENSE](LICENSE).