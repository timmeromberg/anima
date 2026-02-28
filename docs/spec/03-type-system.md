# 03 — Type System

> Anima Language Specification v0.1.0

## Overview

Anima's type system combines familiar features from Kotlin and TypeScript with novel constructs for confidence, natural language, and fuzziness.

## Primitive Types

```anima
Int        // 64-bit signed integer
Float      // 64-bit floating point
String     // UTF-8 string
Bool       // true / false
Byte       // 8-bit unsigned
Unit       // void equivalent (Kotlin convention)
Any        // top type
Nothing    // bottom type (Kotlin convention)
```

## Composite Types

### Lists and Maps

```anima
List<Int>                 // ordered collection
MutableList<String>       // mutable variant
Set<User>                 // unique collection
Map<String, Any>          // key-value map
MutableMap<ID, User>      // mutable variant
```

### Tuples

```anima
type Scored<T> = [T, Float]
type Pair<A, B> = [A, B]

val result: [String, Int] = ["hello", 42]
val (name, count) = result  // destructuring
```

### Nullable Types

Kotlin-style null safety:

```anima
val name: String? = null
val length = name?.length ?: 0   // safe call + elvis
val forced = name!!              // assert non-null (throws)
```

## Data Entities

Anima's equivalent of Kotlin's `data class`, extended with invariants:

```anima
data entity User(
    val id: ID,
    val email: String,
    val name: String,
    val role: Role = Role.VIEWER,
    val createdAt: DateTime = now()
) {
    invariant { email matches EMAIL_REGEX }
    invariant { name.length in 1..200 }
    invariant { role in Role.values() }
}
```

Entities automatically get:
- `equals()` / `hashCode()` based on all fields
- `copy()` with named parameters
- `toString()` with field names
- Destructuring support
- Invariant checking on construction and `copy()`

## Interfaces

TypeScript-style structural typing:

```anima
interface Rankable {
    val score: Float @ Confidence
    fun compareTo(other: Rankable): Int
}

interface Identifiable {
    val id: ID
}

// Structural compatibility — no explicit `implements` needed
// (but you can be explicit if you want)
data entity Post(
    val id: ID,
    val score: Float @ Confidence
) : Rankable, Identifiable {
    override fun compareTo(other: Rankable): Int =
        this.score.compareTo(other.score)
}
```

## Union Types

TypeScript-style union types combined with Kotlin sealed classes:

```anima
// Simple union (TypeScript style)
type StringOrInt = String | Int

// Sealed hierarchy (Kotlin style) — preferred for domain modeling
sealed class Result<out T> {
    data class Ok<T>(val value: T) : Result<T>()
    data class Err(val error: AppError) : Result<Nothing>()
    object Pending : Result<Nothing>()
}

// Pattern matching on unions
when (result) {
    is Ok -> println(result.value)
    is Err -> println(result.error)
    is Pending -> println("waiting...")
}
```

## Type Aliases

```anima
type Feed = List<Post>
type UserModel = Map<String, Vector>
type Handler = suspend (Request) -> Response
type Predicate<T> = (T) -> Bool
```

## Generics

Kotlin-style generics with declaration-site variance:

```anima
// Declaration-site variance
interface Producer<out T> {      // covariant
    fun produce(): T
}

interface Consumer<in T> {       // contravariant
    fun consume(value: T)
}

// Constraints
fun <T : Rankable> topK(items: List<T>, k: Int): List<T> =
    items.sortedByDescending { it.score }.take(k)

// Multiple bounds
fun <T> process(item: T): Result<T> where T : Rankable, T : Identifiable {
    // T must satisfy both interfaces
}
```

---

## Confidence Types

The signature innovation of Anima's type system.

### Annotation Syntax

The `@` operator annotates any type with a confidence level:

```anima
val prediction: String @ 0.92 = "cat" @ 0.92
val reading: Float @ Confidence = sensor.read()   // runtime confidence
val certain: Int = 42                               // no annotation = implicit @ 1.0
```

### Confidence Expressions

```anima
T @ 0.85           // exactly 0.85
T @ Confidence      // variable (determined at runtime)
T @ (>0.95)         // "at least 0.95" — a type constraint
T @ (<0.5)          // "at most 0.5"
T @ (0.7..0.9)      // range
```

### Decomposing Confidence

