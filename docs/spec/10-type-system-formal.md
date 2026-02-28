# 10 — Type System: Formal Semantics

> Anima Language Specification v0.1.0

This document provides a formal treatment of Anima's type system. It complements [03 — Type System](03-type-system.md) with precise definitions, subtyping rules, and algebraic properties. Where [03](03-type-system.md) is tutorial, this document is normative.

---

## 10.1 Type Universe

The Anima type universe **T** is the set of all well-formed types. Every value in an Anima program inhabits exactly one ground type, though it may be a member of many supertypes via the subtyping relation.

### 10.1.1 Primitive Types

The primitive types are atomic — they have no internal type structure.

| Type | Description | Default Value |
|------|-------------|---------------|
| `Int` | 64-bit signed integer | `0` |
| `Float` | 64-bit IEEE 754 floating point | `0.0` |
| `String` | UTF-8 encoded string | `""` |
| `Bool` | Boolean (`true` or `false`) | `false` |
| `Byte` | 8-bit unsigned integer | `0` |
| `Unit` | The unit type (single value) | `Unit` |
| `ID` | Universally unique identifier | (no default) |
| `DateTime` | Timestamp with timezone | (no default) |

The keyword `Boolean` is a synonym for `Bool`.

### 10.1.2 Top and Bottom Types

| Type | Role | Properties |
|------|------|------------|
| `Any` | Top type | Every type is a subtype of `Any`. |
| `Nothing` | Bottom type | `Nothing` is a subtype of every type. `Nothing` is uninhabited — no value has type `Nothing`. |

Formally:

```
∀ T ∈ T : Nothing <: T <: Any
```

### 10.1.3 Collection Types

Collection types are generic (parameterized) types:

| Type | Variance | Description |
|------|----------|-------------|
| `List<T>` | Covariant (`out T`) | Immutable ordered collection |
| `MutableList<T>` | Invariant | Mutable ordered collection |
| `Set<T>` | Covariant (`out T`) | Immutable unordered unique collection |
| `Map<K, V>` | Covariant in `V` | Immutable key-value mapping |
| `MutableMap<K, V>` | Invariant | Mutable key-value mapping |

### 10.1.4 Special Types

These types carry novel semantics unique to Anima:

| Type | Description |
|------|-------------|
| `NL` | Natural language value with semantic operations |
| `NL<D>` | Natural language restricted to semantic domain `D` |
| `Fuzzy<T>` | Probabilistic distribution over values of type `T` |
| `Intent<T>` | An unresolved intent that, when resolved, produces `T` |
| `Stream<T>` | Asynchronous stream of values of type `T` |
| `Result<T>` | Success (`Ok<T>`) or failure (`Err`) sealed type |

### 10.1.5 Composite Type Constructors

Given types `A`, `B`, `C`, `T`, `K`, `V`:

| Constructor | Syntax | Description |
|-------------|--------|-------------|
| Nullable | `T?` | `T` or `null` |
| Confidence-annotated | `T @ c` | `T` with confidence value `c` |
| Union | `A \| B` | Either `A` or `B` |
| Intersection | `A & B` | Both `A` and `B` |
| Function | `(A, B) -> C` | Function from `(A, B)` to `C` |
| Tuple | `[A, B, C]` | Ordered heterogeneous product |

### 10.1.6 Formal Grammar of Types

Using the notation from [02 — Grammar](02-grammar.md):

```
T ::= P                          -- primitive
    | Any | Nothing               -- top / bottom
    | T?                          -- nullable
    | T @ C                       -- confidence-annotated
    | T₁ | T₂                    -- union
    | T₁ & T₂                    -- intersection
    | (T₁, ..., Tₙ) -> T         -- function
    | [T₁, ..., Tₙ]              -- tuple
    | G<T₁, ..., Tₙ>             -- generic instantiation
    | NL | NL<D>                  -- natural language
    | Fuzzy<T>                    -- probabilistic
    | Intent<T>                   -- unresolved intent
    | Stream<T>                   -- async stream
    | Result<T>                   -- result

P ::= Int | Float | String | Bool | Boolean | Byte
    | Unit | ID | DateTime

C ::= f                          -- literal float in [0.0, 1.0]
    | Confidence                  -- runtime variable
    | _                           -- wildcard
    | (> f)                       -- lower bound
    | (< f)                       -- upper bound
    | (f₁ .. f₂)                 -- range
```

