# 05 — Agents

> Anima Language Specification v0.1.0

## Overview

Agents are first-class language constructs in Anima. An agent is an autonomous computational entity with its own identity, memory, tools, and governance boundaries. Agents are not threads, goroutines, or actors — they are a fundamentally new concurrency and autonomy primitive.

## Agent Declaration

```anima
agent <Name>(
    <constructor parameters>
) {
    context { ... }       // agent's private memory
    tools { ... }         // capabilities the agent can use
    boundaries { ... }    // governance: cost, time, permission limits
    team { ... }          // sub-agents (optional)

    intent fun <method>(...): ... { ... }  // agent behaviors
    fun <method>(...): ... { ... }         // deterministic helpers
    on<Event> { ... }                      // event handlers
}
```

### Full Example

```anima
agent Moderator(
    private val guidelines: NL = recall("content guidelines")
) {
    context {
        val history: MutableList<ModerationDecision> = mutableListOf()
        var accuracy: Float = 0.0
        var totalProcessed: Int = 0
    }

    tools {
        fun classifyContent(text: NL): ContentClassification
        fun checkFactuality(claim: NL): FactCheck @ Confidence
        fun detectToxicity(text: NL): ToxicityScore
    }

    boundaries {
        maxCost = 0.01.dollars per invocation
        maxTime = 5.seconds
        maxToolCalls = 20

        can { readPosts; flagPosts; hidePosts }
        cannot { deletePosts; banUsers; accessDMs }
        requiresApproval { hidePosts where { post.author.isVerified } }
    }

    intent fun moderate(post: Post): ModerationResult {
        ensure { result.decision in setOf(APPROVE, FLAG, HIDE) }
        ensure { result.hasExplanation() }
        prefer { result.isConsistentWith(context.history) }
        avoid  { censoringLegitimateDiscourse(post) }

        val factCheck = checkFactuality(post.body)
        if (factCheck.isFalse @ (>0.9)) {
            hint("strongly consider flagging as misinformation")
        }

        adapt<AmbiguousContent> {
            ask("Is this post acceptable? ${post.body.summarize()}")
        }
    }

    on<FeedbackReceived> { event ->
        context.history.find { it.postId == event.postId }?.let {
            it.wasCorrect = event.userAgreed
            context.accuracy = context.history.accuracyRate()
        }
    }
}
```

## Context

An agent's context is its private memory — state that persists across method calls within a session:

```anima
context {
    // Immutable context (set once)
    val schema: Schema = load("schema.json")
    val config: Config = Config.default()

    // Mutable context (evolves during execution)
    var processedCount: Int = 0
    var recentErrors: MutableList<Error> = mutableListOf()
    var performanceMetrics: Metrics = Metrics.empty()
}
```

Context is private to the agent instance. Other agents cannot access it directly — they must communicate through messages or delegation results.

## Tools

Tools are capabilities that an agent can invoke. They're declared as function signatures — the runtime provides the implementation:

```anima
tools {
    fun httpGet(url: String): Response
    fun queryDb(sql: String): ResultSet
    fun embedText(text: String): Vector
    fun runCode(code: String, language: String): ExecutionResult
}
```

Tools are **gated by boundaries**. An agent can only use tools that its boundary rules permit.

### Built-in Tools

Every agent has implicit access to:

```anima
// Available to all agents (cannot be revoked)
fun log(message: String, level: LogLevel = INFO)
fun recall(query: String): List<Memory>  // semantic memory search
fun emit(event: Event)                    // emit events
```

## Boundaries

Boundaries are the governance layer — hard limits on what an agent can do:

```anima
boundaries {
    // Resource limits
    maxCost = 1.00.dollars per invocation
    maxTime = 30.seconds
    maxMemory = 512.megabytes
    maxToolCalls = 100 per invocation
    maxLlmTokens = 50_000 per invocation

    // Capability grants
    can {
        readFiles(path = "/data/**")       // scoped file read
        writeDb(target = "staging_*")      // scoped DB write
        httpGet(domain = "*")              // unrestricted HTTP GET
    }

    // Capability denials
    cannot {
        writeDb(target = "prod_*")
        sendEmail
        execShell
        accessData(User::privateMessages)
    }

    // Gated capabilities (require human/supervisor approval)
    requiresApproval {
        deleteRecords
        modifySchema
        hidePosts where { post.author.isVerified }
    }

    // Blast radius control
    maxFilesModified = 10
    maxRowsAffected = 10_000
}
```

