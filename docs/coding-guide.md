# Anima Coding Guide

> For AI coding agents. Covers all Anima syntax. File extension: `.anima`
> Syntax based on **Kotlin + TypeScript**. Semicolons optional.

```anima
module HelloWorld
import { println } from "anima/io"
fun main() { println("Hello, Anima!") }
fun greet(name: String): String = "Hello, $name!"
```

## Basics

### Module & Imports
```anima
module MyApp
import { HttpServer, Router } from "anima/http"
import { Database } from "anima/db" as db
```

### Variables
```anima
val name: String = "Alice"     // immutable (type can be inferred)
var count = 0                  // mutable
val (x, y) = pair.decompose()  // destructuring
```

### Functions
`fun` with block body or `= expr`. Supports extension functions, generics, `suspend`.
```anima
fun add(a: Int, b: Int): Int = a + b
fun process(items: List<Item>, tax: Float = 0.08): Float {
    return items.sumOf { it.price } * (1 + tax)
}
fun String.shout(): String = this.uppercase() + "!"
fun <T : Rankable> topK(items: List<T>, k: Int): List<T> =
    items.sortedByDescending { it.score }.take(k)
suspend fun fetchUser(id: ID): User { return api.fetch("/users/$id") }
```
Modifiers: `public`, `private`, `internal`, `protected`, `suspend`, `inline`, `override`.

### Types
**Primitives:** `Int` `Float` `String` `Bool` `Boolean` `Byte` `Unit` `Any` `Nothing` `ID` `DateTime`
**Collections:** `List<T>` `MutableList<T>` `Set<T>` `Map<K,V>` `MutableMap<K,V>`
**Special:** `NL` (natural language) `NL<Topic>` `Fuzzy<T>` `Intent<T>` `Stream<T>` `Result<T>`
**Combinators:** `T?` (nullable), `A | B` (union), `A & B` (intersection), `T @ 0.9` (confidence), `[A, B]` (tuple), `(A) -> B` (function type)
```anima
type UserId = ID
type Score = Float @ Confidence
type Handler = (Request) -> Response
```

### String Templates
```anima
"Hello, $name!"
"Score: ${user.score * 100}%"
```

### Control Flow
```anima
val label = if (age < 13) "child" else "adult"   // if is an expression
when (status) {                                   // pattern matching
    is Active -> "running"
    is Paused -> "paused"
    else -> "unknown"
}
when {                                            // when without subject
    score > 90 -> "A"
    else -> "C"
}
for (item in items) { process(item) }
while (isRunning) { tick() }
```

### Operators
| Op | Purpose | Op | Purpose |
|----|---------|-----|---------|
| `?.` | Safe call | `!!` | Non-null assert |
| `?:` | Elvis (null fallback) | `..` | Range |
| `is` / `as` / `as?` | Type check / cast | `in` | Containment |
| `to` | Pair (`"k" to "v"`) | `per` | Rate (`0.01 per hour`) |
| `@` | Confidence annotation | `matches` | Pattern match |
| `~=` | Semantic equality | `~>` / `<~` | Semantic implies / contains |

### Lambdas
```anima
items.filter { it.price > 10.0 }
items.map { item -> item.name }
items.fold(0) { acc, item -> acc + item.count }
```

## Data

### Data Entities
Like Kotlin data classes with invariants. Fields require `val`/`var`.
```anima
data entity Payment(
    val id: ID,
    val amount: Float,
    val currency: String,
    val createdAt: DateTime = now()
) {
    invariant { amount > 0.0 }
    invariant { currency.length == 3 }
}
```

### Sealed Classes
```anima
sealed class PaymentResult {
    data class Success(val txId: ID, val receipt: NL) : PaymentResult()
    data class Declined(val reason: NL) : PaymentResult()
    object Pending : PaymentResult()
}
```

### Interfaces
```anima
interface Treatable {
    val symptoms: List<Symptom>
    fun riskScore(): Float @ Confidence
}
interface ClinicalCase : Diagnosable, Treatable { val patientId: ID }
```

## AI-First Constructs

### Intent Functions
Declare *what* the function should achieve. The compiler resolves constraints into an implementation.
```anima
intent fun moderate(post: Post): ModerationDecision {
    ensure { result is ModerationDecision }
    ensure { result.hasReason() }
    prefer { result.isConsistentWith(history) } weight 0.8
    avoid  { censoringLegitimateDiscourse(post) }
    hint("check factuality before deciding")
    cost { maxTokens = 10000; maxLatency = 5.seconds }
    fallback { ModerationDecision.Flag(post.id, "needs review") }
    adapt<AmbiguousContent> { ask("Acceptable? ${post.body.summarize()}") }
}
```

**Clause reference:**

