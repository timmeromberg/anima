# 09 — Runtime Architecture

> Anima Language Specification v0.1.0

## Overview

Anima's runtime is substantially more complex than a traditional language runtime. It includes an intelligent compiler with LLM integration, a multi-target code generator, an agent supervisor, a memory manager, an evolution engine, and a governance monitor.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    DEVELOPER INTERFACE                   │
│         (Conversational + Code + Visual hybrid)          │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   ANIMA COMPILER                         │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │  Parser   │→│ Semantic   │→│  Intent Decomposer   │  │
│  │          │  │ Analyzer   │  │                      │  │
│  └──────────┘  └───────────┘  └──────────┬───────────┘  │
│                                           │              │
│  ┌────────────────────────────────────────▼───────────┐  │
│  │            CONSTRAINT SOLVER                       │  │
│  │  Z3 (formal) + LLM (fuzzy) + hybrid scoring       │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼───────────────────────────────┐  │
│  │         MULTI-TARGET CODE GENERATOR                │  │
│  │  Native (LLVM) | WASM | SQL | IaC | SDK Gen       │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   ANIMA RUNTIME                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              AGENT SUPERVISOR                     │   │
│  │  Lifecycle, delegation, circuit-breaking           │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐  │
│  │CONFIDENCE│ │  AGENT    │ │  MEMORY   │ │EVOLUTION│  │
│  │PROPAGATOR│ │  RUNTIME  │ │  MANAGER  │ │ ENGINE  │  │
│  └──────────┘ └───────────┘ └───────────┘ └─────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │            GOVERNANCE MONITOR                     │   │
│  │  Boundary enforcement, cost accounting, audit log │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │           NEGOTIATION PROTOCOL                    │   │
│  │  Resource contention, conflict resolution         │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Compilation Pipeline

### Stage 1: Parse

Tree-sitter based parser. Incremental, error-tolerant. The grammar is designed so that incomplete or slightly malformed code still parses — agents produce imperfect code and the language handles it gracefully.

```
Source (.anima) → Tree-sitter → AST

Error recovery:
  Missing ')' at line 5 → auto-corrected, WARNING emitted
  Unknown keyword 'fnu' → did you mean 'fun'? auto-corrected
  Parse confidence: 0.97
```

### Stage 2: Semantic Analysis

The semantic analyzer has an embedded LLM for understanding NL types and fuzzy predicates:

```
AST node: ensure { output.looksLike(input) }

Analysis:
  1. "looksLike" is not defined → check fuzzy predicate registry
  2. LLM interprets: "structural/visual similarity"
  3. Generate signature: fuzzy fun <T> T.looksLike(other: T): Boolean
  4. Select evaluation strategy:
     - Image → CLIP embedding similarity > 0.85
     - Text → semantic embedding similarity > 0.80
     - Structured → field-by-field with tolerance
  5. Interpretation confidence: 0.91
```

Also performs:
- Type checking (including confidence propagation)
- Invariant verification
- Boundary validation (agents only reference permitted tools)
- Context dependency resolution

### Stage 3: Intent Decomposition

High-level intents are broken into resolution graphs:

```
intent fun sort(arr: List<Int>): List<Int>
    ensure { isPermutationOf } + ensure { isAscending } + prefer { O(n log n) }
    │
    ├── SubGoal: reorder (ensure permutation)
    │   ├── Comparison sorts: quicksort, mergesort, heapsort, timsort
    │   └── Non-comparison: radix, counting (if int)
    │
    ├── SubGoal: ascending order (ensure)
    │   └── Post-condition check
    │
    └── SubGoal: O(n log n) (prefer)
        └── Eliminates: bubble, insertion, selection sort
```

### Stage 4: Constraint Solving

Hybrid engine combining formal methods and AI:

**Formal solver (Z3/SMT)** handles:
- Numeric constraints (`output.length <= 10`)
- Logical constraints (`output.all { it > 0 }`)
- Complexity constraints (`O(n log n)`)
- Invariant verification

**LLM solver** handles:
- Fuzzy predicates (`isReadable()`, `isAestheticallyPleasing()`)
- NL constraints (`preservesMeaning()`)
- Semantic constraints (`looksLike()`)

