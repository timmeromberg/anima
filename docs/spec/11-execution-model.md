# 11 — Execution Model

> Anima Language Specification v0.1.0

This document defines how Anima programs execute. It covers evaluation order, intent resolution semantics, agent lifecycle, evolution behavior, error handling, and concurrency. It complements [04 — Intents](04-intents.md), [05 — Agents](05-agents.md), [07 — Evolution Engine](07-evolution-engine.md), and [08 — Error Model](08-error-model.md) with precise operational semantics.

---

## 11.1 Evaluation Order

### 11.1.1 Strict Evaluation

Anima uses **strict (eager) evaluation** for standard expressions. Arguments are fully evaluated before being passed to functions:

```
Γ ⊢ e₁ ⇓ v₁    Γ ⊢ e₂ ⇓ v₂    Γ ⊢ f(v₁, v₂) ⇓ v
──────────────────────────────────────────────────── [E-App]
           Γ ⊢ f(e₁, e₂) ⇓ v
```

```anima
fun add(a: Int, b: Int): Int = a + b

// Both arguments are evaluated before add() is called
val result = add(computeX(), computeY())
```

### 11.1.2 Short-Circuit Evaluation

The logical operators `&&`, `||`, and the elvis operator `?:` use short-circuit evaluation:

**Logical AND (`&&`):**
```
Γ ⊢ e₁ ⇓ false
───────────────────── [E-AndShort]
Γ ⊢ e₁ && e₂ ⇓ false

Γ ⊢ e₁ ⇓ true    Γ ⊢ e₂ ⇓ v
─────────────────────────────── [E-AndFull]
     Γ ⊢ e₁ && e₂ ⇓ v
```

**Logical OR (`||`):**
```
Γ ⊢ e₁ ⇓ true
──────────────────── [E-OrShort]
Γ ⊢ e₁ || e₂ ⇓ true

Γ ⊢ e₁ ⇓ false    Γ ⊢ e₂ ⇓ v
──────────────────────────────── [E-OrFull]
     Γ ⊢ e₁ || e₂ ⇓ v
```

**Elvis operator (`?:`):**
```
Γ ⊢ e₁ ⇓ v    v ≠ null
──────────────────────── [E-ElvisNonNull]
  Γ ⊢ e₁ ?: e₂ ⇓ v

Γ ⊢ e₁ ⇓ null    Γ ⊢ e₂ ⇓ v
───────────────────────────── [E-ElvisNull]
    Γ ⊢ e₁ ?: e₂ ⇓ v
```

```anima
// e₂ is not evaluated if e₁ is false
val safe = isValid(x) && process(x)

// e₂ is not evaluated if e₁ is non-null
val name = user?.name ?: "anonymous"
```

When short-circuit operators involve confidence-annotated operands, confidence propagation still applies to the evaluated operands (see [10 — Type System: Formal Semantics](10-type-system-formal.md), Section 10.3).

### 11.1.3 Lazy Evaluation of Constraint Clauses

Constraint clauses in `intent fun` declarations (`ensure`, `prefer`, `avoid`) are **not eagerly evaluated** as standard expressions. They are collected as a constraint set and evaluated during intent resolution:

```
Γ ⊢ intent fun f(...) { clause₁; ...; clauseₙ; stmts }
─────────────────────────────────────────────────────────
constraints(f) = { clauseᵢ | clauseᵢ is ensure/prefer/avoid }
body(f) = stmts
```

Constraint clauses reference `output` (the yet-to-be-determined result), which does not exist at the time of declaration. They are evaluated lazily against candidate solutions during resolution.

```anima
intent fun sort(arr: List<Int>): List<Int> {
    // These are NOT evaluated now — they become constraints
    ensure { output.isPermutationOf(arr) }
    ensure { output.isAscending() }
    prefer { timeComplexity <= O(n * log(n)) } weight 0.8

    // This IS evaluated eagerly (imperative code)
    val filtered = arr.filter { it > 0 }
}
```

### 11.1.4 Safe Call Evaluation

The safe call operator `?.` short-circuits on `null`:

```
Γ ⊢ e ⇓ null
────────────────────── [E-SafeNull]
Γ ⊢ e?.field ⇓ null

Γ ⊢ e ⇓ v    v ≠ null    Γ ⊢ v.field ⇓ r
──────────────────────────────────────────── [E-SafeNonNull]
         Γ ⊢ e?.field ⇓ r
```

