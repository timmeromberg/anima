# 02 — Grammar

> Anima Language Specification v0.1.0

## Syntax Philosophy

Anima's syntax is modeled after **Kotlin** and **TypeScript**:

- `fun` for functions (Kotlin)
- `val`/`var` for bindings (Kotlin)
- `when` for pattern matching (Kotlin)
- Trailing lambdas (Kotlin)
- Data classes (Kotlin `data class` → Anima `data entity`)
- Extension functions (Kotlin)
- Structural typing and union types (TypeScript)
- String templates with `${}` (Kotlin)
- `?` for nullability (both)
- Type-after-colon syntax (both)

Novel constructs (`intent fun`, `ensure`, `@ Confidence`, `agent`, `evolve`, `fuzzy fun`) are additive — they extend the syntax without replacing familiar patterns.

## Formal Grammar (EBNF)

The canonical formal grammar is in [`grammar/anima.ebnf`](../../grammar/anima.ebnf). Below is the human-readable version with explanations.

### Program Structure

```ebnf
program        ::= declaration*

declaration    ::= import_decl
                 | module_decl
                 | entity_decl
                 | interface_decl
                 | sealed_decl
                 | type_alias
                 | fun_decl
                 | intent_decl
                 | agent_decl
                 | feature_decl
                 | context_decl
                 | resource_decl
                 | protocol_decl
```

### Imports

TypeScript-style with Kotlin aliasing:

```anima
import { HttpServer, Router } from "anima/http"
import { Database } from "anima/db"
import { recommend } from "./recommendation" as rec
```

```ebnf
import_decl    ::= 'import' '{' IDENT (',' IDENT)* '}' 'from' STRING
                   ('as' IDENT)?
```

### Functions

```ebnf
fun_decl       ::= modifiers 'fun' type_params?
                   (receiver_type '.')? IDENT
                   '(' param_list ')' (':' type_expr)?
                   context_clause?
                   (block | '=' expr)

modifiers      ::= ('public' | 'private' | 'internal' | 'protected'
                   | 'suspend' | 'inline' | 'override')*

param_list     ::= (param (',' param)*)?
param          ::= IDENT ':' type_expr ('=' expr)?

context_clause ::= 'needs' context_ref (',' context_ref)*
                 | 'reads' context_ref (',' context_ref)*

receiver_type  ::= type_expr        -- for extension functions
```

#### Examples

```anima
// Standard function
fun calculateTotal(items: List<Item>, tax: Float = 0.08): Float {
    return items.sumOf { it.price } * (1 + tax)
}

// Expression body
fun double(x: Int): Int = x * 2

// Extension function
fun List<Post>.topByQuality(n: Int = 10): List<Post> =
    this.sortedByDescending { it.qualityScore }.take(n)

// Suspend function
suspend fun fetchProfile(id: ID): User {
    return api.fetch("/users/$id")
}

// Generic function with constraints
fun <T : Rankable> topK(items: List<T>, k: Int): List<T> =
    items.sortedByDescending { it.score }.take(k)
```

### Intent Functions

```ebnf
intent_decl    ::= modifiers 'intent' 'fun' type_params?
                   IDENT '(' param_list ')' ':' type_expr
                   context_clause?
                   intent_body

intent_body    ::= '{' intent_clause* '}'

intent_clause  ::= ensure_clause
                 | prefer_clause
                 | avoid_clause
                 | assume_clause
                 | hint_clause
                 | cost_clause
                 | fallback_clause
                 | adapt_clause
                 | statement            -- imperative code

ensure_clause  ::= 'ensure' block
prefer_clause  ::= 'prefer' block ('weight' FLOAT)?
avoid_clause   ::= 'avoid' block ('weight' FLOAT)?
assume_clause  ::= 'assume' block
hint_clause    ::= 'hint' '(' STRING ')'
cost_clause    ::= 'cost' '{' cost_field* '}'
fallback_clause::= 'fallback' block
adapt_clause   ::= 'adapt' '<' type_expr '>' (lambda | block)

cost_field     ::= IDENT '=' expr
```

#### Examples