---

## 10.2 Subtyping Rules

The subtyping relation `<:` is a reflexive, transitive partial order on types. We write `A <: B` to mean "every value of type `A` can be used where a value of type `B` is expected."

### 10.2.1 Structural Rules

**Reflexivity:**
```
─────────── [S-Refl]
  T <: T
```

**Transitivity:**
```
  A <: B    B <: C
──────────────────── [S-Trans]
      A <: C
```

### 10.2.2 Top and Bottom

```
─────────────── [S-Top]
  T <: Any

─────────────── [S-Bot]
  Nothing <: T
```

These hold for all types `T` in the universe.

```anima
// Any value can be assigned to Any
val x: Any = 42
val y: Any = "hello"
val z: Any = listOf(1, 2, 3)

// Nothing is the return type of functions that never return
fun fail(msg: String): Nothing {
    throw RuntimeException(msg)
}
```

### 10.2.3 Nullable Types

```
─────────────── [S-NullIntro]
  T <: T?
```

A non-nullable type is a subtype of its nullable variant. The converse does not hold: `T? </: T`.

```anima
val name: String = "Alice"
val maybeName: String? = name    // OK: String <: String?
// val forced: String = maybeName  // ERROR: String? </: String
```

**Null is a subtype of all nullable types:**
```
────────────────── [S-Null]
  Nothing? <: T?
```

Since `null` has type `Nothing?`, it is assignable to any nullable type.

### 10.2.4 Confidence-Annotated Types

```
──────────────── [S-ConfIntro]
  T @ c <: T
```

A confidence-annotated value can be used where an unannotated value is expected, losing confidence information. The converse does not hold: `T </: T @ c` (you cannot fabricate confidence).

**Confidence narrowing:**
```
  c₁ ∈ range(c₂)
───────────────────── [S-ConfNarrow]
  T @ c₁ <: T @ c₂
```

Where `range(c)` is defined as:
- `range(f)` = `{f}` (exact match)
- `range(Confidence)` = `[0.0, 1.0]` (any confidence)
- `range(_)` = `[0.0, 1.0]` (wildcard)
- `range((> f))` = `(f, 1.0]`
- `range((< f))` = `[0.0, f)`
- `range((f₁ .. f₂))` = `[f₁, f₂]`

```anima
val precise: String @ 0.95 = "hello" @ 0.95
val confident: String @ (>0.9) = precise       // OK: 0.95 ∈ (0.9, 1.0]
val any: String @ _ = precise                   // OK: 0.95 ∈ [0.0, 1.0]
val plain: String = precise                     // OK: T @ c <: T
// val exact: String @ 0.99 = precise           // ERROR: 0.95 ∉ {0.99}
```

### 10.2.5 Union Types

```
─────────────── [S-UnionLeft]
  A <: A | B

─────────────── [S-UnionRight]
  B <: A | B
```

**Union elimination (narrowing):**
```
  A <: C    B <: C
──────────────────── [S-UnionElim]
    A | B <: C
```

A union type is a subtype of `C` if both branches are subtypes of `C`.

```anima
type StringOrInt = String | Int

val x: StringOrInt = "hello"   // OK: String <: String | Int
val y: StringOrInt = 42        // OK: Int <: String | Int

// Union is a subtype of Any because both String <: Any and Int <: Any
val z: Any = x                 // OK
```

**Union commutativity and associativity:**
```
A | B  ≡  B | A                        -- commutativity
(A | B) | C  ≡  A | (B | C)            -- associativity
A | A  ≡  A                            -- idempotence
A | Nothing  ≡  A                      -- identity
A | Any  ≡  Any                        -- annihilation
```

### 10.2.6 Intersection Types

```
────────────────── [S-InterLeft]
  A & B <: A

────────────────── [S-InterRight]
  A & B <: B
```

**Intersection introduction:**
```
  C <: A    C <: B
──────────────────── [S-InterIntro]
    C <: A & B
```

A type is a subtype of `A & B` only if it is a subtype of both `A` and `B`.