### 11.1.5 Non-Null Assertion

```
Γ ⊢ e ⇓ v    v ≠ null
──────────────────────── [E-AssertNonNull]
    Γ ⊢ e!! ⇓ v

Γ ⊢ e ⇓ null
───────────────────────────────────── [E-AssertNullFail]
Γ ⊢ e!! ⇓ throw NullPointerException
```

---

## 11.2 Intent Resolution

Intent resolution is the process by which an `intent fun` declaration is transformed into a concrete implementation. This section defines the formal resolution algorithm.

### 11.2.1 Constraint Classification

Given an intent function with constraint set `CS`, constraints are partitioned:

```
CS = H ∪ S⁺ ∪ S⁻ ∪ P ∪ A
```

where:
- `H` = hard constraints (from `ensure` clauses)
- `S⁺` = positive soft constraints (from `prefer` clauses, with weights)
- `S⁻` = negative soft constraints (from `avoid` clauses, with weights)
- `P` = preconditions (from `assume` clauses)
- `A` = adaptation handlers (from `adapt` clauses)

Each soft constraint carries a weight `w ∈ (0.0, 1.0]`, defaulting to `1.0`.

### 11.2.2 Resolution Algorithm

```
resolve(intent, args, context) -> Result<T> @ Confidence

Input:
  intent  : the intent function declaration
  args    : actual arguments
  context : agent context and memory

Algorithm:
  1. PRECONDITION CHECK
     ∀ p ∈ intent.assume : verify(p, args)
     If any precondition fails: raise PreconditionViolation

  2. IMPERATIVE EXECUTION
     Execute imperative statements in intent body
     Collect computed intermediate values

  3. CANDIDATE GENERATION
     candidates = generate(intent, args, context)
     The generation strategy is implementation-defined:
       - LLM-based code synthesis
       - Template library lookup
       - Constraint solver (Z3/SMT for formal constraints)
       - Hybrid: LLM proposes, solver verifies

  4. HARD CONSTRAINT FILTERING
     valid = { c ∈ candidates | ∀ h ∈ intent.ensure : h(c) = true }
     If valid = ∅ and intent.fallback exists: return fallback(args)
     If valid = ∅ and no fallback: raise IntentResolutionFailure

  5. SOFT CONSTRAINT SCORING
     For each c ∈ valid:
       score(c) = Σ_{s ∈ S⁺} (wₛ × satisfy(s, c))
                - Σ_{s ∈ S⁻} (wₛ × satisfy(s, c))

     where satisfy(s, c) ∈ [0.0, 1.0]:
       - 1.0 if constraint is fully satisfied
       - 0.0 if constraint is fully violated
       - intermediate values for partial satisfaction

  6. HINT APPLICATION
     For each hint h ∈ intent.hints:
       Adjust candidate ranking based on h (implementation-defined)
       Hints are natural language guidance to the LLM resolver

  7. COST FILTERING
     If intent.cost is defined:
       valid = { c ∈ valid | cost(c) ≤ intent.cost.bounds }

  8. SELECTION
     result = argmax_{c ∈ valid} score(c)
     confidence = normalize(score(result))

  9. RETURN
     return Ok(result) @ confidence
```

### 11.2.3 Formal Model

The resolution can be stated as a constrained optimization:

```
resolve(intent, args) = argmax_{c ∈ C} S(c)

subject to:
  ∀ h ∈ H : h(c) = true                    -- hard constraints
  ∀ p ∈ P : p(args) = true                  -- preconditions
  cost(c) ≤ budget                           -- cost bounds

where:
  C = generate(intent.strategy, args)        -- candidate set
  S(c) = Σᵢ (wᵢ⁺ × satisfyᵢ⁺(c))          -- prefer score
       - Σⱼ (wⱼ⁻ × satisfyⱼ⁻(c))          -- avoid penalty
```

The result carries a confidence annotation:

```
confidence(result) = f(score(result), |valid|, constraint_satisfaction)
```

where `f` is an implementation-defined normalization function that considers the winning score relative to the maximum possible score, the number of valid candidates, and the degree of constraint satisfaction.

### 11.2.4 Resolution Caching

Resolved intents are cached in `anima.lock` for reproducibility:

```toml
[resolutions.sort]
strategy = "timsort"
resolved_at = "2026-02-28T14:30:00Z"
confidence = 0.95
compiler_version = "0.1.0"
llm_model = "claude-opus-4-6"
checksum = "a3f8b2c1"
```