```anima
intent fun sort(arr: List<Int>): List<Int> {
    ensure { output.isPermutationOf(arr) }
    ensure { output.isAscending() }
    prefer { timeComplexity <= O(n * log(n)) } weight 0.8
}

intent fun summarize(doc: NL): NL {
    ensure { output.length < doc.length * 0.2 }
    prefer { output.isReadable() }
    cost { maxTokens = 10_000; maxLatency = 5.seconds }
    fallback { doc.firstParagraph() }
}
```

### Evolving Functions

```ebnf
evolving_decl  ::= 'evolving' intent_decl_with_evolve

-- adds to intent_body:
strategy_block ::= 'strategy' block
evolve_block   ::= 'evolve' '{' evolve_clause* '}'

evolve_clause  ::= fitness_block
                 | allow_block
                 | forbid_block
                 | trigger_clause
                 | rollback_clause
                 | review_block

fitness_block  ::= 'fitness' '{' fitness_metric* '}'
fitness_metric ::= IDENT 'weight' FLOAT

allow_block    ::= 'allow' '{' allow_rule* '}'
forbid_block   ::= 'forbid' '{' forbid_rule* '}'
trigger_clause ::= 'triggerWhen' block
rollback_clause::= 'rollbackWhen' block
review_block   ::= 'review' '{' review_rule* '}'
```

### Fuzzy Predicates

```ebnf
fuzzy_decl     ::= 'fuzzy' 'fun' type_params?
                   (receiver_type '.')? IDENT
                   '(' param_list ')' ':' 'Boolean'
                   fuzzy_body

fuzzy_body     ::= '{' fuzzy_clause* '}'
fuzzy_clause   ::= factors_block | metric_block | statement

factors_block  ::= 'factors' '{' factor* '}'
factor         ::= expr 'weight' FLOAT

metric_block   ::= 'metric' block
```

#### Examples

```anima
fuzzy fun NL.isReadable(): Boolean {
    factors {
        avgSentenceLength < 25    weight 0.3
        fleschKincaidGrade < 10   weight 0.3
        hasStructure()            weight 0.2
        usesPlainLanguage()       weight 0.2
    }
}
```

### Agents

```ebnf
agent_decl     ::= 'agent' IDENT
                   ('(' param_list ')')?
                   (': ' type_expr (',' type_expr)*)?   -- implements
                   agent_body

agent_body     ::= '{' agent_section* '}'

agent_section  ::= context_section
                 | tools_section
                 | boundaries_section
                 | team_section
                 | intent_decl
                 | fun_decl
                 | on_handler

context_section    ::= 'context' '{' field_decl* '}'
tools_section      ::= 'tools' '{' tool_fun_decl* '}'
boundaries_section ::= 'boundaries' '{' boundary_rule* '}'
team_section       ::= 'team' '{' team_member* '}'
on_handler         ::= 'on' '<' type_expr '>' (lambda | block)

boundary_rule  ::= IDENT '=' expr
                 | 'can' block
                 | 'cannot' block
                 | 'requiresApproval' block

team_member    ::= 'val' IDENT '=' 'spawn' '<' type_expr '>' '(' arg_list ')'
```

### Types

```ebnf
type_expr      ::= primitive_type
                 | IDENT type_args?                      -- named type
                 | type_expr '@' confidence_expr         -- confidence
                 | type_expr '|' type_expr               -- union
                 | type_expr '&' type_expr               -- intersection
                 | type_expr '?'                         -- nullable
                 | 'NL' ('<' IDENT '>')?                 -- natural language
                 | 'Fuzzy' '<' type_expr '>'             -- fuzzy/probabilistic
                 | 'Intent' '<' type_expr '>'            -- unresolved intent
                 | 'Stream' '<' type_expr '>'            -- async stream
                 | 'List' '<' type_expr '>'              -- list
                 | 'Set' '<' type_expr '>'               -- set
                 | 'Map' '<' type_expr ',' type_expr '>' -- map
                 | '[' type_expr (',' type_expr)* ']'    -- tuple
                 | '(' param_types ')' '->' type_expr    -- function type

primitive_type ::= 'Int' | 'Float' | 'String' | 'Bool'
                 | 'Byte' | 'Unit' | 'Any' | 'Nothing'

confidence_expr::= FLOAT                    -- literal
                 | 'Confidence'              -- runtime-determined
                 | '(' '>' FLOAT ')'         -- at least
                 | '(' '<' FLOAT ')'         -- at most
                 | '(' FLOAT '..' FLOAT ')'  -- range

type_params    ::= '<' type_param (',' type_param)* '>'
type_param     ::= IDENT (':' type_expr)?
type_args      ::= '<' type_expr (',' type_expr)* '>'
```

