# 06 — Memory Model

> Anima Language Specification v0.1.0

## Overview

Anima has a three-tier memory hierarchy built into the language. Memory is not just "variables" — it includes semantic retrieval, automatic learning, and decay. This makes Anima programs context-aware in a way no traditional language achieves.

## Memory Tiers

### Ephemeral Memory

Scratchpad memory that exists for a single intent resolution. Garbage collected aggressively.

```anima
ephemeral {
    var scratch: Any? = null
    var intermediateResults: MutableList<Any> = mutableListOf()
}
```

- **Lifetime:** Single intent resolution
- **Storage:** In-memory only
- **Access:** Current agent only
- **Use case:** Intermediate computation, temporary state

### Session Memory

Persists for one program execution. Checkpointed for crash recovery.

```anima
session {
    val currentTask: Task by sessionScoped()
    var filesModified: MutableList<Path> = mutableListOf()
    var recentErrors: MutableList<Error> = mutableListOf()
    var requestCount: Int = 0
}
```

- **Lifetime:** One program execution
- **Storage:** In-memory, checkpointed to disk
- **Access:** All agents in the session
- **Use case:** Current task state, error history, session counters

### Persistent Memory

Survives across program executions. Stored in a combination of vector database (for semantic search) and knowledge graph (for structured relationships).

```anima
persistent {
    val architectureDecisions: List<Decision> by stored()
    val conventions: Conventions by stored()
    var knownBugs: List<Bug> by stored()
    var learnedPatterns: List<Pattern> by stored()
}
```

- **Lifetime:** Indefinite (subject to decay)
- **Storage:** Vector DB + knowledge graph on disk
- **Access:** All agents, scoped by permissions
- **Use case:** Architecture decisions, learned patterns, user preferences

## Context Declaration

A `context` block declares the memory layout for an agent or the application:

```anima
context AppMemory {
    persistent {
        val contentGuidelines: NL by stored()
        val moderationHistory: List<ModerationDecision> by stored()
        var popularTopics: List<String> by stored()
    }

    session {
        val activeUsers: MutableMap<ID, User> = mutableMapOf()
        var requestCount: Int = 0
    }

    ephemeral {
        var scratch: Any? = null
    }
}
```

## Semantic Retrieval

The `recall` function performs semantic search across memory tiers:

```anima
// Simple recall
val memories = recall("what format does the payment API use?")
// Returns: List<Memory> ranked by relevance * recency * confidence

// Recall with tier filter
val recent = recall("recent deployment issues", from = session)

// Recall with confidence threshold
val reliable = recall("database schema", minConfidence = 0.8)
```

### Memory Type

```anima
data class Memory(
    val content: Any,
    val source: MemoryTier,        // ephemeral, session, persistent
    val relevance: Float,           // 0.0 - 1.0
    val confidence: Float,          // 0.0 - 1.0
    val createdAt: DateTime,
    val lastAccessed: DateTime,
    val provenance: Provenance       // who/what created this memory
)
```

### How Retrieval Works

```
recall("payment API format")
    │
    ├── Vector search: embed query → find similar vectors in persistent store
    ├── Graph search: traverse knowledge graph from "payment" and "API" nodes
    ├── Session scan: check current session for relevant state
    │
    ▼
    Score = relevance * recency * confidence
    │
    ├── "Payment API uses JSON-RPC 2.0" (persistent, relevance=0.95, conf=0.90) → 0.86
    ├── "API timeout set to 30s for payment" (session, relevance=0.70, conf=1.0) → 0.70
    └── "Payment redesign discussed in RFC-12" (persistent, relevance=0.60, conf=0.85) → 0.51
```

## Auto-Learning

Agents can declare rules for automatically creating persistent memories from patterns observed during execution:

```anima
autoLearn {
    // If the same error is fixed the same way 3+ times, remember the pattern
    rule("repeated error fix") {
        whenever { error.fixPattern.count >= 3 }
        store {
            Pattern(
                trigger = error.signature,
                resolution = error.fixPattern.mostCommon(),
                confidence = error.fixPattern.successRate
            )
        }
    }

    // If a user consistently prefers a certain format, remember it
    rule("user format preference") {
        whenever { user.formatChoices.dominant().frequency > 0.8 }
        store {
            Preference(
                user = user.id,
                key = "output_format",
                value = user.formatChoices.dominant().value,
                confidence = user.formatChoices.dominant().frequency
            )
        }
    }
}
```

## Memory Decay

Persistent memories that are not accessed lose confidence over time:

```anima
decay {
    rate = 0.01 per day         // lose 1% confidence per day unused
    floor = 0.3                  // never drops below 30%
    refreshOn = Access           // accessing a memory resets decay
    archiveBelow = 0.35          // archive memories near the floor
}
```

### Decay Rationale

Decay prevents memory bloat and ensures that stale information naturally loses influence. A memory about "the database uses PostgreSQL 12" will decay if the system has since migrated — but accessing it resets the decay clock, so actively-used memories stay fresh.

## Context Dependencies

Functions can declare what context they need:

```anima
fun refactorModule(module: Module): Module
    needs context.architectureDecisions   // won't run without this
    reads context.knownBugs               // optional but useful
{
    // guaranteed to have architectureDecisions available
    // knownBugs may be empty but won't cause an error
}
```

- `needs` — hard dependency. If the context is missing, the function raises `MissingContextError` rather than running with incomplete information.
- `reads` — soft dependency. The function works without it but benefits from it.