```anima
interface Rankable {
    val score: Float @ Confidence
}

interface Identifiable {
    val id: ID
}

// A type that implements both interfaces satisfies A & B
data entity Post(
    val id: ID,
    val score: Float @ Confidence
) : Rankable, Identifiable

// Post <: Rankable & Identifiable
fun process(item: Rankable & Identifiable) { ... }
process(Post(generateId(), 0.9 @ 0.95))  // OK
```

**Intersection commutativity and associativity:**
```
A & B  ≡  B & A                        -- commutativity
(A & B) & C  ≡  A & (B & C)            -- associativity
A & A  ≡  A                            -- idempotence
A & Any  ≡  A                          -- identity
A & Nothing  ≡  Nothing                -- annihilation
```

### 10.2.7 Distributive Laws

Union and intersection distribute over each other:

```
A & (B | C)  ≡  (A & B) | (A & C)      -- intersection distributes over union
A | (B & C)  ≡  (A | B) & (A | C)      -- union distributes over intersection
```

### 10.2.8 Function Types

Functions are **contravariant** in parameter types and **covariant** in return types:

```
  B₁ <: A₁    ...    Bₙ <: Aₙ    R_A <: R_B
──────────────────────────────────────────────── [S-Fun]
  (A₁, ..., Aₙ) -> R_A  <:  (B₁, ..., Bₙ) -> R_B
```

Note the reversal for parameters: the subtype function accepts a *broader* input.

```anima
// Any -> String  <:  String -> Any
// because String <: Any (param contravariance) and String <: Any (return covariance)

val f: (Any) -> String = { x -> x.toString() }
val g: (String) -> Any = f   // OK by [S-Fun]
```

### 10.2.9 Tuple Types

Tuples are covariant in each component:

```
  A₁ <: B₁    ...    Aₙ <: Bₙ
──────────────────────────────── [S-Tuple]
  [A₁, ..., Aₙ] <: [B₁, ..., Bₙ]
```

Tuples of different lengths are unrelated.

```anima
val pair: [String, Int] = ["hello", 42]
val wider: [Any, Any] = pair             // OK: String <: Any, Int <: Any
// val shorter: [String] = pair           // ERROR: different arity
```

### 10.2.10 Generic Type Subtyping

For a generic type `G<T>`:

**Covariant (`out T`):**
```
     A <: B
──────────────── [S-CovGen]
  G<A> <: G<B>
```

**Contravariant (`in T`):**
```
     B <: A
──────────────── [S-ContraGen]
  G<A> <: G<B>
```

**Invariant (default):**
```
     A ≡ B
──────────────── [S-InvGen]
  G<A> <: G<B>
```

```anima
// List is covariant: List<String> <: List<Any>
val strings: List<String> = listOf("a", "b")
val anys: List<Any> = strings                    // OK

// MutableList is invariant: MutableList<String> </: MutableList<Any>
val mStrings: MutableList<String> = mutableListOf("a")
// val mAnys: MutableList<Any> = mStrings        // ERROR: invariant
```

### 10.2.11 Special Type Subtyping

**NL types:**
```
──────────────── [S-NLDomain]
  NL<D> <: NL
```

A domain-constrained NL is a subtype of the unconstrained NL.

**Result types:**
```
     A <: B
──────────────────── [S-Result]
  Result<A> <: Result<B>
```

Result is covariant: `Result<String> <: Result<Any>`.

**Stream types:**
```
     A <: B
──────────────────── [S-Stream]
  Stream<A> <: Stream<B>
```

Stream is covariant.

**Fuzzy types:**
```
     A <: B
──────────────────── [S-Fuzzy]
  Fuzzy<A> <: Fuzzy<B>
```

Fuzzy is covariant.

**Nullable interaction with confidence:**
```
────────────────────── [S-NullConf]
  T @ c <: (T @ c)?
```

Confidence-annotated values are subtypes of their nullable confidence-annotated variants.

---

## 10.3 Confidence Type Algebra

Confidence types are Anima's most distinctive feature. This section defines how confidence values compose through operations.

### 10.3.1 Confidence Domain

A confidence value `c` is a real number in the closed interval `[0.0, 1.0]`:

```
c ∈ C = { x ∈ R | 0.0 ≤ x ≤ 1.0 }
```

Special values:
- `1.0` — absolute certainty (values without `@` annotation carry implicit `@ 1.0`)
- `0.0` — impossibility / no confidence
- `Confidence` — a runtime-determined value (statically treated as `@ _`)
- `_` — wildcard, matches any confidence