On subsequent compilations:
1. If `anima.lock` contains a resolution for the intent: use the cached resolution
2. If the intent's constraints have changed (detected by checksum): re-resolve
3. If `--fresh` flag is passed: re-resolve unconditionally

### 11.2.5 Fallback Semantics

When resolution fails (no candidates satisfy all hard constraints):

```
resolve(intent, args) = ⊥

If intent.fallback is defined:
  return intent.fallback(args) @ confidence_fallback

If intent.fallback is not defined:
  raise IntentResolutionFailure(intent, constraints_violated)
```

The fallback is a deterministic, developer-written implementation that provides a guaranteed baseline. Fallback results may carry lower confidence than resolved results.

```anima
intent fun translate(text: NL, to: Language): NL {
    ensure { output.language == to }
    prefer { output.isNatural() }

    fallback {
        // Deterministic fallback — always works but may be lower quality
        translationApi.translate(text.toString(), to.code)
    }
}
```

### 11.2.6 Adaptation Semantics

When resolution succeeds but execution encounters an error:

```
execute(resolved_intent, args) throws E

If ∃ adapt<T> ∈ intent.adapt : E <: T:
  Execute the most specific matching adapt block
  The adapt block may:
    - retry()       -- re-execute the resolved intent
    - use(value)    -- substitute a value
    - skip(element) -- skip a failing element in a collection
    - escalate(msg) -- escalate to a human or supervisor
    - raise(E')     -- re-raise a different error
```

Adapt blocks are matched by type specificity — the most specific matching handler is chosen:

```anima
intent fun fetchData(source: DataSource): Dataset {
    adapt<ConnectionTimeout> { retry(maxAttempts = 3) }  // most specific
    adapt<NetworkError> { escalate("network issue") }     // less specific
    adapt<AppError> { diagnosis.autoFix(); retry() }      // least specific (catch-all)
}

// If ConnectionTimeout is thrown: first handler matches
// If DnsFailure (a NetworkError) is thrown: second handler matches
// If SchemaViolation (an AppError) is thrown: third handler matches
```

---

## 11.3 Agent Lifecycle

Agents are autonomous computational entities with a well-defined lifecycle. This section formalizes the state machine governing agent execution.

### 11.3.1 Agent States

An agent instance exists in one of the following states:

```
States = { Created, Initialized, Running, Suspended, AwaitingApproval, Adapting, Terminated }
```

**State definitions:**

| State | Description |
|-------|-------------|
| `Created` | Agent has been instantiated via `spawn<T>()`. Memory is allocated but context is not initialized. |
| `Initialized` | Context fields are populated (default values, persistent memory loaded, constructor args bound). |
| `Running` | The agent is actively executing an intent or function. |
| `Suspended` | The agent has delegated work and is waiting for the delegatee to return. |
| `AwaitingApproval` | A gated action requires human or supervisor approval. |
| `Adapting` | An error occurred and an `adapt` block is executing. |
| `Terminated` | The agent has completed or been killed. Resources are released. |

### 11.3.2 State Transitions

```
Created ──[init_context]──> Initialized
Initialized ──[receive_task]──> Running
Running ──[delegate]──> Suspended
Running ──[gated_action]──> AwaitingApproval
Running ──[error]──> Adapting
Running ──[complete]──> Initialized          (ready for next task)
Running ──[boundary_violation]──> Terminated (circuit broken)
Suspended ──[delegatee_returns]──> Running
AwaitingApproval ──[approved]──> Running
AwaitingApproval ──[denied]──> Adapting
AwaitingApproval ──[timeout]──> Adapting
Adapting ──[adapted]──> Running              (retry or substitute)
Adapting ──[unrecoverable]──> Terminated
Initialized ──[shutdown]──> Terminated
```

Visual representation:

```
                    ┌─────────┐
         ┌────────>│ Created  │
         │         └────┬─────┘
         │              │ init_context
         │         ┌────▼──────────┐
         │    ┌───>│ Initialized   │<──────────────────┐
         │    │    └────┬──────────┘                    │
         │    │         │ receive_task                  │ complete
         │    │    ┌────▼──────────┐                    │
         │    │    │   Running     │────────────────────┘
         │    │    └─┬──┬──┬──────┘
         │    │      │  │  │
         │    │      │  │  └──────[error]──────┐
         │    │      │  │                      │
         │    │      │  └──[gated_action]──┐   │
         │    │      │                     │   │
         │    │      │ delegate        ┌───▼───▼──────────┐
         │    │ ┌────▼──────────┐      │                  │
         │    │ │  Suspended    │      │  AwaitingApproval│
         │    │ └────┬──────────┘      │  / Adapting      │
         │    │      │ returns         └───┬──────────────┘
         │    │      └─────────────────────┘
         │    │                        │ unrecoverable / circuit_break
         │    │                   ┌────▼──────────┐
         │    └───────────────────│  Terminated   │
         │                        └───────────────┘
         └── (spawn new instance)
```

### 11.3.3 Context Initialization

When an agent transitions from `Created` to `Initialized`:

```
init_context(agent):
  1. Load persistent memory (from vector DB / knowledge graph)
  2. Initialize session memory (empty or from checkpoint)
  3. Allocate ephemeral memory
  4. Evaluate constructor parameters
  5. Evaluate context field initializers
  6. Verify all `needs` dependencies are available
```

```anima
agent Moderator(
    private val guidelines: NL = recall("content guidelines")   // step 4: evaluated
) {
    context {
        val history: MutableList<ModerationDecision> = mutableListOf()  // step 5
        var accuracy: Float = 0.0                                        // step 5
    }
    // ...
}
```

### 11.3.4 Message Handling

Agents respond to typed messages via `on` handlers. When a message arrives:

```
dispatch(agent, message : M):
  1. Find handler: h = agent.handlers.find { M <: h.type }
  2. If no handler found: raise UnhandledMessage(M)
  3. Transition agent to Running
  4. Execute handler body with message bound to parameter
  5. Transition agent to Initialized (ready for next message)
```

```anima
on<FeedbackReceived> { event ->
    // `event` is bound to the received FeedbackReceived message
    context.history.find { it.postId == event.postId }?.let {
        it.wasCorrect = event.userAgreed
    }
}
```

### 11.3.5 Tool Invocation

When an agent calls a tool:

```
invoke_tool(agent, tool, args):
  1. Check agent.boundaries.can(tool)
     If denied: raise BoundaryViolation(tool)
  2. Check agent.boundaries.requiresApproval(tool, args)
     If gated: transition to AwaitingApproval, pause
  3. Check resource budget: cost(tool) ≤ remaining_budget
     If exceeded: raise BudgetExceeded
  4. Execute tool (runtime provides implementation)
  5. Record in audit log: (agent.id, tool, args, result, cost, timestamp)
  6. Deduct cost from agent budget
  7. Return result
```

### 11.3.6 Delegation Semantics

When an agent delegates work:

```
delegate(delegator, delegatee, task):
  1. Compute sub-budget:
     delegatee.budget = min(delegation.budget, delegator.remaining_budget)
  2. Transition delegator to Suspended
  3. Dispatch task to delegatee
  4. Wait for delegatee to complete
  5. Deduct actual cost from delegator's budget
  6. Transition delegator to Running
  7. Return delegatee's result
```

Delegation is **scoped**: the delegatee cannot exceed the delegator's remaining budget. Delegation is **typed**: the return type of the delegation block is statically checked.

```anima
// Budget: parent has $1.00 remaining
val result = delegate(team.researcher) {
    maxCost = 0.50.dollars     // sub-budget: $0.50
    maxTime = 15.seconds
    analyze(spec)              // researcher runs within these bounds
}
// Parent now has $1.00 - actual_cost remaining
```

### 11.3.7 Team Coordination

When a parent agent spawns a team:

```
spawn_team(parent):
  ∀ member ∈ parent.team:
    instance = create_agent(member.type, member.args)
    init_context(instance)
    instance.budget ⊆ parent.budget    -- team shares parent budget
```

Team invariants:
- `Σ cost(member) ≤ parent.maxCost` — total team cost is bounded by parent
- Team members are terminated when the parent terminates
- Team members cannot access each other's context directly — they communicate through delegation returns and events

---

## 11.4 Evolution Semantics

Evolving intent functions can be rewritten at runtime. This section formalizes the evolution process. See [07 — Evolution Engine](07-evolution-engine.md) for the narrative specification.

### 11.4.1 Strategy Versioning

An evolving function maintains a version history:

```
versions(f) = [v₁, v₂, ..., vₙ]

where each vᵢ = {
  strategy  : implementation code
  fitness   : Float (composite fitness score)
  author    : Developer | EvolutionEngine
  timestamp : DateTime
  metadata  : { change_scope, approval, diff, ... }
}
```

The active version is `vₙ` (the latest). Previous versions are archived for rollback.

### 11.4.2 Fitness Evaluation

The fitness function is a weighted sum of named metrics:

```
fitness(f, data) = Σᵢ (wᵢ × metricᵢ(f, data))

subject to: Σᵢ wᵢ = 1.0
```

Each metric is measured from production data over a time window:

```anima
evolve {
    fitness {
        readCompletionRate  weight 0.4   // metric₁ with w₁ = 0.4
        shareRate           weight 0.3   // metric₂ with w₂ = 0.3
        returnRate24h       weight 0.3   // metric₃ with w₃ = 0.3
    }
}
```

### 11.4.3 Evolution Trigger

Evolution is triggered when:

```
trigger(f) ⟺ triggerCondition(f) holds for duration d

Example:
  triggerWhen { fitness.score < 0.4 lasting 7.days }

  Formally:
    ∀ t ∈ [now - 7.days, now] : fitness(f, data_at(t)) < 0.4
```

### 11.4.4 Evolution Algorithm

```
evolve(f : EvolvingIntent):
  1. ANALYSIS
     Analyze current strategy vₙ
     Identify weaknesses from fitness data
     weakness = analyze(vₙ.strategy, fitness_data)

  2. CANDIDATE GENERATION
     candidates = { }
     Repeat N times (implementation-defined):
       mutation = generate_mutation(vₙ.strategy, weakness, f.allow)
       candidates = candidates ∪ { mutation }

  3. GOVERNANCE VERIFICATION
     verified = { }
     ∀ c ∈ candidates:
       // Verify hard constraints still hold
       ∀ h ∈ f.ensure:
         if ¬ verify(h, c): reject(c, "ensure violation"); continue
       // Verify forbid constraints
       ∀ b ∈ f.forbid:
         if violates(b, c): reject(c, "forbid violation"); continue
       // Verify allow constraints
       if ¬ within_scope(c.changes, f.allow): reject(c, "out of scope"); continue
       verified = verified ∪ { c }

  4. SCORING
     ∀ c ∈ verified:
       c.predicted_fitness = predict_fitness(c, fitness_data)

  5. SELECTION
     best = argmax_{c ∈ verified} c.predicted_fitness

  6. APPROVAL
     scope = classify_change_scope(best.diff)
     If scope matches f.review.autoApproveIf: proceed
     If scope matches f.review.humanApproveIf: await_human_approval()
     If scope = BREAKING: reject (ensure clauses are immutable)

  7. TESTING
     Deploy best to shadow traffic (A/B test)
     measure actual_fitness over test_period
     If actual_fitness < vₙ.fitness × rollback_threshold:
       reject(best, "fitness regression in testing")

  8. ROLLOUT
     Gradual rollout: 1% -> 5% -> 25% -> 100%
     At each step:
       If rollbackCondition holds: rollback to vₙ
     If all steps pass:
       vₙ₊₁ = best
       versions(f) = versions(f) ++ [vₙ₊₁]
       Archive vₙ for rollback
```

### 11.4.5 Rollback

Rollback is triggered automatically when:

```
rollback(f) ⟺ rollbackCondition(f) holds

Example:
  rollbackWhen { fitness.score < previousVersion.score * 0.9 }

  Formally:
    fitness(vₙ₊₁) < fitness(vₙ) × 0.9
```

Rollback restores the previous version atomically:

```
rollback(f):
  active_version(f) = vₙ  (previous version)
  log(RollbackEvent(from = vₙ₊₁, to = vₙ, reason))
```

### 11.4.6 Evolution Invariants

The evolution engine guarantees these invariants at all times:

1. **Ensure immutability**: `∀ h ∈ f.ensure : h holds in every version`
2. **Forbid enforcement**: `∀ b ∈ f.forbid : ¬violates(b, active_version)`
3. **Rollback availability**: `∀ f : |versions(f)| ≥ 1` (at least the original strategy is always available)
4. **Audit completeness**: every evolution step is logged with full provenance
5. **Budget compliance**: evolution cycles count against the agent's cost budget

---

## 11.5 Error Handling

Anima provides four error handling mechanisms, listed from most to least traditional.

