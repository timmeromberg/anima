# 12 — Confidence Propagation

> Anima Language Specification v0.1.0

This document provides a deep formal treatment of confidence semantics — Anima's most novel type system feature. Confidence is a first-class concern: every value in an Anima program carries an implicit or explicit confidence annotation, and the compiler tracks confidence algebraically through all computations. This document complements [03 — Type System](03-type-system.md) Section "Confidence Types" and [10 — Type System: Formal Semantics](10-type-system-formal.md) Section 10.3 with exhaustive rules and examples.

---

## 12.1 Confidence Values

### 12.1.1 The Confidence Domain

A confidence value is a real number in the closed unit interval:

```
C = [0.0, 1.0] ⊂ R
```

Confidence represents the degree of certainty that a value is correct. It is not a probability in the frequentist sense, but rather a subjective measure of belief in the value's accuracy.

### 12.1.2 Special Confidence Values

| Value | Meaning | When Used |
|-------|---------|-----------|
| `1.0` | Absolute certainty | Deterministic computations, literal values, arithmetic on certain inputs |
| `0.0` | No confidence / impossibility | Should not occur in practice; indicates a completely unreliable value |
| `Confidence` | Runtime-determined | Function return types where confidence varies per call |
| `_` | Wildcard (any confidence) | Pattern matching, type constraints where confidence is unconstrained |

### 12.1.3 Implicit Confidence

Every value without an explicit `@` annotation carries implicit confidence `1.0`:

```
Γ ⊢ 42 : Int               ≡  Γ ⊢ 42 : Int @ 1.0
Γ ⊢ "hello" : String        ≡  Γ ⊢ "hello" : String @ 1.0
Γ ⊢ true : Bool             ≡  Γ ⊢ true : Bool @ 1.0
```

This means all traditional code operates at full confidence — confidence tracking is zero-cost for deterministic programs.

```anima
val x = 42                    // Int @ 1.0  (implicit)
val y = "hello"               // String @ 1.0  (implicit)
val z = x + 1                 // Int @ 1.0  (1.0 * 1.0 = 1.0)
```

### 12.1.4 Explicit Confidence Annotation

The `@` operator attaches a confidence value to any expression:

```
Γ ⊢ e : T    c ∈ C
─────────────────── [Conf-Annotate]
Γ ⊢ e @ c : T @ c
```

```anima
val prediction = "cat" @ 0.92       // String @ 0.92
val reading = 23.5 @ 0.85          // Float @ 0.85
val answer = true @ 0.70            // Bool @ 0.70
```

### 12.1.5 Confidence Decomposition

A confidence-annotated value can be decomposed into its underlying value and confidence:

```
Γ ⊢ e : T @ c
─────────────────────────── [Conf-Decompose]
Γ ⊢ e.value : T
Γ ⊢ e.confidence : Float
Γ ⊢ e.decompose() : [T, Float]
```

```anima
val prediction: String @ 0.92 = classify(image)

val label: String = prediction.value          // "cat"
val conf: Float = prediction.confidence       // 0.92
val (label2, conf2) = prediction.decompose()  // ("cat", 0.92)
```

### 12.1.6 Confidence Unwrapping

The `unwrap()` operation strips confidence from a value, asserting that the caller accepts the value regardless of confidence:

```
Γ ⊢ e : T @ c
──────────────────── [Conf-Unwrap]
Γ ⊢ e.unwrap() : T
```

This is analogous to `!!` for nullable types. It discards confidence information explicitly.

---

## 12.2 Propagation Rules

These rules define precisely how confidence flows through every kind of expression in Anima.

### 12.2.1 Rule 1: Assignment Propagation

When a confidence-annotated expression is assigned to a variable, the variable carries the same confidence:

```
Γ ⊢ e : T @ c
──────────────────────── [Prop-Assign]
Γ ⊢ val x = e  ⟹  x : T @ c
```

If an explicit type annotation specifies a confidence constraint, the value must satisfy it:

```
Γ ⊢ e : T @ c₁    c₁ ∈ range(c₂)
───────────────────────────────────── [Prop-AssignChecked]
Γ ⊢ val x: T @ c₂ = e  ⟹  x : T @ c₁
```

```anima
val a: Float @ Confidence = sensor.read()   // OK: any confidence
val b: Float @ (>0.9) = sensor.read()       // OK only if sensor returns > 0.9
val c: Float @ 0.95 = "data" @ 0.95        // OK: exact match
```

### 12.2.2 Rule 2: Arithmetic Operations (Product Rule)

Binary arithmetic operations on confidence-annotated values produce results whose confidence is the product of the input confidences:

```
Γ ⊢ e₁ : T₁ @ c₁    Γ ⊢ e₂ : T₂ @ c₂    op ∈ {+, -, *, /, %}
────────────────────────────────────────────────────────────────── [Prop-Arith]
Γ ⊢ e₁ op e₂ : R @ (c₁ × c₂)
```

**Rationale**: if value `a` has 90% chance of being correct and value `b` has 80% chance of being correct, then any computation depending on both is at most 72% likely to be correct (assuming independence).

```anima
val x: Float @ 0.9 = sensor1.read()
val y: Float @ 0.8 = sensor2.read()

val sum = x + y       // Float @ 0.72  (0.9 * 0.8)
val diff = x - y      // Float @ 0.72  (0.9 * 0.8)
val product = x * y   // Float @ 0.72  (0.9 * 0.8)
val ratio = x / y     // Float @ 0.72  (0.9 * 0.8)
```

**Operations with certain values**: when one operand has implicit confidence `1.0`, the result inherits the other operand's confidence:

```anima
val x: Float @ 0.9 = sensor.read()
val doubled = x * 2.0    // Float @ 0.9  (0.9 * 1.0 = 0.9)
val offset = x + 10.0    // Float @ 0.9  (0.9 * 1.0 = 0.9)
```

### 12.2.3 Rule 3: Comparison Operations

Comparisons between confidence-annotated values produce `Bool` with the product confidence:

```
Γ ⊢ e₁ : T @ c₁    Γ ⊢ e₂ : T @ c₂    op ∈ {==, !=, <, >, <=, >=}
──────────────────────────────────────────────────────────────────── [Prop-Compare]
Γ ⊢ e₁ op e₂ : Bool @ (c₁ × c₂)
```

```anima
val temp: Float @ 0.9 = sensor.read()
val threshold = 100.0                       // Float @ 1.0

val isHot = temp > threshold                // Bool @ 0.9  (0.9 * 1.0)
val isSame = temp == anotherTemp @ 0.85     // Bool @ 0.765  (0.9 * 0.85)
```

### 12.2.4 Rule 4: Logical Operations

**Conjunction (AND)** takes the minimum confidence:

```
Γ ⊢ e₁ : Bool @ c₁    Γ ⊢ e₂ : Bool @ c₂
────────────────────────────────────────── [Prop-And]
Γ ⊢ e₁ && e₂ : Bool @ min(c₁, c₂)
```

**Disjunction (OR)** takes the maximum confidence:

```
Γ ⊢ e₁ : Bool @ c₁    Γ ⊢ e₂ : Bool @ c₂
────────────────────────────────────────── [Prop-Or]
Γ ⊢ e₁ || e₂ : Bool @ max(c₁, c₂)
```

**Negation** preserves confidence:

```
Γ ⊢ e : Bool @ c
──────────────────── [Prop-Not]
Γ ⊢ !e : Bool @ c
```

**Rationale**: A conjunction fails if either operand is wrong, so the weakest link determines the confidence. A disjunction succeeds if either operand is right, so the strongest link determines the confidence.

```anima
val a: Bool @ 0.95 = isAdult(user)
val b: Bool @ 0.80 = isVerified(user)

val both = a && b       // Bool @ 0.80  (min)
val either = a || b     // Bool @ 0.95  (max)
val notA = !a           // Bool @ 0.95  (preserved)
```