### Data Entities

```ebnf
entity_decl    ::= 'data' 'entity' IDENT type_params?
                   '(' field_param (',' field_param)* ')'
                   (': ' type_expr (',' type_expr)*)?
                   entity_body?

field_param    ::= ('val' | 'var') IDENT ':' type_expr ('=' expr)?

entity_body    ::= '{' (invariant_clause | fun_decl)* '}'
invariant_clause ::= 'invariant' block
```

### Sealed Classes

```ebnf
sealed_decl    ::= 'sealed' 'class' IDENT type_params?
                   (': ' type_expr)?
                   '{' sealed_member* '}'

sealed_member  ::= 'data' 'class' IDENT '(' field_param* ')' ':' type_expr '()'
                 | 'object' IDENT ':' type_expr '()'
```

### Interfaces

```ebnf
interface_decl ::= 'interface' IDENT type_params?
                   (': ' type_expr (',' type_expr)*)?
                   '{' interface_member* '}'

interface_member ::= field_decl | fun_signature
```

### Type Aliases

```ebnf
type_alias     ::= 'type' IDENT type_params? '=' type_expr
```

### Expressions

```ebnf
expr           ::= literal
                 | IDENT
                 | expr '.' IDENT                    -- member access
                 | expr '?.' IDENT                   -- safe call
                 | expr '!!'                         -- non-null assert
                 | expr '(' arg_list ')'             -- function call
                 | expr type_args '(' arg_list ')'   -- generic call
                 | expr '@' confidence_expr          -- confidence annotate
                 | expr '?:' expr                    -- elvis operator
                 | 'delegate' '(' expr ')' lambda    -- agent delegation
                 | 'parallel' lambda                 -- parallel execution
                 | 'recall' '(' expr ')'             -- memory retrieval
                 | 'ask' '(' expr ')'                -- human escalation
                 | 'diagnose' '(' expr ')'           -- error diagnosis
                 | 'emit' '(' expr ')'               -- event emission
                 | expr 'is' type_expr               -- type check
                 | expr 'as' type_expr               -- type cast
                 | expr 'as?' type_expr              -- safe cast
                 | expr '~=' expr                    -- semantic equality
                 | expr '~>' expr                    -- semantic implication
                 | expr '<~' expr                    -- semantic containment
                 | expr 'in' expr                    -- containment check
                 | expr '..' expr                    -- range
                 | when_expr
                 | if_expr
                 | lambda
                 | comprehension
                 | string_template
                 | binary_expr
                 | unary_expr

when_expr      ::= 'when' ('(' expr ')')? '{' when_branch* '}'
when_branch    ::= when_condition '->' expr
                 | 'else' '->' expr
when_condition ::= 'is' type_expr
                 | 'is' type_expr '@' confidence_expr  -- confidence match
                 | expr

if_expr        ::= 'if' '(' expr ')' block ('else' (if_expr | block))?

lambda         ::= '{' (param_list '->')? statement* '}'

string_template::= '"' (TEXT | '${' expr '}' | '$' IDENT)* '"'
```

### Statements

```ebnf
statement      ::= val_decl
                 | var_decl
                 | assignment
                 | return_stmt
                 | for_stmt
                 | while_stmt
                 | expr_stmt

val_decl       ::= 'val' pattern (':' type_expr)? '=' expr
var_decl       ::= 'var' IDENT ':' type_expr ('=' expr)?
assignment     ::= expr '=' expr
return_stmt    ::= 'return' expr?
for_stmt       ::= 'for' '(' IDENT 'in' expr ')' block
while_stmt     ::= 'while' '(' expr ')' block
expr_stmt      ::= expr
```

### Features / Specs