```anima
val prediction: String @ 0.92 = classify(image)

// Decompose into value + confidence
val (value, confidence) = prediction.decompose()
// value: String = "cat"
// confidence: Float = 0.92

// Access confidence directly
prediction.confidence  // 0.92
prediction.value       // "cat"
```

### Confidence Propagation Rules

The compiler tracks confidence algebraically:

```anima
// Rule 1: Independent operations multiply
val a: Float @ 0.9 = sensor1.read()
val b: Float @ 0.8 = sensor2.read()
val c = a * b          // Float @ 0.72

// Rule 2: Chain of operations take minimum
val raw: String @ 0.8 = ocr.read(image)
val parsed: Int @ 0.95 = parseInt(raw)
val result = parsed    // Int @ 0.76 (0.8 * 0.95)

// Rule 3: Verification boosts confidence
val checked: String @ 0.95 = verify(prediction)  // boost from 0.92

// Rule 4: Union paths weight by probability
val result = if (condition) {
    pathA()  // String @ 0.9, chosen 60% of the time
} else {
    pathB()  // String @ 0.7, chosen 40% of the time
}
// result: String @ 0.82  (0.6 * 0.9 + 0.4 * 0.7)
```

### Confidence-Aware Branching

```anima
val label = classify(photo)

when (label) {
    is String @ (>0.95) -> use(label)                          // high confidence
    is String @ (>0.70) -> verify(label, with = humanReview)   // medium
    is String @ _ -> escalate("low confidence: ${label.confidence}")
}
```

### Confidence in Function Signatures

```anima
// Function that requires high-confidence input
fun <T> requireConfident(value: T @ (>0.95)): T = value.unwrap()

// Function that returns confidence-annotated output
fun classify(image: Image): Label @ Confidence

// Function that degrades confidence
fun translate(text: NL @ Confidence): NL @ Confidence {
    // output confidence <= input confidence * translation_quality
}
```

---

## The NL Type

`NL` (Natural Language) is a semantically-rich type — not just a string.

### Basic Usage

```anima
val spec: NL = "a REST API for managing users with CRUD operations"

// NL with domain constraint
val apiSpec: NL<APIDesign> = "user management API with authentication"
val feedback: NL<UserFeedback> = "the search results are too slow"
```

### Semantic Operations

```anima
val spec: NL<APIDesign> = "user management API with authentication"

// Structural decomposition (AI-powered)
spec.entities      // -> List<String> @ 0.91 = ["User"]
spec.operations    // -> List<String> @ 0.88 = ["create", "read", "update", "delete"]
spec.concerns      // -> List<String> @ 0.90 = ["authentication"]
spec.ambiguities   // -> List<String> @ 0.72 = ["does 'manage' include delete?"]

// Refinement
val refined = spec.clarify("manage includes full CRUD, auth uses JWT")
refined.ambiguities  // -> empty list @ 0.99

// Semantic interpolation (meaning-aware, not just concatenation)
val full: NL = "build ${spec} that also handles ${extraRequirement}"
```

### Semantic Comparison

```anima
// ~= operator: semantic equality
"user login endpoint" ~= "authentication API for users"  // true @ 0.85

// ~> operator: semantic implication
"REST API with auth" ~> "API"  // true @ 0.98

// <~ operator: semantic containment
"login" <~ "user management system"  // true @ 0.80
```

---

## Fuzzy Types

For values that exist on a spectrum rather than being discrete:

```anima
val quality: Fuzzy<Quality> = assessQuality(code)
// Not just HIGH/MEDIUM/LOW — it's a distribution

quality.mostLikely     // Quality.HIGH @ 0.6
quality.distribution   // {HIGH: 0.6, MEDIUM: 0.3, LOW: 0.1}
quality.entropy        // 0.89 (how uncertain the distribution is)
```

---

## Type Hierarchy Summary

```
Any
├── Int, Float, String, Bool, Byte      (primitives)
├── List<T>, Set<T>, Map<K,V>           (collections)
├── T?                                   (nullable)
├── T @ Confidence                       (confidence-annotated)
├── NL, NL<Domain>                       (natural language)
├── Fuzzy<T>                             (probabilistic)
├── Intent<T>                            (unresolved intent)
├── Stream<T>                            (async stream)
├── data entity                          (domain entities)
├── sealed class                         (algebraic types)
├── interface                            (structural types)
└── Nothing                              (bottom type)
```