### 12.2.5 Rule 5: Function Call Propagation

When calling a function with confidence-annotated arguments:

```
f : (P₁, ..., Pₙ) -> R @ c_f
Γ ⊢ aᵢ : Pᵢ @ cᵢ for i ∈ 1..n
──────────────────────────────────────────────── [Prop-Call]
Γ ⊢ f(a₁, ..., aₙ) : R @ (c_f × min(c₁, ..., cₙ))
```

The result confidence is bounded by both the function's own confidence (if annotated) and the minimum confidence of all arguments.

If the function has no confidence annotation on its return type, `c_f = 1.0` (deterministic function):

```anima
fun double(x: Int): Int = x * 2    // c_f = 1.0

val input: Int @ 0.85 = parseInput(raw)
val result = double(input)          // Int @ 0.85  (1.0 * 0.85)
```

If the function itself returns a confidence-annotated type:

```anima
fun classify(image: Image): Label @ Confidence  // c_f varies

val img: Image @ 0.90 = captureImage()
val label = classify(img)
// Label @ (c_classify * 0.90)
// If classify returns 0.92, then: Label @ (0.92 * 0.90) = Label @ 0.828
```

### 12.2.6 Rule 6: Member Access Propagation

Accessing a member of a confidence-annotated value propagates the confidence:

```
Γ ⊢ e : T @ c    field ∈ members(T)    field : F
───────────────────────────────────────────────── [Prop-Member]
Γ ⊢ e.field : F @ c
```

```anima
val user: User @ 0.85 = lookupUser(id)
val name = user.name        // String @ 0.85
val email = user.email      // String @ 0.85
val age = user.age          // Int @ 0.85
```

**Chained access** compounds:

```
Γ ⊢ a : A @ c₁    a.b : B @ c₂    a.b.c : C @ c₃
─────────────────────────────────────────────────── [Prop-Chain]
Γ ⊢ a.b.c : C @ min(c₁, c₂, c₃)
```

When the intermediate values have their own confidence, the chain takes the minimum. When the fields carry no independent confidence, the object's confidence propagates unchanged.

```anima
val data: Response @ 0.9 = fetchData(url)
val items = data.body.items      // List<Item> @ 0.9  (no independent confidence)

val report: Report @ 0.85 = generateReport(data)
val score: Float @ 0.70 = report.confidence_score
// score is Float @ min(0.85, 0.70) = Float @ 0.70
```

### 12.2.7 Rule 7: Conditional Branching

When branching on a confidence-annotated condition:

```
Γ ⊢ cond : Bool @ c_cond
Γ ⊢ e_then : T @ c_then
Γ ⊢ e_else : T @ c_else
──────────────────────────────────────────── [Prop-If]
Γ ⊢ if (cond) e_then else e_else : T @ (c_cond × max(c_then, c_else))
```

**Rationale**: the condition itself might be wrong, in which case the wrong branch was taken. The result confidence is degraded by the condition's uncertainty. The `max` of the two branches is used because at least one of them will execute, and we take the optimistic bound.

```anima
val isDay: Bool @ 0.90 = detectDaylight(sensor)

val temp = if (isDay) {
    27.0 @ 0.95     // daytime temperature reading
} else {
    18.0 @ 0.88     // nighttime temperature reading
}
// temp : Float @ (0.90 * max(0.95, 0.88)) = Float @ 0.855
```

**When expression with confidence:**

```anima
val prediction: String @ 0.85 = classify(image)

val action = when (prediction) {
    is String @ (>0.95) -> Action.AUTO_PROCESS @ 1.0
    is String @ (>0.70) -> Action.REVIEW @ 0.95
    is String @ _ -> Action.ESCALATE @ 1.0
}
// action confidence depends on which branch matches
// Since prediction is @ 0.85, the second branch matches
// action : Action @ min(0.85, 0.95) = Action @ 0.85
```

### 12.2.8 Rule 8: Collection Confidence

