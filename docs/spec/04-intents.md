# 04 — Intents

> Anima Language Specification v0.1.0

## Overview

Intent functions are the core innovation of Anima. An `intent fun` declares *what* a function should achieve, not *how* to achieve it. The compiler's intent resolver generates an implementation that satisfies the constraints.

## Syntax

```anima
intent fun <name>(<params>): <ReturnType> {
    ensure { <hard constraint> }          // MUST hold — violation is a compile/runtime error
    prefer { <soft constraint> } weight N // SHOULD hold — weighted optimization target
    avoid  { <negative constraint> }      // SHOULD NOT hold — weighted penalty
    assume { <precondition> }             // assumed true about inputs
    hint("<natural language guidance>")   // NL hint to the resolver

    // Optional: imperative code mixed in
    val intermediate = someComputation()

    // Optional: fallback if resolution fails
    fallback { <deterministic implementation> }

    // Optional: adaptation for specific failure modes
    adapt<ErrorType> { <handling logic> }

    // Optional: cost bounds
    cost {
        maxTokens = 10_000
        maxLatency = 5.seconds
        maxDollars = 0.02
    }
}
```

## Constraint Types

### ensure — Hard Constraints

Hard constraints **must** be satisfied. If the resolver cannot find an implementation that satisfies all `ensure` clauses, compilation fails.

```anima
intent fun sort(arr: List<Int>): List<Int> {
    ensure { output.isPermutationOf(arr) }  // can't lose or add elements
    ensure { output.isAscending() }          // must be sorted
}
```

`ensure` constraints are verified:
- At compile time (if statically provable via SMT solver)
- At runtime (as post-condition checks)
- During evolution (any evolved version must still pass)

### prefer — Soft Constraints

Soft constraints are optimization targets. The resolver tries to satisfy them but won't fail if it can't. Each `prefer` clause has an optional weight (default 1.0).

```anima
intent fun sort(arr: List<Int>): List<Int> {
    ensure { output.isAscending() }
    prefer { timeComplexity <= O(n * log(n)) } weight 0.8
    prefer { memoryOverhead <= O(1) } weight 0.5
    prefer { isStable() } weight 0.3   // stable sort preferred but not required
}
```

The resolver scores candidates: `score = Σ(prefer_satisfaction * weight)`.

### avoid — Negative Constraints

Negative soft constraints. The resolver penalizes candidates that trigger these.

```anima
intent fun recommend(user: User): List<Post> {
    avoid { filterBubble(user, output) }
    avoid { output.any { it.isClickbait() } } weight 0.9
    avoid { output.topicDiversity() < 2 }
}
```

### assume — Preconditions

Preconditions that the resolver can rely on:

```anima
intent fun binarySearch(arr: List<Int>, target: Int): Int? {
    assume { arr.isAscending() }  // resolver can assume sorted input
    ensure { output == null || arr[output!!] == target }
}
```

### hint — Natural Language Guidance

Free-form guidance to the AI-powered resolver:

```anima
intent fun generateThumbnail(image: Image): Image {
    ensure { output.width <= 200 }
    hint("use content-aware cropping if aspect ratio change exceeds 20%")
    hint("prefer the rule-of-thirds for composition")
}
```

## Mixed Intent + Imperative

Intent functions can contain imperative code alongside constraints. This is useful when some logic is straightforward but the core challenge is goal-oriented:

```anima
intent fun processOrder(order: Order): Receipt {
    // Imperative: straightforward logic
    val items = order.items.filter { it.inStock }
    val total = items.sumOf { it.price }
    val tax = total * order.region.taxRate

    // Intent: the hard part — figuring out shipping
    ensure { receipt.shippingMethod.delivers(order.address) }
    prefer { receipt.shippingCost.isMinimized() }
    prefer { receipt.deliveryDate <= order.requestedDate }
    avoid  { receipt.shippingMethod.carbonFootprint > threshold }
}
```

## Fallback

A fallback provides a deterministic implementation if the intent resolver fails or times out:

```anima
intent fun translate(text: NL, to: Language): NL {
    ensure { output.language == to }
    ensure { output.preservesMeaning(text) }
    prefer { output.isNatural() }

    fallback {
        // If intent resolution fails, use a basic API call
        translationApi.translate(text.toString(), to.code)
    }
}
```

## Adaptation

`adapt` blocks handle specific failure modes with custom logic:

```anima
intent fun fetchData(source: DataSource): Dataset {
    ensure { output.conforms(schema) }

    adapt<ConnectionTimeout> {
        // Retry with exponential backoff
        retry(maxAttempts = 3, backoff = exponential(base = 1.seconds))
    }

    adapt<SchemaViolation> { violation ->
        // Try to fix the data
        val fixed = autoFix(violation.record, schema)
        if (fixed != null) use(fixed) else skip(violation.record)
    }

    adapt<RateLimited> { error ->
        // Wait and retry
        delay(error.retryAfter)
        retry()
    }
}
```

## Intent Resolution Pipeline

When the compiler encounters an `intent fun`, it:

1. **Parses** all constraint clauses into a formal constraint set
2. **Classifies** constraints as formal (SMT-solvable) or fuzzy (AI-evaluated)
3. **Decomposes** the intent into sub-goals if needed
4. **Generates** candidate implementations (via LLM + constraint solving)
5. **Scores** each candidate against prefer/avoid weights
6. **Verifies** the top candidate against all ensure clauses
7. **Caches** the resolution in `anima.lock` for reproducibility
8. **Emits** target code with embedded post-condition checks

```
intent fun sort(...)
    │
    ├── ensure: isPermutationOf → formal (SMT)
    ├── ensure: isAscending → formal (SMT)
    ├── prefer: O(n log n) → formal (complexity analysis)
    └── prefer: isStable → formal (algorithm property)
    │
    ▼
Candidates: [mergesort, timsort, quicksort, heapsort]
    │
    ├── mergesort: ensure ✓, prefer 0.9 (O(n log n) ✓, stable ✓)
    ├── timsort:   ensure ✓, prefer 0.95 (O(n log n) ✓, stable ✓, adaptive)
    ├── quicksort: ensure ✓, prefer 0.6 (O(n log n) avg ✓, stable ✗)
    └── heapsort:  ensure ✓, prefer 0.7 (O(n log n) ✓, stable ✗)
    │
    ▼
Resolution: timsort @ 0.95 → cached in anima.lock
```

## Pinned Resolutions

Intent resolutions are non-deterministic (different LLM calls may produce different implementations). To ensure reproducibility, resolutions are pinned in `anima.lock`:

```toml
# anima.lock — auto-generated, do not edit manually

[resolutions]

[resolutions.sort]
strategy = "timsort"
resolved_at = "2026-02-28T14:30:00Z"
confidence = 0.95
compiler_version = "0.1.0"
llm_model = "claude-opus-4-6"
hash = "a3f8b2c1"

[resolutions.recommend]
strategy = "collaborative_filtering_v2"
resolved_at = "2026-02-28T14:31:00Z"
confidence = 0.88
version = 3   # evolved twice
```

To re-resolve an intent: `anima resolve --fresh <function_name>`