### 10.3.2 Arithmetic Operations

When two confidence-annotated values are combined via arithmetic:

```
(a : T @ c₁) op (b : U @ c₂)  :  R @ (c₁ × c₂)
```

where `op ∈ {+, -, *, /, %}` and `R` is the result type of the operation.

The product rule reflects that combining two uncertain values produces a result whose confidence is bounded by the product of the input confidences.

```anima
val x: Float @ 0.9 = sensor1.read()
val y: Float @ 0.8 = sensor2.read()
val sum = x + y                // Float @ 0.72  (0.9 * 0.8)
val product = x * y            // Float @ 0.72  (0.9 * 0.8)
```

### 10.3.3 Chained Operations (Pipeline Rule)

When a value flows through a sequence of transformations:

```
f : A -> B @ c_f
x : A @ c_x
───────────────────────
f(x) : B @ (c_f × c_x)
```

Confidence degrades through pipelines:

```anima
val raw: String @ 0.8 = ocr.read(image)
// parseInt has implicit confidence 0.95
val parsed: Int @ 0.95 = parseInt(raw)
// Result: Int @ 0.76  (0.8 * 0.95)
```

### 10.3.4 Conjunction (Logical AND)

When two confidence-bearing conditions are combined with `&&`:

```
(a : Bool @ c₁) && (b : Bool @ c₂)  :  Bool @ min(c₁, c₂)
```

The minimum rule: the conjunction is only as confident as the least confident operand.

```anima
val isAdult: Bool @ 0.95 = age >= 18
val isVerified: Bool @ 0.80 = checkId(user)
val canEnter = isAdult && isVerified   // Bool @ 0.80
```

### 10.3.5 Disjunction (Logical OR)

```
(a : Bool @ c₁) || (b : Bool @ c₂)  :  Bool @ max(c₁, c₂)
```

The maximum rule: a disjunction is at least as confident as the most confident operand.

```anima
val hasTicket: Bool @ 0.70 = checkTicket(user)
val isVIP: Bool @ 0.95 = checkVIPStatus(user)
val canEnter = hasTicket || isVIP      // Bool @ 0.95
```

### 10.3.6 Negation

```
!(a : Bool @ c)  :  Bool @ c
```

Negation preserves confidence. Being confident that something is true is equivalent to being confident that its negation is false.

### 10.3.7 Conditional Branching

When branching on a confident condition:

```
if (cond : Bool @ c_cond) {
    e₁ : T @ c₁
} else {
    e₂ : T @ c₂
}
: T @ (c_cond × max(c₁, c₂))
```

The branch result carries the condition's confidence because the wrong branch might have been taken.

For weighted branching (when branch probability is known):

```
if (cond /* true with probability p */) {
    e₁ : T @ c₁
} else {
    e₂ : T @ c₂
}
: T @ (p × c₁ + (1 - p) × c₂)
```

```anima
val prediction: String @ 0.9 = classify(image)
val result = if (prediction == "cat") {
    "found a cat" @ 0.95
} else {
    "not a cat" @ 0.85
}
// result : String @ 0.81  (0.9 * max(0.95, 0.85))
```

### 10.3.8 Collection Confidence

The confidence of a collection is the minimum of its element confidences:

```
confidence(List<T @ c₁, T @ c₂, ..., T @ cₙ>) = min(c₁, c₂, ..., cₙ)
```

**Mapping** preserves confidence: if `f : T -> U` has confidence `c_f`:
```
list.map(f) : List<U> @ min(confidence(list), c_f)
```

**Filtering** preserves confidence of surviving elements:
```
list.filter(p) : List<T> @ min(confidence(list), confidence(p))
```

```anima
val predictions: List<Label @ Confidence> = images.map { classify(it) }
// predictions[0] = "cat" @ 0.92
// predictions[1] = "dog" @ 0.88
// predictions[2] = "bird" @ 0.71
// Collection confidence = 0.71  (minimum element)
```

### 10.3.9 Confidence Verification (Boosting)

Verification can increase confidence when an independent check confirms a value:

```
verify(x : T @ c₁, check : T -> Bool @ c₂) : T @ min(c₁ + c₂ × (1 - c₁), 1.0)
```