The aggregate confidence of a collection is the minimum of its element confidences:

```
Γ ⊢ eᵢ : T @ cᵢ for i ∈ 1..n
──────────────────────────────────────────────── [Prop-Collection]
Γ ⊢ listOf(e₁, ..., eₙ) : List<T> @ min(c₁, ..., cₙ)
```

**Rationale**: a collection is only as reliable as its least reliable element. If any element is wrong, the collection as a whole may be wrong.

```anima
val predictions = listOf(
    "cat" @ 0.92,
    "dog" @ 0.88,
    "bird" @ 0.71
)
// List<String> with aggregate confidence 0.71 (minimum)
```

**Individual element access preserves the element's confidence:**

```anima
val first = predictions[0]   // String @ 0.92  (individual element confidence)
```

### 12.2.9 Rule 9: Map/Filter/Reduce Operations

**Map** preserves confidence through the transformation:

```
Γ ⊢ list : List<A @ c_list>    Γ ⊢ f : (A) -> B @ c_f
─────────────────────────────────────────────────────── [Prop-Map]
Γ ⊢ list.map(f) : List<B @ (c_list × c_f)>
```

If `f` is a deterministic function (`c_f = 1.0`), then `map` preserves element confidences.

**Filter** preserves confidence of surviving elements, modulated by predicate confidence:

```
Γ ⊢ list : List<A @ c_list>    Γ ⊢ p : (A) -> Bool @ c_p
────────────────────────────────────────────────────────── [Prop-Filter]
Γ ⊢ list.filter(p) : List<A @ min(c_list, c_p)>
```

If the predicate has uncertainty, elements might be incorrectly included or excluded.

**Reduce/fold** compounds confidence:

```
Γ ⊢ list : List<A @ c_list>    Γ ⊢ f : (B, A) -> B @ c_f
   Γ ⊢ init : B @ c_init
──────────────────────────────────────────────────────────── [Prop-Reduce]
Γ ⊢ list.fold(init, f) : B @ (c_init × c_list × c_f)
```

```anima
val readings: List<Float @ Confidence> = sensors.map { it.read() }
// readings = [22.1 @ 0.9, 22.3 @ 0.85, 22.0 @ 0.92]

val average = readings.average()
// Float @ min(0.9, 0.85, 0.92) = Float @ 0.85

val highConf = readings.filter { it.confidence > 0.88 }
// [22.1 @ 0.9, 22.0 @ 0.92]  (filter predicate is deterministic, c_p = 1.0)
```

### 12.2.10 Rule 10: String Interpolation

String templates propagate confidence from all interpolated expressions:

```
Γ ⊢ eᵢ : Tᵢ @ cᵢ for i ∈ 1..n
──────────────────────────────────────────────── [Prop-Template]
Γ ⊢ "...${e₁}...${e₂}..." : String @ min(c₁, c₂, ..., cₙ)
```

```anima
val name: String @ 0.90 = recognizeName(audio)
val role: String @ 0.75 = classifyRole(context)
val greeting = "Hello, ${name}, your role is ${role}"
// String @ min(0.90, 0.75) = String @ 0.75
```

---

## 12.3 Confidence Narrowing

Confidence narrowing allows programs to branch on the confidence level of a value, creating type-safe paths that guarantee minimum confidence within each branch.

### 12.3.1 is-check with Confidence

The `is` operator can test both the type and confidence of a value:

```
Γ ⊢ e : T @ c    c ∈ range(threshold)
──────────────────────────────────────── [Narrow-Is]
Γ ⊢ e is T @ threshold : Bool @ 1.0
```

The check itself is deterministic (the confidence value is known exactly), so it returns `Bool @ 1.0`.

Within a true branch, the value is narrowed to the tested confidence range:

```
Γ ⊢ e : T @ c    Γ ⊢ e is T @ (>0.8) = true
──────────────────────────────────────────── [Narrow-TrueBranch]
Γ, (e is T @ (>0.8)) ⊢ e : T @ (>0.8)
```