**Scoring:**
```
For each candidate:
  score = Σ(ensure_pass ? ∞ : -∞)      // hard: must all pass
        + Σ(prefer_score * weight)       // soft: weighted sum
        - Σ(avoid_score * weight)        // negative: weighted penalty
        + performance_bonus              // efficiency bonus
```

### Stage 5: Code Generation

The winning candidate is compiled to target-specific code with embedded intent metadata:

```
                    ┌─────────────┐
                    │ Resolution  │
                    │ (timsort)   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌───────────┐  ┌────────────┐  ┌────────────┐
    │ Rust/LLVM │  │    WASM    │  │  JVM/JS    │
    │ (native)  │  │ (browser)  │  │ (interop)  │
    └───────────┘  └────────────┘  └────────────┘
```

Generated code includes:
- The implementation
- Post-condition checks (debug mode)
- Intent metadata (for evolution)
- Confidence tracking instrumentation

## Runtime Components

### Agent Supervisor

Manages the lifecycle of all agent instances:

- **Spawn** — creates sandboxed agent instances
- **Schedule** — dispatches intents to agents
- **Monitor** — tracks resource usage per agent
- **Circuit-break** — kills agents that exceed boundaries
- **Audit** — logs all agent actions for governance

### Confidence Propagator

Tracks confidence through all computations:

- Annotates every intermediate value with confidence
- Applies propagation rules (multiply, min, boost)
- Raises warnings when confidence drops below thresholds
- Provides confidence traces for debugging

### Memory Manager

See [06 — Memory Model](06-memory-model.md) for details. The runtime component:

- Manages the three-tier memory hierarchy
- Runs semantic search (vector similarity + graph traversal)
- Executes auto-learning rules
- Applies memory decay
- Handles memory persistence (disk I/O, vector DB)

### Evolution Engine

See [07 — Evolution Engine](07-evolution-engine.md) for details. The runtime component:

- Monitors fitness metrics from production
- Generates candidate mutations when triggered
- Verifies candidates against governance rules
- Runs A/B tests in shadow mode
- Manages gradual rollout with auto-rollback

### Governance Monitor

The central authority for safety:

- Enforces all boundary rules across all agents
- Tracks cost ($$ spent on LLM calls, compute, etc.)
- Maintains complete audit log of every decision
- Provides kill switch for any agent or evolution path
- Handles human escalation for `requiresApproval` actions

### Negotiation Protocol

Manages multi-agent resource contention:

- Priority queues with fairness guarantees
- Semantic merge for compatible changes
- Deadlock detection and automatic resolution
- Human escalation for irreconcilable conflicts

## External Dependencies

The Anima runtime requires:

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| LLM service | Intent resolution, fuzzy predicate evaluation, evolution | Yes |
| Z3/SMT solver | Formal constraint solving | Yes |
| Vector database | Semantic memory retrieval | Yes (for persistent memory) |
| Embedding model | Vector generation for memory and NL ops | Yes |

This means Anima programs **cannot run offline** in general. A future "compiled mode" could pre-resolve all intents and embed the results, enabling offline execution of resolved code.

## Cost Model

Every operation that involves AI has a cost:

```
> anima cost-report --last 24h

Compilation:       $0.12  (3 recompilations)
Runtime LLM:       $4.87  (fuzzy predicates: 2,340 evaluations)
Evolution:         $1.23  (1 cycle, 5 candidates tested)
Memory retrieval:  $0.34  (890 recall() calls)
Embedding:         $0.08  (450 embeddings)
────────────────────────
Total:             $6.64
Budget remaining:  $93.36 / $100.00 (daily)
```

Cost is a first-class concern. Every agent has a cost budget, and the governance monitor enforces it.

## Determinism and Reproducibility

Intent resolution is non-deterministic (LLM-based). To ensure reproducibility:

1. **Resolution pinning** — resolved intents are cached in `anima.lock`
2. **Deterministic replay** — re-executing with a pinned lock file produces identical behavior
3. **Fresh resolution** — explicitly requested via `anima resolve --fresh <name>`
4. **Evolution versioning** — every evolved version is archived with full metadata

```toml
# anima.lock
[resolutions.sort]
strategy = "timsort"
resolved_at = "2026-02-28T14:30:00Z"
confidence = 0.95
compiler_version = "0.1.0"
llm_model = "claude-opus-4-6"
checksum = "a3f8b2c1"
```