| Clause | Syntax | Notes |
|--------|--------|-------|
| `ensure` | `ensure { condition }` | Hard constraint. **Must use `{ }`**. |
| `prefer` | `prefer { cond } weight 0.8` | Soft positive. Weight optional (0.0-1.0). |
| `avoid` | `avoid { cond } weight 0.5` | Soft negative. Weight optional. |
| `assume` | `assume { precondition }` | Precondition. |
| `hint` | `hint("NL guidance")` | Takes **`( )`** with string, not a block. |
| `cost` | `cost { field = val }` | Resource limits. |
| `fallback` | `fallback { expr }` | Last-resort implementation. |
| `adapt` | `adapt<ErrorType> { recovery }` | Error-specific handler. |
| `given` | `given { val x = compute() }` | Context setup. |

Intent bodies can mix clauses with imperative statements freely.

### Confidence Types
```anima
val label: String @ 0.92 = classify(image)     // literal confidence
val pred: Label @ Confidence = model.predict()  // runtime confidence
fun critical(data: Data @ (>0.99)) { ... }      // threshold constraint
```
Branch on confidence:
```anima
when (result) {
    is Label @ (>0.95) -> autoProcess(result)
    is Label @ (>0.70) -> requestReview(result)
    is Label @ _       -> escalate(result)       // _ = any confidence
}
if (forecast @ (>0.8)) { hint("forecast reliable") }
```
Confidence forms: `0.9` (literal), `Confidence` (runtime), `_` (wildcard), `(>0.9)` (at least), `(<0.5)` (at most), `(0.3..0.8)` (range).

### NL Type & Semantic Operators
```anima
val summary: NL = summarize(document)
if (response ~= "greeting") { ... }       // semantically equal
if (claim ~> "fraud risk") { ... }         // semantically implies
if (text <~ "financial advice") { ... }    // semantically contained in
```

### Fuzzy Predicates
Weighted boolean factors. Weights should sum to 1.0.
```anima
fuzzy fun Post.isClickbait(): Boolean {
    factors {
        title.hasExcessivePunctuation()    weight 0.3
        title.hasAllCaps()                 weight 0.2
        title.semanticGap(body) > 0.5      weight 0.3
        historicalClickRatio > 5.0         weight 0.2
    }
}
```

## Agents

### Agent Declaration
Autonomous entities with context, tools, boundaries, optional team.
```anima
agent PaymentProcessor(private val gatewayId: ID) {
    context {
        var processed: Int = 0
        val errors: MutableList<Error> = mutableListOf()
    }
    tools {
        fun chargeCard(gw: ID, p: Payment): PaymentResult
        fun checkFraud(p: Payment): Float @ Confidence
    }
    boundaries {
        maxCost = 0.05.dollars per transaction
        maxTime = 30.seconds
        can { chargeCards; checkFraud }
        cannot { issueRefunds; accessRawCardNumbers }
        requiresApproval { chargeCards where { payment.amount > 10000.0 } }
    }
    intent fun process(payment: Payment): PaymentResult { ... }
    on<Dispute> { event -> context.errors.add(event.error) }
}
```
Agents can implement protocols: `agent Gatherer : ResearchProtocol { ... }`

### Delegation, Parallel, Spawn
```anima
val result = delegate(team.moderator) { moderate(post) }
val combined = parallel {
    val a = delegate(team.g1) { gather(topic) }
    val b = delegate(team.g2) { gather(topic) }
    a + b
}
agent Director {
    team {
        val writer = spawn<ContentWriter>(style = "technical")
        val checker = spawn<FactChecker>()
    }
}
```

### Event Handlers & Protocols
```anima
on<SaleCompleted> { event -> context.totalSales++ }

protocol ResearchProtocol {
    message AssignTask(val taskId: ID, val description: NL)
    message SubmitFinding(val taskId: ID, val finding: Finding)
}
```

## Memory

### Context Declarations
Three tiers: `persistent` (survives restarts), `session` (current session), `ephemeral` (short-lived).
```anima
context StudentMemory {
    persistent {
        val learningStyle: NL by stored()
        var mastery: Float by stored()
    }
    session {
        var mood: NL by inferred()
        val mistakes: MutableList<NL> = mutableListOf()
    }
    ephemeral {
        var responseTime: Float by measured()
        var streak: Int = 0
    }
    autoLearn {
        rule("detect pattern") {
            whenever { mistakes.size >= 10 }
            store { PatternUpdate(style, confidence) }
        }
    }
    decay {
        rate = 0.02 per week
        floor = 0.1
        refreshOn = Access
    }
}
```
Delegates: `by stored()`, `by inferred()`, `by measured()`, `by assigned()`, `by tracked()`.