```anima
val prediction: String @ Confidence = classify(image)

if (prediction is String @ (>0.95)) {
    // In this branch: prediction : String @ (>0.95)
    autoProcess(prediction)    // Safe: high confidence guaranteed
}
```

### 12.3.2 when Expression with Confidence Branches

The `when` expression provides exhaustive confidence narrowing:

```anima
val label: String @ Confidence = classify(photo)

when (label) {
    is String @ (>0.95) -> {
        // label : String @ (>0.95)
        use(label)
    }
    is String @ (>0.70) -> {
        // label : String @ (0.70..0.95]
        verify(label, with = humanReview)
    }
    is String @ _ -> {
        // label : String @ [0.0..0.70]
        escalate("low confidence: ${label.confidence}")
    }
}
```

**Exhaustiveness**: the compiler checks that confidence branches cover the full `[0.0, 1.0]` range. A `when` expression is exhaustive if either:
- The branches cover `[0.0, 1.0]` completely, or
- An `else` or `@ _` branch handles the remainder

### 12.3.3 Smart Cast with Confidence

After a confidence check, the variable is smart-cast within the scope where the check is known to hold:

```anima
fun processReading(reading: Float @ Confidence) {
    if (reading is Float @ (>0.9)) {
        // Smart cast: reading is now Float @ (>0.9) in this scope
        criticalOperation(reading)   // Accepts Float @ (>0.9)
    }

    // Outside the if: reading is still Float @ Confidence
}
```

### 12.3.4 Confidence Threshold Types in Function Signatures

Functions can require minimum confidence levels in their parameter types:

```anima
fun <T> requireConfident(value: T @ (>0.95)): T {
    return value.unwrap()
}

fun criticalDecision(data: SensorData @ (>0.99)): Action {
    // Can only be called with very high confidence data
    return computeAction(data.unwrap())
}
```

The compiler enforces these constraints at call sites:

```anima
val reading: Float @ 0.85 = sensor.read()
// requireConfident(reading)   // COMPILE ERROR: 0.85 </: (>0.95)

val verified: Float @ 0.97 = verify(reading)
requireConfident(verified)     // OK: 0.97 ∈ (0.95, 1.0]
```

---

## 12.4 Confidence and Intent Resolution

Confidence interacts deeply with the intent resolution system (see [11 — Execution Model](11-execution-model.md), Section 11.2).

### 12.4.1 Intent Results Always Carry Confidence

Every `intent fun` returns a confidence-annotated result:

```
resolve(intent, args) : Result<T> @ Confidence
```

The confidence reflects how well the resolution satisfies the constraints:
- `@ 1.0` — all constraints fully satisfied (unlikely in practice for non-trivial intents)
- `@ (>0.9)` — high-quality resolution
- `@ (<0.5)` — poor resolution; fallback may be preferable

```anima
intent fun sort(arr: List<Int>): List<Int> {
    ensure { output.isPermutationOf(arr) }
    ensure { output.isAscending() }
    prefer { timeComplexity <= O(n * log(n)) } weight 0.8
}

// Resolution might return: List<Int> @ 0.95
// The 0.95 reflects that all ensures passed and prefer was satisfied
```

### 12.4.2 Hard Constraints and Confidence

Hard constraints (`ensure`) interact with confidence as follows:

```
∀ h ∈ intent.ensure:
  If h is a formal predicate: h(candidate) must be true (no confidence)
  If h is a fuzzy predicate:  h(candidate) must be true @ (>threshold)
    where threshold is implementation-defined (default: 0.9)
```

When an `ensure` clause references a confidence-annotated value, the threshold semantics apply:

```anima
intent fun recommend(user: User, count: Int = 10): List<Post> {
    ensure { output.all { it.qualityScore @ (>0.6) } }
    // Every post must have quality score with confidence > 0.6
}
```

### 12.4.3 Soft Constraints and Confidence Weighting