This Bayesian-inspired update formula reflects that an independent confirmation narrows uncertainty. The confidence cannot exceed 1.0.

```anima
val prediction: String @ 0.80 = classify(image)
val verified: String @ 0.95 = verify(prediction)
// Boosted from 0.80 because an independent check confirmed it
```

### 10.3.10 Member Access

When accessing a member of a confidence-annotated value:

```
(x : T @ c).field : FieldType @ c
```

Confidence propagates through member access. The field is no more confident than the object it belongs to.

```anima
val user: User @ 0.85 = lookupUser(id)
val name = user.name       // String @ 0.85
val email = user.email     // String @ 0.85
```

### 10.3.11 Safe Call Operator

```
(x : T? @ c)?.field : FieldType? @ c
```

The safe call operator preserves confidence and propagates nullability.

---

## 10.4 Type Inference

Anima uses local type inference with bidirectional propagation. The inference algorithm proceeds in two directions: **synthesis** (bottom-up, inferring types from expressions) and **checking** (top-down, propagating expected types into expressions).

### 10.4.1 Variable Declaration Inference

When a `val` or `var` declaration omits the type annotation, the type is synthesized from the initializer:

```
Γ ⊢ e ⇒ T
───────────────────── [Infer-Val]
Γ ⊢ val x = e  ⟹  x : T
```

```anima
val name = "Alice"             // inferred: String
val count = 42                 // inferred: Int
val score = 0.95               // inferred: Float
val items = listOf(1, 2, 3)   // inferred: List<Int>
val pair = "x" to 5           // inferred: [String, Int]
```

**Confidence inference from initializer:**
```anima
val x = sensor.read()          // inferred: Float @ Confidence
val y = "hello" @ 0.9         // inferred: String @ 0.9
val z = 42                     // inferred: Int  (implicit @ 1.0)
```

### 10.4.2 Lambda Parameter Inference

Lambda parameter types are inferred from the expected type context:

```
Γ ⊢ expected : (A₁, ..., Aₙ) -> R
─────────────────────────────────────────── [Infer-Lambda]
Γ ⊢ { x₁, ..., xₙ -> body }  ⟹  xᵢ : Aᵢ
```

```anima
val numbers: List<Int> = listOf(1, 2, 3)

// Lambda parameter `it` inferred as Int from List<Int>.filter signature
val evens = numbers.filter { it % 2 == 0 }

// Explicit parameters inferred from map : (Int) -> R
val doubled = numbers.map { x -> x * 2 }
```

### 10.4.3 Generic Type Argument Inference

Generic type arguments are inferred from argument types at call sites:

```
f : <T> (T, T) -> List<T>
Γ ⊢ a : A    Γ ⊢ b : B    A ≡ B
──────────────────────────────────── [Infer-GenArg]
Γ ⊢ f(a, b)  ⟹  f<A>(a, b) : List<A>
```

When arguments have different types, the least upper bound (LUB) is computed:

```
f : <T> (T, T) -> List<T>
Γ ⊢ a : A    Γ ⊢ b : B    LUB(A, B) = C
──────────────────────────────────────────── [Infer-GenLUB]
Γ ⊢ f(a, b)  ⟹  f<C>(a, b) : List<C>
```

```anima
fun <T> listOf(vararg items: T): List<T>

val ints = listOf(1, 2, 3)         // inferred: List<Int>
val mixed = listOf(1, "two", 3.0)  // inferred: List<Any>
```

### 10.4.4 Confidence Propagation Inference

The compiler automatically infers confidence annotations through expressions without requiring explicit annotation at every step:

```
Γ ⊢ x : T @ c₁    Γ ⊢ y : U @ c₂    op : (T, U) -> R
───────────────────────────────────────────────────────── [Infer-Conf]
Γ ⊢ x op y  ⟹  R @ (c₁ × c₂)
```

This applies recursively, so a complex expression's confidence is computed from all contributing values.

```anima
val a: Float @ 0.9 = sensor1.read()
val b: Float @ 0.8 = sensor2.read()
val c = a + b                    // inferred: Float @ 0.72
val d = c * 2.0                  // inferred: Float @ 0.72 (2.0 has implicit @ 1.0)
val e = if (c > 10.0) a else b  // inferred: Float @ 0.72 * max(0.9, 0.8) = Float @ 0.648
```

