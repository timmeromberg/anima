# 07 — Evolution Engine

> Anima Language Specification v0.1.0

## Overview

Functions marked `evolving` can be rewritten by the runtime to improve fitness metrics. This is the most powerful and most dangerous feature of Anima — code that rewrites itself. It operates under strict governance to prevent runaway self-modification.

## Syntax

```anima
evolving intent fun <name>(<params>): <ReturnType> {
    // Standard intent constraints
    ensure { ... }
    prefer { ... }
    avoid  { ... }

    // Initial strategy (developer-written)
    strategy { ... }

    // Evolution rules
    evolve {
        fitness { ... }             // what metrics to optimize
        allow { ... }               // what the engine can change
        forbid { ... }              // what it absolutely cannot change
        triggerWhen { ... }         // when to start evolving
        rollbackWhen { ... }        // when to revert
        review { ... }             // approval workflow
    }
}
```

## Full Example

```anima
evolving intent fun recommend(user: User, count: Int = 10): List<Post> {
    ensure { output.size <= count }
    ensure { output.all { it.qualityScore @ (>0.6) } }
    prefer { user.engagementWith(output).isMaximized() }
    prefer { output.topicDiversity() >= 3 }
    avoid  { filterBubble(user, output) }
    avoid  { output.any { it.isClickbait() } }

    strategy {
        val profile = context.userModels[user.id]
        val candidates = Post.query {
            where { published == true }
            orderBy { qualityScore.desc }
            limit(100)
        }

        candidates
            .map { post ->
                val relevance = similarity(embed(profile), embed(post))
                val noveltyBonus = if (post.isNovelFor(user)) 0.2 else 0.0
                Scored(post, relevance + noveltyBonus)
            }
            .sortedByDescending { it.score }
            .take(count)
            .map { it.item }
    }

    evolve {
        fitness {
            readCompletionRate  weight 0.4
            shareRate           weight 0.3
            returnRate24h       weight 0.3
        }

        allow {
            modifyRankingLogic()
            addSignals(from = listOf(user.history, user.demographics))
            changeResultCount(range = 5..20)
        }

        forbid {
            reduceDiversityBelow(3)
            increaseLatencyBeyond(200.milliseconds)
            accessData(user.privateMessages)
            useDarkPatterns()
        }

        triggerWhen { fitness.score < 0.4 lasting 7.days }
        rollbackWhen { fitness.score < previousVersion.score * 0.9 }

        review {
            autoApproveIf { changeScope == ChangeScope.MINOR }
            humanApproveIf { changeScope == ChangeScope.MAJOR }
        }
    }
}
```

## Fitness Metrics

Fitness metrics are named, weighted measurements that drive evolution:

```anima
fitness {
    clickThroughRate   weight 0.4    // higher is better
    purchaseRate       weight 0.3    // higher is better
    userSatisfaction   weight 0.3    // higher is better
}
```

Each metric is:
- **Named** — a clear identifier
- **Weighted** — relative importance (weights must sum to 1.0)
- **Measured** — the runtime collects these from production data
- **Directional** — higher is better (use `1 - metric` to invert)

### Composite Fitness Score

```
fitness.score = Σ(metric_value * weight)
```

The composite score is a single float (0.0 - 1.0) that the evolution engine maximizes.

## Allow / Forbid

### Allow Block

What the evolution engine is permitted to change:

```anima
allow {
    modifyRankingLogic()           // change sort/filter/score logic
    addSignals(from = listOf(...)) // introduce new data sources
    addFilteringSteps()            // add new filter conditions
    changeResultCount(range = 5..20)  // adjust output size
    modifyWeights()                // tune numeric weights
}
```

### Forbid Block

Hard limits that evolution **cannot** cross. These are verified at every evolution step:

```anima
forbid {
    reduceDiversityBelow(3)              // hard floor on diversity
    increaseLatencyBeyond(200.ms)        // performance SLA
    accessData(user.privateMessages)     // privacy boundary
    useDarkPatterns()                    // ethical boundary (fuzzy!)
    modifyEnsureClauses()                // can't weaken guarantees
    removeLogging()                      // audit trail must remain
}
```

Forbid clauses can be fuzzy predicates (like `useDarkPatterns()`) — the AI evaluates whether a candidate evolution violates them.

## Evolution Pipeline

```
 PRODUCTION (v3)
     │
     │ metrics collected
     ▼
 MONITOR — is fitness declining?
     │
     │ yes: fitness < 0.4 for 7 days
     ▼
 EVOLUTION ENGINE
     │
     ├── 1. Analyze current strategy v3
     ├── 2. Identify weakness (e.g., "novelty bonus is static")
     ├── 3. Generate N candidate mutations
     │      ├── v4a: dynamic novelty based on user history
     │      ├── v4b: add recency signal
     │      ├── v4c: collaborative filtering hybrid
     │      ├── v4d: topic-cluster diversification
     │      └── v4e: time-of-day personalization
     │
     ├── 4. Verify each against governance
     │      ├── v4a: ✓ all forbid clauses pass
     │      ├── v4b: ✓ all forbid clauses pass
     │      ├── v4c: ✗ latency exceeds 200ms → rejected
     │      ├── v4d: ✓ all forbid clauses pass
     │      └── v4e: ✓ all forbid clauses pass
     │
     ├── 5. Score remaining by predicted fitness
     │      ├── v4a: predicted 0.62
     │      ├── v4b: predicted 0.55
     │      ├── v4d: predicted 0.58
     │      └── v4e: predicted 0.51
     │
     └── 6. Select top candidate: v4a
     ▼
 APPROVAL
     │ changeScope = MINOR (ranking tweak) → auto-approved
     ▼
 A/B TEST SANDBOX
     │ shadow traffic: v3 vs v4a
     │ result: v4a fitness 0.59 vs v3 fitness 0.38
     ▼
 GRADUAL ROLLOUT
     │ canary: 1% → 5% → 25% → 100%
     │ monitoring for rollback triggers at each step
     ▼
 v4a IS NOW PRODUCTION (v4)
     │
     │ Full audit trail preserved:
     │ - What changed and why
     │ - Fitness improvement
     │ - Governance verification results
     │ - Approval record
     └── v3 archived, rollback ready
```

## Version History

Every evolved version is preserved with full metadata:

```anima
// Queryable from code
val history = recommend.evolutionHistory()
// [
//   Version(1, fitness=0.45, author="developer", date="2026-02-01"),
//   Version(2, fitness=0.52, author="evolution_engine", date="2026-02-10"),
//   Version(3, fitness=0.38, author="evolution_engine", date="2026-02-20"),  // regression
//   Version(4, fitness=0.59, author="evolution_engine", date="2026-02-28"),
// ]

// Rollback programmatically
recommend.rollbackTo(version = 2)
```

## Change Scope Classification

The evolution engine classifies each mutation's scope:

| Scope | Description | Examples | Default Approval |
|-------|-------------|----------|-----------------|
| `TRIVIAL` | Numeric weight tuning | Change 0.3 to 0.35 | Auto |
| `MINOR` | Logic modification within existing structure | Reorder filters, add condition | Auto |
| `MAJOR` | Structural change or new signals | Add collaborative filtering, new data source | Human |
| `BREAKING` | Changes ensure clause behavior | Never allowed — blocked by forbid |

## Safety Invariants

The evolution engine guarantees:

1. **Ensure clauses are immutable** — evolution cannot weaken or remove them
2. **Forbid clauses are enforced** — every candidate is verified before testing
3. **Rollback is automatic** — if fitness regresses by the rollback threshold, the previous version is restored immediately
4. **Audit trail is complete** — every evolution step is logged with full provenance
5. **Budget is bounded** — evolution cycles count against the agent's cost budget