Soft constraints (`prefer` / `avoid`) contribute to the resolution score, weighted by their satisfaction level. When the constraint itself evaluates with confidence, the confidence modulates the weight:

```
score_contribution(prefer_clause, candidate) =
  weight × satisfy(clause, candidate) × confidence(satisfy)
```

```anima
intent fun recommend(user: User): List<Post> {
    prefer { output.topicDiversity() >= 3 } weight 0.5
    // If topicDiversity() returns true @ 0.85:
    //   contribution = 0.5 * 1.0 * 0.85 = 0.425
    // If topicDiversity() returns false @ 0.90:
    //   contribution = 0.5 * 0.0 * 0.90 = 0.0
}
```

### 12.4.4 Confidence in Evolved Intent Functions

When an `evolving intent fun` produces new strategy versions, each version is tested and its confidence is measured empirically:

```
version.confidence = measured_fitness / maximum_possible_fitness
```

The confidence of an evolved version reflects how well it performs on real data, not just how well it satisfies constraints in theory.

```anima
evolving intent fun recommend(user: User): List<Post> {
    // v1 (developer): confidence 0.85  (manual estimate)
    // v2 (evolved):   confidence 0.91  (measured from A/B test)
    // v3 (evolved):   confidence 0.88  (fitness regression, but above rollback threshold)
}
```

---

## 12.5 Fuzzy Predicates and Confidence

Fuzzy predicates are the primary source of confidence-annotated boolean values. This section formalizes how `fuzzy fun` produces confidence.

### 12.5.1 Factor Evaluation

A `fuzzy fun` with `factors` block evaluates each factor and computes a weighted confidence:

```
fuzzy fun predicate(args): Boolean {
    factors {
        factor₁  weight w₁
        factor₂  weight w₂
        ...
        factorₙ  weight wₙ
    }
}

Evaluation:
  sᵢ = satisfy(factorᵢ, args)    -- each sᵢ ∈ [0.0, 1.0]
  confidence = Σᵢ (sᵢ × wᵢ)
  result = confidence ≥ 0.5       -- threshold for "true"
  return result @ confidence
```