### 10.4.5 Bidirectional Type Checking

When an expected type is provided, it guides inference into subexpressions:

```
Γ ⊢ e ⇐ T     (checking mode: verify e has type T)
Γ ⊢ e ⇒ T     (synthesis mode: infer type of e)
```

**Checking mode applies when:**
- A `val`/`var` has an explicit type annotation
- A function argument has a declared parameter type
- A return expression is checked against the function's return type

```anima
// Checking mode: lambda body checked against (Post) -> Float
val scorer: (Post) -> Float = { post -> post.qualityScore.value }

// Synthesis mode: return type inferred from body
val scorer2 = { post: Post -> post.qualityScore.value }  // inferred: (Post) -> Float
```

---

## 10.5 NL Type Semantics

The `NL` (Natural Language) type is not simply an alias for `String`. It carries semantic structure that enables meaning-aware operations.

### 10.5.1 NL Type Definition

```
NL = { v : String | v carries semantic embedding and structure }
```

Every `NL` value has:
- A textual representation (the string content)
- A semantic embedding (vector representation, computed lazily)
- An optional domain constraint

### 10.5.2 Domain-Constrained NL

`NL<D>` restricts the natural language value to a semantic domain `D`:

```
NL<D> ⊂ NL    for all domains D
```

The domain acts as a semantic type guard: values of `NL<D>` are expected to be interpretable within domain `D`.

```anima
val spec: NL<APIDesign> = "user management API with authentication"
val feedback: NL<UserFeedback> = "the search results are too slow"

// NL<APIDesign> <: NL  (domain-constrained is a subtype of unconstrained)
val text: NL = spec   // OK
```

Domains are not types in the traditional sense — they are semantic labels. The compiler (via its LLM component) validates that the content is plausible for the declared domain. A value like `"cute puppies"` assigned to `NL<APIDesign>` would produce a compile-time warning.

### 10.5.3 Semantic Operators

NL types support three semantic comparison operators. All return `Bool @ Confidence` because semantic judgments are inherently uncertain.

**Semantic equality (`~=`):**
```
(~=) : (NL, NL) -> Bool @ Confidence
```

Returns `true @ c` when two NL values have the same meaning, regardless of wording.

```anima
"user login endpoint" ~= "authentication API for users"
// true @ 0.85
```

Formally, `a ~= b` iff `embedding_similarity(a, b) ≥ threshold`, where the confidence `c` is derived from the similarity score.

**Semantic implication (`~>`):**
```
(~>) : (NL, NL) -> Bool @ Confidence
```

Returns `true @ c` when the left operand semantically implies or entails the right operand.

```anima
"REST API with auth" ~> "API"
// true @ 0.98  (a REST API with auth is certainly an API)

"login page" ~> "user management system"
// true @ 0.60  (login is part of user management, but doesn't imply all of it)
```

**Semantic containment (`<~`):**
```
(<~) : (NL, NL) -> Bool @ Confidence
```

Returns `true @ c` when the left operand is semantically contained within the right operand.

```anima
"login" <~ "user management system"
// true @ 0.80  (login is a component of user management)
```

### 10.5.4 NL Structural Decomposition

NL values support AI-powered structural decomposition. These operations always return confidence-annotated results:

```anima
val spec: NL<APIDesign> = "user management API with authentication"

spec.entities      // List<String> @ Confidence  (e.g., ["User"] @ 0.91)
spec.operations    // List<String> @ Confidence  (e.g., ["create", "read", "update", "delete"] @ 0.88)
spec.concerns      // List<String> @ Confidence  (e.g., ["authentication"] @ 0.90)
spec.ambiguities   // List<String> @ Confidence  (e.g., ["does 'manage' include delete?"] @ 0.72)
```

### 10.5.5 NL String Interpolation

When NL values are interpolated into NL templates, the result is **semantically composed**, not merely concatenated:

```anima
val base: NL = "REST API for users"
val extra: NL = "with OAuth2 authentication"
val combined: NL = "build ${base} ${extra}"
// Semantically: "build a REST API for users with OAuth2 authentication"
// The runtime merges semantic embeddings, not just strings
```

### 10.5.6 NL Refinement

NL values can be refined to reduce ambiguity:

```anima
val spec: NL = "user management API"
val refined = spec.clarify("manage includes full CRUD, auth uses JWT")

spec.ambiguities         // ["does 'manage' include delete?"] @ 0.72
refined.ambiguities      // [] @ 0.99
```

### 10.5.7 Typing Rules for Semantic Operators

The semantic operators are polymorphic over NL domain constraints, but both operands should be semantically compatible:

```
Γ ⊢ a : NL<D₁>    Γ ⊢ b : NL<D₂>    compatible(D₁, D₂)
────────────────────────────────────────────────────────── [T-SemOp]
Γ ⊢ a ~= b : Bool @ Confidence
Γ ⊢ a ~> b : Bool @ Confidence
Γ ⊢ a <~ b : Bool @ Confidence
```

Where `compatible(D₁, D₂)` is true when `D₁ = D₂`, or either is unconstrained (plain `NL`). Comparing NL values from incompatible domains produces a compiler warning.

---

## 10.6 Fuzzy Type Semantics

### 10.6.1 Fuzzy<T> Definition

`Fuzzy<T>` represents a probability distribution over values of type `T`:

```
Fuzzy<T> = { d : T -> [0.0, 1.0] | Σ d(t) = 1.0 for all t ∈ T }
```

A `Fuzzy<T>` value is not a single value with confidence — it is a full distribution. This is distinct from `T @ Confidence`, which is a single value tagged with a scalar confidence.

### 10.6.2 Fuzzy Operations

```anima
val quality: Fuzzy<Quality> = assessQuality(code)

quality.mostLikely     // Quality @ Confidence  (e.g., Quality.HIGH @ 0.6)
quality.distribution   // Map<Quality, Float>   (e.g., {HIGH: 0.6, MEDIUM: 0.3, LOW: 0.1})
quality.entropy        // Float                  (Shannon entropy of the distribution)
quality.sample()       // Quality @ Confidence  (random sample weighted by distribution)
```

### 10.6.3 Fuzzy Predicate Return Type

A `fuzzy fun` declared with return type `Boolean` actually returns `Fuzzy<Boolean>`, which in practice collapses to `Bool @ Confidence` (a weighted true/false):

```anima
fuzzy fun Post.isClickbait(): Boolean {
    factors {
        title.hasExcessivePunctuation()  weight 0.3
        title.hasAllCaps()               weight 0.2
        title.semanticGap(body) > 0.5    weight 0.3
        historicalClickToReadRatio > 5.0 weight 0.2
    }
}

// Return type is effectively Bool @ Confidence
val result = post.isClickbait()   // Bool @ 0.65 (for example)
```

The confidence of a fuzzy predicate is computed as the weighted sum of its factor satisfactions:

```
confidence(fuzzy_fun) = Σ (satisfy(factorᵢ) × weightᵢ)
```

where `satisfy(factor)` is `1.0` if the factor is true, `0.0` if false, or a value in `[0.0, 1.0]` if the factor itself is fuzzy.

---

## 10.7 Type Compatibility and Equivalence

### 10.7.1 Structural Typing

Anima uses **structural typing** for interfaces (following TypeScript). A type `T` satisfies an interface `I` if `T` has all the members declared in `I` with compatible types:

```
∀ m ∈ members(I) : ∃ m' ∈ members(T) : name(m) = name(m') ∧ type(m') <: type(m)
────────────────────────────────────────────────────────────────────────────────── [Structural]
T <: I
```

Explicit `implements` is optional but recommended for documentation.

### 10.7.2 Nominal Typing

`data entity`, `sealed class`, and `agent` declarations use **nominal typing**. Two nominal types are related only by explicit inheritance:

```anima
data entity Cat(val name: String)
data entity Dog(val name: String)

// Cat and Dog are structurally identical but nominally distinct
// Cat </: Dog and Dog </: Cat
```

### 10.7.3 Type Equivalence

Two types are equivalent (`≡`) when they are mutual subtypes:

```
A <: B    B <: A
────────────────── [Equiv]
    A ≡ B
```

Notable equivalences:
```
T | T  ≡  T
T & T  ≡  T
T | Nothing  ≡  T
T & Any  ≡  T
(T?)?  ≡  T?
T @ 1.0  ≡  T              -- implicit confidence
Boolean  ≡  Bool
```