### Memory Operations
```anima
val style = recall("learning style for ${student.name}")   // semantic retrieval
val answer = ask("Is this acceptable?")                    // human escalation
emit(SessionTimeout(studentId = id))                       // emit event
```

## Evolution

### Evolving Intent Functions
Functions that the runtime can rewrite to improve fitness metrics.
```anima
evolving intent fun recommend(user: User, n: Int = 10): List<Post> {
    ensure { output.size <= n }
    prefer { engagement.isMaximized() }
    avoid  { output.hasFilterBubble(user) }

    strategy {
        // Initial implementation (starting point for evolution)
        fetchCandidates(100).sortedByDescending { it.score }.take(n)
    }
    evolve {
        fitness {
            readCompletionRate  weight 0.4
            shareRate           weight 0.3
            returnRate24h       weight 0.3
        }
        allow { modifyRankingLogic(); addSignals(from = listOf(user.history)) }
        forbid { reduceDiversityBelow(3); useDarkPatterns() }
        triggerWhen { fitness.score < 0.4 lasting 7.days }
        rollbackWhen { fitness.score < previousVersion.score * 0.9 }
        review {
            autoApproveIf { changeScope == ChangeScope.MINOR }
            humanApproveIf { changeScope == ChangeScope.MAJOR }
        }
    }
}
```
Note: `evolving` goes before `intent fun`. `strategy` = initial impl. `evolve` = governance.

## Error Handling

### try/catch
```anima
val result = try {
    chargeCard(gateway, payment)
} catch (e: GatewayTimeout) {
    chargeCard(fallbackGateway, payment)
} catch (e: FraudSuspicion) {
    PaymentResult.PendingReview(generateId(), e.message)
}
```

### Diagnosable Classes
Self-diagnosing errors with `diagnose`, `suggest`, and `autoFix` blocks.
```anima
diagnosable class SensorFailure(
    val sensorId: ID, val lastReading: DateTime
) : DeviceError() {
    diagnose {
        check { batteryLevel(sensorId) } yields "Battery: ${level}%"
        check { connectionStatus(sensorId) } yields "Conn: ${status}"
    }
    suggest { "Replace battery if below 10%"; "Recalibrate sensor" }
    autoFix(requiresApproval = false) {
        attempt { reconnect(sensorId) }
        attempt { recalibrate(sensorId) }
        verify  { sensorResponds(sensorId) }
    }
}
// Usage: val diag = e.diagnose(); diag.autoFix()
```

### adapt & fallback (in intent functions)
```anima
intent fun processOrder(order: Order): Receipt {
    ensure { result.isValid() }
    // main logic...
    adapt<InventoryShortage> { suggestAlternatives(order.items) }
    fallback { Receipt.pending("Queued for retry") }
}
```

## Shared Resources
```anima
shared resource ContentDB(val capacity: Int = 100) {
    accessPolicy {
        priority = byUrgencyScore()
        fairness = noStarvationBeyond(5.seconds)
        onConflict { mine, theirs -> merge(mine, theirs) }
    }
}
```

## Feature Specs
Behavioral specs with `given`/`whenever`/`then`.
```anima
feature("Payments") {
    spec("valid payments succeed") {
        given { val p = Payment(id = testId(), amount = 50.0, currency = "USD") }
        whenever { val r = processor.process(p) }
        then { r shouldBe PaymentResult.Success }
    }
    deployment { target = Kubernetes; replicas = autoScale(min = 2, max = 10) }
}
```

## Common Patterns

**Agent + team delegation:**
```anima
agent Orchestrator {
    team { val worker = spawn<Worker>() }
    intent fun handle(req: Request): Response {
        return delegate(team.worker) { process(req) }
    }
}
```
**Confidence-gated branching:**
```anima
when (pred) {
    is Label @ (>0.9) -> autoApprove(pred)
    is Label @ (>0.6) -> review(pred)
    is Label @ _      -> reject(pred)
}
```
**Context needs + recall:**
```anima
intent fun plan(): LessonPlan needs StudentMemory {
    val style = recall("learning style")
    ensure { output.matchesStyle(style) }
}
```
**Error recovery with diagnosable:**
```anima
try { readSensor(id) }
catch (e: SensorFailure) { e.diagnose().autoFix() }
```
**Evolving with governance:**
```anima
evolving intent fun rank(items: List<Item>): List<Item> {
    ensure { output.isPermutationOf(items) }
    strategy { items.sortedByDescending { it.score } }
    evolve {
        fitness { clickRate weight 0.5; satisfaction weight 0.5 }
        forbid { reduceDiversityBelow(3) }
        rollbackWhen { fitness.score < previousVersion.score * 0.9 }
    }
}
```

## Comments
```anima
// Line comment
/* Block comment */
```