### Boundary Enforcement

Boundaries compile to a **capability-based security model**. The runtime enforces them at the syscall level:

- Attempting a denied action → `BoundaryViolation` error
- Attempting a gated action → pauses execution, requests approval
- Exceeding resource limits → `CircuitBreaker` kills the agent
- All boundary checks are logged for audit

## Delegation

Agents delegate work to other agents using the `delegate` keyword:

```anima
val result = delegate(team.researcher) { analyze(spec) }
```

Delegation is:
- **Scoped** — the delegatee inherits the delegator's remaining budget (cost, time)
- **Supervised** — the delegator can set additional constraints on the delegation
- **Typed** — the return type of the delegation block is checked

### Delegation with Constraints

```anima
val result = delegate(team.coder) {
    maxCost = 0.50.dollars        // sub-budget
    maxTime = 15.seconds          // time limit for this delegation
    implement(design)
}
```

### Parallel Delegation

```anima
// Structured concurrency — like Kotlin coroutineScope
val results = parallel {
    sources.map { source ->
        async { delegate(team.processor) { ingest(source) } }
    }
}.awaitAll()
```

## Teams

An agent can declare a team of sub-agents:

```anima
agent Orchestrator {
    team {
        val researcher = spawn<ResearchAgent>()
        val coder = spawn<CodingAgent>()
        val reviewer = spawn<ReviewAgent>(strictness = HIGH)
    }

    intent fun buildFeature(spec: NL): Repository {
        val design = delegate(team.researcher) { analyze(spec) }
        val code = delegate(team.coder) { implement(design) }
        val review = delegate(team.reviewer) { check(code, against = spec) }

        if (review.issues.isNotEmpty()) {
            return delegate(team.coder) { fix(code, issues = review.issues) }
        }
        return code
    }
}
```

### Team Lifecycle

1. **Spawn** — `spawn<AgentType>()` creates a new agent instance
2. **Delegate** — send work to a team member
3. **Monitor** — the parent agent can check status of delegated work
4. **Terminate** — team members are terminated when the parent agent completes or is killed

Team members inherit the parent's boundary budget. The total cost of all team members cannot exceed the parent's `maxCost`.

## Agent Communication

### Protocols

Agents communicate through typed message protocols:

```anima
protocol AnalysisPipeline {
    message RawData(
        val payload: Stream<Record>,
        val source: String,
        val quality: Float
    )

    message CleanedData(
        val payload: List<Record>,
        val transformsApplied: List<Transform>,
        val rowsDropped: Int,
        val confidence: Float
    )

    message AnalysisResult(
        val findings: List<Finding>,
        val confidence: Float,
        val methodology: NL
    )
}
```

### Event Handlers

Agents can react to events:

```anima
on<RawData> { msg ->
    val cleaned = delegate(self) { clean(msg.payload) }
    emit(CleanedData(
        payload = cleaned,
        transformsApplied = context.transforms,
        rowsDropped = msg.payload.count() - cleaned.size,
        confidence = context.confidence
    ))
}

on<CleanedData> { msg ->
    when {
        msg.confidence > 0.8 -> processHighConfidence(msg)
        else -> requestHumanReview(msg)
    }
}
```

## Agent Lifecycle

```
DEFINE → SPAWN → INITIALIZE → READY ⇄ RESOLVING → COMMITTING → READY
                                          │
                                     AWAITING APPROVAL (if gated action)
                                          │
                                     ADAPTING (on error)

At any point: CIRCUIT BROKEN (governance kill)
```

## Negotiation

When multiple agents contend for a shared resource, they negotiate:

```anima
shared resource DatabasePool(
    val capacity: Int = 100,
    val conflictStrategy: ConflictStrategy = SemanticMerge
) {
    accessPolicy {
        priority = byUrgencyScore()
        fairness = noStarvationBeyond(5.seconds)
        onConflict { mine, theirs ->
            when {
                canMerge(mine, theirs) -> merge(mine, theirs)
                mine.urgency > theirs.urgency -> mine
                else -> ask("Conflicting changes: ${diff(mine, theirs)}")
            }
        }
    }
}
```

Negotiation is managed by the runtime's Negotiation Protocol, which ensures:
- No deadlocks (deadlock detection + automatic resolution)
- No starvation (fairness guarantees)
- Conflict resolution (merge, priority, or human escalation)