```ebnf
feature_decl   ::= 'feature' '(' STRING ')' feature_body
feature_body   ::= '{' (spec_decl | deployment_block)* '}'

spec_decl      ::= 'spec' '(' STRING ')' spec_body
spec_body      ::= '{' given_block whenever_block then_block '}'

given_block    ::= 'given' block
whenever_block ::= 'whenever' block
then_block     ::= 'then' block

deployment_block ::= 'deployment' '{' deploy_field* '}'
```

### Context & Memory

```ebnf
context_decl   ::= 'context' IDENT '{' context_tier* auto_learn? decay_block? '}'

context_tier   ::= ('persistent' | 'session' | 'ephemeral') '{' field_decl* '}'

auto_learn     ::= 'autoLearn' '{' learn_rule* '}'
learn_rule     ::= 'rule' '(' STRING ')' '{' whenever_clause store_clause '}'

decay_block    ::= 'decay' '{' decay_field* '}'
```

### Shared Resources

```ebnf
resource_decl  ::= 'shared' 'resource' IDENT '(' param_list ')'
                   '{' access_policy '}'

access_policy  ::= 'accessPolicy' '{' policy_rule* '}'
```

### Protocols

```ebnf
protocol_decl  ::= 'protocol' IDENT '{' message_decl* '}'
message_decl   ::= 'message' IDENT '(' field_param* ')'
```

---

## Keyword Map

### From Kotlin/TypeScript

| Keyword | Origin | Purpose |
|---------|--------|---------|
| `fun` | Kotlin | Function declaration |
| `val` | Kotlin | Immutable binding |
| `var` | Kotlin | Mutable binding |
| `when` | Kotlin | Pattern matching |
| `if` / `else` | Both | Conditional |
| `for` / `while` | Both | Loops |
| `return` | Both | Return from function |
| `data` | Kotlin | Data class modifier |
| `sealed` | Kotlin | Sealed class |
| `interface` | TypeScript | Structural interface |
| `type` | TypeScript | Type alias |
| `is` / `as` | Kotlin | Type check / cast |
| `in` | Kotlin | Containment / iteration |
| `suspend` | Kotlin | Async function |
| `override` | Kotlin | Override method |
| `import` / `from` | TypeScript | Module imports |
| `object` | Kotlin | Singleton |
| `public` / `private` / `internal` | Kotlin | Visibility |

### Anima-Specific

| Keyword | Purpose |
|---------|---------|
| `intent` | Intent function modifier |
| `ensure` | Hard constraint |
| `prefer` | Soft constraint (positive) |
| `avoid` | Soft constraint (negative) |
| `assume` | Precondition |
| `hint` | NL guidance to resolver |
| `fuzzy` | Fuzzy predicate modifier |
| `agent` | Agent declaration |
| `delegate` | Agent delegation |
| `evolving` | Evolvable function modifier |
| `evolve` | Evolution rules block |
| `strategy` | Initial implementation |
| `entity` | Domain entity (like data class + invariants) |
| `invariant` | Entity invariant |
| `context` | Memory context block |
| `recall` | Semantic memory retrieval |
| `ask` | Human escalation |
| `diagnose` | Error diagnosis |
| `diagnosable` | Self-diagnosing error |
| `emit` | Event emission |
| `adapt` | Error adaptation |
| `fallback` | Fallback strategy |
| `NL` | Natural language type |
| `Fuzzy` | Probabilistic type |
| `Confidence` | Confidence type variable |
| `factors` | Fuzzy predicate factors |
| `weight` | Constraint/factor weight |
| `protocol` | Agent message protocol |
| `shared` | Shared resource modifier |
| `spawn` | Agent instantiation |
| `parallel` | Parallel execution block |
| `feature` | Feature/spec declaration |
| `spec` | Specification |

### Operators

| Operator | Purpose |
|----------|---------|
| `@` | Confidence annotation |
| `~=` | Semantic equality |
| `~>` | Semantic implication |
| `<~` | Semantic containment |
| `?.` | Safe call (null) |
| `!!` | Non-null assertion |
| `?:` | Elvis operator |
| `..` | Range |
| `->` | Lambda / when branch |
