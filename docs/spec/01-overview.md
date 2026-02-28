# 01 — Overview

> Anima Language Specification v0.1.0

## What Is Anima?

Anima is a programming language designed for a world where AI agents are primary authors of code. Every mainstream language today was designed under one assumption: *a human writes precise instructions, a machine executes them deterministically.* Anima discards that assumption.

In Anima:

- The **programmer** may be a human, an AI agent, or a human-AI pair.
- The **compiler** is intelligent — it resolves goals into implementations.
- **Uncertainty** is a first-class citizen, not an afterthought.
- **Code can evolve** at runtime, governed by explicit fitness and safety rules.
- **Agents** are language primitives, not library constructs.

## Design Principles

### 1. Intent Over Implementation

Traditional languages force you to specify *how*. Anima lets you specify *what* — with hard constraints (`ensure`), soft preferences (`prefer`), and negative constraints (`avoid`). The compiler resolves intents into concrete implementations.

This doesn't mean Anima is purely declarative. You can mix imperative code freely with intent constraints. The language doesn't force a paradigm — it gives you a spectrum from fully-specified to fully-intent-driven.

### 2. Confidence Is Not Optional

The real world is uncertain. Sensor readings are noisy, API responses may be wrong, AI predictions have error rates. Instead of pretending everything is deterministic, Anima makes confidence a type-level construct. A value of type `String @ 0.92` explicitly states: "I am 92% confident this is correct." The type system propagates confidence through computations, and you can branch on it.

### 3. Agents Are Not Threads

Agents in Anima are not goroutines, actors, or threads. They are autonomous computational entities with:

- **Identity** — their own context and memory
- **Capabilities** — declared tools they can use
- **Boundaries** — hard limits on cost, time, and permissions
- **Agency** — the ability to delegate, negotiate, and escalate

An agent can delegate work to other agents, negotiate for shared resources, and escalate to humans when its confidence is too low.

### 4. Code Should Learn

Functions marked `evolving` can be rewritten by the runtime's evolution engine to improve fitness metrics. This is not unconstrained self-modification — it operates within explicit governance bounds that specify what can change, what cannot, when to trigger evolution, and when to roll back.

### 5. Familiar Syntax, Novel Semantics

Anima's syntax is modeled after Kotlin and TypeScript. If you know either language, most Anima code will look familiar. The novel constructs are additive — they extend the syntax without replacing it. You can write a pure Kotlin-style function and it works. You can write intent-driven agent code and it works. You can mix both in the same file.

## Paradigm

Anima is **multi-paradigm** in a new sense:

| Paradigm | Anima Construct |
|----------|-----------------|
| Imperative | `fun` with standard control flow |
| Declarative | `intent fun` with constraints |
| Object-oriented | `data entity`, `agent` with methods |
| Functional | Extension functions, lambdas, immutability (`val`) |
| Probabilistic | Confidence types, fuzzy predicates |
| Agent-oriented | `agent`, `delegate`, `team` |
| Evolutionary | `evolving` functions, fitness metrics |

## Target Use Cases

Anima is designed for:

- **AI-orchestrated systems** — multi-agent pipelines, content platforms, recommendation engines
- **Systems with inherent uncertainty** — sensor fusion, NLP pipelines, computer vision
- **Self-adaptive software** — systems that improve with usage data
- **Spec-driven development** — defining what a system should do, then letting the compiler figure out how

Anima is *not* designed for:

- Systems programming (use Rust or C)
- Performance-critical inner loops (the runtime overhead of confidence tracking and intent resolution is non-trivial)
- Environments without LLM access (the compiler requires a running LLM for intent resolution and fuzzy predicate evaluation)

## Relationship to Existing Languages

| Language | What Anima Borrows | What Anima Adds |
|----------|--------------------|-----------------|
| Kotlin | `fun`, `val`/`var`, `when`, data classes, extension functions, coroutines model | Intent functions, confidence types, agents |
| TypeScript | Structural types, union types, generics, type aliases | NL type, fuzzy predicates |
| Prolog | Declarative constraint solving | Soft constraints with weights, AI-powered resolution |
| Stan/Pyro | Probabilistic types | Confidence as a general-purpose type annotation |
| Erlang/Elixir | Actor model, fault tolerance | Agent model with governance, evolution |