### 11.5.1 try/catch

Standard structured exception handling, as in Kotlin:

```
Γ ⊢ try { body } catch (e : E) { handler }

Evaluation:
  1. Execute body
  2. If body completes normally: result = body_result
  3. If body throws exception ex:
     Find first catch clause where typeof(ex) <: E
     If found: execute handler with e = ex
     If not found: propagate ex to caller
```

```anima
try {
    val user = database.findUser(id)
    process(user)
} catch (e: NotFound) {
    log("User not found: ${e.id}")
    return defaultUser()
} catch (e: DatabaseError) {
    log("Database error: ${e.message}")
    escalate(e)
}
```

### 11.5.2 adapt Clause (Intent Error Adaptation)

Within `intent fun` declarations, `adapt` blocks handle errors with recovery semantics:

```
adapt<E> { handler }

The handler has access to:
  - The caught error (typed as E)
  - retry()       : re-execute the intent resolution
  - use(value)    : substitute a value for the failed computation
  - skip(element) : skip the failing element (in collection contexts)
  - escalate(msg) : escalate to human or supervisor
```

Adapt blocks are ordered by type specificity. The most specific matching block executes:

```
dispatch_adapt(error, adapt_blocks):
  candidates = { a ∈ adapt_blocks | typeof(error) <: a.type }
  handler = most_specific(candidates)      -- deepest in the type hierarchy
  execute(handler, error)
```

### 11.5.3 fallback Clause

The fallback is a last-resort deterministic implementation:

```
Evaluation order:
  1. Attempt intent resolution
  2. If resolution succeeds: return resolved result
  3. If resolution fails AND adapt blocks cannot recover:
     Execute fallback block
     Return fallback result
  4. If no fallback exists: raise IntentResolutionFailure
```

```anima
intent fun summarize(doc: NL): NL {
    ensure { output.length < doc.length * 0.2 }
    prefer { output.isReadable() }

    adapt<LLMTimeout> { retry(maxAttempts = 2) }

    fallback {
        // Always works — just take the first paragraph
        doc.firstParagraph()
    }
}
```

### 11.5.4 diagnosable Classes

Self-diagnosing errors with structured analysis. Evaluation of a diagnosable error:

```
diagnose(error : Diagnosable):
  findings = []
  ∀ check ∈ error.diagnose_block:
    result = evaluate(check.predicate)
    findings += Finding(
      check = check.description,
      result = check.yields_template(result),
      relevant = result.indicates_root_cause
    )

  root_cause = analyze(findings)         -- AI-powered root cause analysis
  suggestions = error.suggest_block      -- static suggestions

  return Diagnosis(
    error = error,
    findings = findings,
    rootCause = root_cause @ confidence,
    suggestions = suggestions,
    canAutoFix = error.autoFix_block != null,
    autoFixRequiresApproval = error.autoFix_block?.requiresApproval
  )
```

Auto-fix execution:

```
autoFix(diagnosis):
  If diagnosis.autoFixRequiresApproval:
    await_approval("Auto-fix for: ${diagnosis.summary}")

  ∀ attempt ∈ error.autoFix_block.attempts:
    try:
      execute(attempt)
      ∀ verify ∈ error.autoFix_block.verifications:
        if ¬ verify(): continue to next attempt
      return FixResult.Success
    catch: continue to next attempt

  return FixResult.AllAttemptsFailed
```

```anima
diagnosable class SensorFailure(
    val sensorId: ID,
    val lastReading: DateTime
) : DeviceError() {

    diagnose {
        check { sensorBatteryLevel(sensorId) }
            yields "Battery: ${batteryLevel(sensorId)}%"
        check { sensorConnectionStatus(sensorId) }
            yields "Connection: ${connectionStatus(sensorId)}"
    }

    autoFix(requiresApproval = false) {
        attempt { reconnectSensor(sensorId) }
        attempt { recalibrate(sensorId) }
        verify { sensorResponds(sensorId) }
    }
}

// Usage:
catch (e: SensorFailure) {
    val diagnosis = e.diagnose()
    if (diagnosis.canAutoFix) {
        diagnosis.autoFix()
    }
}
```

### 11.5.5 Error Confidence

Errors can carry confidence annotations when the error classification itself is uncertain:

```
classify_error(input) : Error @ Confidence

The confidence reflects certainty about the error type:
  - HTTP 404 → NotFound @ 0.99      (very confident)
  - HTTP 500 → ServerError @ 0.60   (could be many things)
```

When catching confidence-annotated errors, the `when` expression can branch on confidence:

```anima
val error: AppError @ Confidence = classifyError(response)

when (error) {
    is NotFound @ (>0.9) -> handle404()
    is ServerError @ (>0.8) -> handleServerError()
    is AppError @ _ -> escalate("uncertain error: ${error.confidence}")
}
```

---

## 11.6 Concurrency Model

Anima provides structured concurrency primitives for parallel execution, agent spawning, delegation, and stream processing.

### 11.6.1 Structured Concurrency: `parallel { }`

The `parallel` block provides structured concurrency similar to Kotlin's `coroutineScope`. All work launched inside the block must complete before the block returns:

```
Γ ⊢ parallel { body } ⇓ results

Semantics:
  1. Create a concurrency scope
  2. Execute body, which may launch async tasks
  3. Wait for ALL async tasks to complete
  4. If any task throws: cancel all other tasks, propagate the exception
  5. Return collected results
```

```anima
val results = parallel {
    sources.map { source ->
        async { ingest(source) }
    }
}.awaitAll()
```

**Cancellation semantics:**
- When a parallel scope is cancelled, all child tasks receive a cancellation signal
- Tasks should check for cancellation cooperatively (at suspension points)
- Cancellation is propagated to delegated agents

### 11.6.2 Agent Spawning: `spawn<T>(args)`

Agent spawning creates a new agent instance:

```
spawn<T>(args) : T

Semantics:
  1. Allocate agent instance of type T
  2. Initialize with constructor args
  3. Transition to Initialized state
  4. Register with Agent Supervisor
  5. Return reference to the new agent
```

Spawned agents run concurrently with their parent but within the parent's budget constraints.

```anima
agent Orchestrator {
    team {
        val researcher = spawn<ResearchAgent>()
        val coder = spawn<CodingAgent>()
    }
}
```

### 11.6.3 Delegation: `delegate(target) { }`

Delegation sends work to another agent and waits for the result:

```
delegate(target, block) : T

Semantics:
  1. Serialize the task (block) for the target agent
  2. Send task to target's input queue
  3. Suspend the calling agent
  4. Target agent processes the task
  5. Target agent returns result
  6. Resume the calling agent with the result
```

See Section 11.3.6 for detailed delegation semantics including budget scoping.

### 11.6.4 Stream Processing: `Stream<T>`

Streams represent asynchronous sequences of values:

```
Stream<T> supports:
  - collect { item -> ... }     -- consume each item
  - map { item -> transform }   -- transform stream
  - filter { item -> bool }     -- filter stream
  - take(n)                     -- take first n items
  - merge(other)                -- merge two streams
  - buffer(size)                -- buffer items
```

Stream operations are lazy — they compose a pipeline that executes when the stream is collected.

```anima
val events: Stream<Event> = eventSource.stream()

events
    .filter { it.type == EventType.USER_ACTION }
    .map { it.toMetric() }
    .buffer(100)
    .collect { batch ->
        analytics.record(batch)
    }
```

### 11.6.5 Shared Resources and Access Policies

When multiple agents contend for a shared resource, the Negotiation Protocol manages access:

```
access(agent, resource):
  1. Check access policy: agent has permission
  2. Check fairness: agent has not been starved beyond threshold
  3. Acquire lock (or queue if contended)
  4. Execute agent's operation
  5. If conflict detected:
     Apply conflict strategy (merge / priority / escalate)
  6. Release lock
  7. Record access in audit log
```

Shared resources guarantee:
- **No deadlocks**: cycle detection in the resource dependency graph, with automatic resolution
- **No starvation**: fairness guarantees via `noStarvationBeyond(duration)`
- **Conflict resolution**: configurable strategy (semantic merge, priority-based, human escalation)

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

### 11.6.6 Execution Order Guarantees

Anima provides the following ordering guarantees:

1. **Within a single agent**: statements execute sequentially in program order
2. **Across agents**: no ordering guarantees unless established by delegation (caller waits for callee) or message passing (send happens-before receive)
3. **Within parallel blocks**: async tasks may execute in any order; results are collected in declaration order
4. **Event handlers**: processed in arrival order per agent; no ordering across agents
5. **Stream operations**: elements are processed in stream order; no cross-stream ordering