where `Σᵢ wᵢ` should equal `1.0` (the compiler warns if weights don't sum to 1.0).

```anima
fuzzy fun Post.isClickbait(): Boolean {
    factors {
        title.hasExcessivePunctuation()           weight 0.3
        title.hasAllCaps()                         weight 0.2
        title.semanticGap(body) > 0.5              weight 0.3
        historicalClickToReadRatio(this) > 5.0     weight 0.2
    }
}

// Evaluation example:
// factor₁: true  → s₁ = 1.0, contribution = 1.0 * 0.3 = 0.3
// factor₂: false → s₂ = 0.0, contribution = 0.0 * 0.2 = 0.0
// factor₃: true  → s₃ = 1.0, contribution = 1.0 * 0.3 = 0.3
// factor₄: false → s₄ = 0.0, contribution = 0.0 * 0.2 = 0.0
// confidence = 0.3 + 0.0 + 0.3 + 0.0 = 0.6
// result = true @ 0.6
```

### 12.5.2 Nested Fuzzy Evaluation

When a factor is itself a fuzzy predicate, its satisfaction is its confidence:

```
factorᵢ is a fuzzy fun → sᵢ = confidence(factorᵢ)
```

```anima
fuzzy fun Post.isHighQuality(): Boolean {
    factors {
        body.isReadable()           weight 0.4   // fuzzy → s = e.g. 0.75
        !isClickbait()              weight 0.3   // fuzzy → s = 1.0 - 0.6 = 0.4
        author.reputation > 0.7    weight 0.3   // crisp → s = 1.0 or 0.0
    }
}

// If isReadable() returns true @ 0.75:    s₁ = 0.75
// If isClickbait() returns true @ 0.60:   s₂ = 1.0 - 0.60 = 0.40
// If author.reputation = 0.8 (> 0.7):    s₃ = 1.0
// confidence = 0.75 * 0.4 + 0.40 * 0.3 + 1.0 * 0.3 = 0.30 + 0.12 + 0.30 = 0.72
// result = true @ 0.72
```

### 12.5.3 Metric Block Evaluation

Alternatively, a `fuzzy fun` can use a `metric` block for custom confidence computation:

```anima
fuzzy fun Content.matchesGuidelines(guidelines: NL): Boolean {
    metric {
        val similarity = semanticSimilarity(this.themes, guidelines.themes)
        val compliance = checkCompliance(this, guidelines.rules)
        return (similarity * 0.6 + compliance * 0.4) @ (similarity * compliance)
    }
}
```

In a `metric` block, the developer controls the confidence computation directly.

### 12.5.4 Fuzzy<T> Distribution Type

While `fuzzy fun` returning `Boolean` produces `Bool @ Confidence`, the `Fuzzy<T>` type represents a full probability distribution:

```
Fuzzy<T> = {
  distribution : Map<T, Float>      -- ∀ v: distribution[v] ∈ [0.0, 1.0], Σ distribution[v] = 1.0
  mostLikely   : T @ Confidence     -- argmax with its probability
  entropy      : Float               -- Shannon entropy: -Σ p(x) × log₂(p(x))
}
```

```anima
val quality: Fuzzy<Quality> = assessQuality(code)

quality.distribution    // {HIGH: 0.6, MEDIUM: 0.3, LOW: 0.1}
quality.mostLikely      // Quality.HIGH @ 0.6
quality.entropy         // -0.6*log₂(0.6) - 0.3*log₂(0.3) - 0.1*log₂(0.1) ≈ 1.30

// Convert to single value by taking most likely
val grade: Quality @ Confidence = quality.mostLikely   // Quality.HIGH @ 0.6
```

---

## 12.6 Confidence Interaction with Other Type Features

### 12.6.1 Confidence and Nullable Types

Confidence and nullability are orthogonal but can interact:

```
T? @ c      -- nullable value with confidence c about its non-null status
(T @ c)?    -- possibly-null value where, if present, has confidence c
T? @ c ≡ (T @ c)?   -- equivalent: nullable with confidence
```

```anima
val result: String? @ 0.85 = findName(audio)
// Either null, or a String with 0.85 confidence

if (result != null) {
    // result : String @ 0.85  (null check does not affect confidence)
    process(result)
}
```

### 12.6.2 Confidence and Union Types

When a union type carries confidence, the confidence applies to the type discrimination:

```
(A | B) @ c -- a value that is either A or B, with confidence c about which one
```

When narrowing a union with confidence:

```anima
val result: (String | Int) @ 0.85 = parseValue(input)

when (result) {
    is String -> {
        // result : String @ 0.85
        // The 0.85 includes uncertainty about whether this IS a String
        processString(result)
    }
    is Int -> {
        // result : Int @ 0.85
        processInt(result)
    }
}
```

### 12.6.3 Confidence and Generics

Confidence annotations on generic type parameters propagate through generic operations:

```
fun <T> identity(x: T): T = x

val input: String @ 0.85 = "hello" @ 0.85
val output = identity(input)    // String @ 0.85  (T instantiated as String @ 0.85)
```

**Covariant container with confidence:**

```anima
val items: List<String @ 0.9> = listOf("a" @ 0.9, "b" @ 0.9)
val anys: List<Any> = items    // OK: String @ 0.9 <: String <: Any
// Note: confidence information is lost when widening to Any
```

### 12.6.4 Confidence and Semantic Operators

The semantic operators (`~=`, `~>`, `<~`) always return `Bool @ Confidence` because semantic judgments are inherently uncertain. When their operands also carry confidence, both sources of uncertainty compound:

```
Γ ⊢ a : NL @ c₁    Γ ⊢ b : NL @ c₂
semantic_op returns Bool @ c_sem
────────────────────────────────────────────── [Prop-Semantic]
Γ ⊢ a ~= b : Bool @ (c_sem × c₁ × c₂)
```

```anima
val query: NL @ 0.90 = transcribeAudio(recording)
val reference: NL = "user authentication API"     // NL @ 1.0

val match = query ~= reference
// If semantic similarity yields true @ 0.85:
// match : Bool @ (0.85 * 0.90 * 1.0) = Bool @ 0.765
```

---

## 12.7 Confidence Tracking Implementation

### 12.7.1 Compile-Time vs. Runtime Tracking

Confidence tracking operates in two modes:

**Compile-time (static) tracking**: when confidence values are literal constants, the compiler computes propagated confidences statically:

```anima
val x: Float @ 0.9 = ...
val y: Float @ 0.8 = ...
val z = x + y                // Compiler statically infers: Float @ 0.72
```

**Runtime tracking**: when confidence values are `Confidence` (runtime-determined), the runtime propagator tracks confidence dynamically:

```anima
val x: Float @ Confidence = sensor.read()  // c unknown until runtime
val y: Float @ Confidence = sensor.read()  // c unknown until runtime
val z = x + y                              // c computed at runtime: c_x * c_y
```

### 12.7.2 Confidence Erasure

In optimized production builds, confidence tracking can be erased for values that are never inspected:

```
If no code path reads x.confidence or branches on x's confidence:
  x : T @ c  →  x : T     (confidence elided, zero overhead)
```

This is an optimization performed by the compiler. The language semantics remain as if confidence were always tracked.

### 12.7.3 Confidence Warnings

The compiler emits warnings when:

1. **Confidence drops below a threshold** (configurable, default 0.5):
   ```
   WARNING: Expression at line 42 has confidence 0.38, below threshold 0.5
   ```

2. **Confident input is required but uncertain input is provided:**
   ```
   ERROR: Function criticalDecision requires T @ (>0.99), but got T @ 0.85
   ```

3. **Confidence is silently discarded:**
   ```
   WARNING: Confidence information lost in assignment at line 15
            (T @ 0.85 assigned to T without confidence tracking)
   ```

### 12.7.4 Confidence Debugging

The runtime provides confidence traces for debugging:

```anima
val result = complexPipeline(input)
result.confidenceTrace()
// Output:
//   input: Float @ 0.90
//   ├── normalize(input): Float @ 0.90 * 1.0 = 0.90
//   ├── classify(normalized): String @ 0.90 * 0.85 = 0.765
//   ├── if (classification == "A"): confidence(cond) = 0.765
//   │   └── processA(data): Result @ 0.765 * 0.92 = 0.704
//   └── result: Result @ 0.704
```

---

## 12.8 Summary of Propagation Rules

| Operation | Rule | Result Confidence |
|-----------|------|-------------------|
| Literal / no annotation | Identity | `1.0` |
| Explicit `@ c` | Annotation | `c` |
| `a op b` (arithmetic) | Product | `c_a * c_b` |
| `a && b` | Minimum | `min(c_a, c_b)` |
| `a \|\| b` | Maximum | `max(c_a, c_b)` |
| `!a` | Preserve | `c_a` |
| `a == b` (comparison) | Product | `c_a * c_b` |
| `f(x)` (function call) | Product | `c_f * min(c_args)` |
| `a.field` (member access) | Propagate | `c_a` |
| `a?.field` (safe call) | Propagate | `c_a` |
| `if (cond) a else b` | Branch | `c_cond * max(c_a, c_b)` |
| `listOf(a, b, c)` | Collection | `min(c_a, c_b, c_c)` |
| `list.map(f)` | Map | `c_list * c_f` |
| `list.filter(p)` | Filter | `min(c_list, c_p)` |
| `"..${a}..${b}.."` | Template | `min(c_a, c_b)` |
| `a ~= b` (semantic) | Compound | `c_sem * c_a * c_b` |
| `verify(a)` | Boost | `min(c_a + c_v * (1 - c_a), 1.0)` |
| `a.decompose()` | Extract | value: `T`, confidence: `Float` |
| `a.unwrap()` | Discard | `T` (confidence stripped) |
