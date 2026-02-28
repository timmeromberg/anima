; Anima Syntax Highlighting Queries
; =================================

; ======================== Keywords ========================

[
  "fun"
  "val"
  "var"
  "if"
  "else"
  "when"
  "for"
  "while"
  "return"
  "in"
  "is"
  "as"
  "as?"
  "import"
  "from"
  "module"
  "data"
  "sealed"
  "class"
  "interface"
  "type"
  "object"
] @keyword

; Anima-specific keywords
[
  "intent"
  "ensure"
  "prefer"
  "avoid"
  "assume"
  "hint"
  "cost"
  "fallback"
  "adapt"
  "evolving"
  "evolve"
  "strategy"
  "fuzzy"
  "agent"
  "entity"
  "invariant"
  "context"
  "recall"
  "ask"
  "diagnose"
  "emit"
  "delegate"
  "parallel"
  "spawn"
  "feature"
  "spec"
  "given"
  "whenever"
  "then"
  "shared"
  "resource"
  "protocol"
  "message"
  "factors"
  "metric"
  "weight"
  "fitness"
  "allow"
  "forbid"
  "triggerWhen"
  "rollbackWhen"
  "review"
  "autoApproveIf"
  "humanApproveIf"
  "autoLearn"
  "rule"
  "store"
  "decay"
  "needs"
  "reads"
  "can"
  "cannot"
  "requiresApproval"
  "tools"
  "boundaries"
  "team"
  "on"
  "deployment"
  "accessPolicy"
  "onConflict"
] @keyword

; Modifiers
(modifier) @keyword.modifier

; ======================== Types ========================

(primitive_type) @type.builtin

(type_identifier
  (identifier) @type)

(type_identifier
  (qualified_identifier) @type)

(nl_type "NL" @type.builtin)

(generic_type
  ["Fuzzy" "Intent" "Stream" "List" "MutableList" "Set" "Map" "MutableMap"] @type.builtin)

"Confidence" @type.builtin
"Boolean" @type.builtin

(type_parameter
  name: (identifier) @type)

; ======================== Functions ========================

(function_declaration
  name: (identifier) @function)

(intent_declaration
  name: (identifier) @function)

(evolving_declaration
  name: (identifier) @function)

(fuzzy_declaration
  name: (identifier) @function)

(tool_declaration
  name: (identifier) @function)

(function_signature
  name: (identifier) @function)

(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (member_expression
    member: (identifier) @function.call))

; ======================== Variables ========================

(parameter
  name: (identifier) @variable.parameter)

(val_declaration
  pattern: (identifier) @variable)

(var_declaration
  name: (identifier) @variable)

(field_parameter
  name: (identifier) @variable.field)

(field_declaration
  name: (identifier) @variable.field)

(abstract_field
  name: (identifier) @variable.field)

; ======================== Entities & Agents ========================

(entity_declaration
  name: (identifier) @type.definition)

(sealed_declaration
  name: (identifier) @type.definition)

(sealed_data_class
  name: (identifier) @type.definition)

(sealed_object
  name: (identifier) @type.definition)

(interface_declaration
  name: (identifier) @type.definition)

(type_alias
  name: (identifier) @type.definition)

(agent_declaration
  name: (identifier) @type.definition)

(protocol_declaration
  name: (identifier) @type.definition)

(message_declaration
  name: (identifier) @type)

(context_declaration
  name: (identifier) @type.definition)

(resource_declaration
  name: (identifier) @type.definition)

(feature_declaration
  name: (string_literal) @string.special)

(spec_declaration
  name: (string_literal) @string.special)

; ======================== Literals ========================

(int_literal) @number
(float_literal) @number.float
(bool_literal) @boolean
(null_literal) @constant.builtin

(string_literal) @string
(string_template) @string
(string_content) @string
(escape_sequence) @string.escape
(template_substitution) @punctuation.special
(simple_substitution) @variable

; ======================== Operators ========================

[
  "+"
  "-"
  "*"
  "/"
  "%"
  "=="
  "!="
  "<"
  ">"
  "<="
  ">="
  "&&"
  "||"
  "!"
  "="
  ".."
] @operator

; Anima-specific operators
[
  "@"
  "~="
  "~>"
  "<~"
  "?:"
  "?."
  "!!"
] @operator

"->" @punctuation.special

; ======================== Punctuation ========================

["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," "." ":"] @punctuation.delimiter

; ======================== Comments ========================

(line_comment) @comment
(block_comment) @comment

; ======================== Special Expressions ========================

(this_expression) @variable.builtin
(self_expression) @variable.builtin

(confidence_expression_val
  "@" @operator)

(confidence_type
  "@" @operator)

; ======================== Evolution & Intent ========================

(ensure_clause "ensure" @keyword.control)
(prefer_clause "prefer" @keyword.control)
(avoid_clause "avoid" @keyword.control)
(assume_clause "assume" @keyword.control)
(hint_clause "hint" @keyword.control)
(fallback_clause "fallback" @keyword.control)
(adapt_clause "adapt" @keyword.control)
(cost_clause "cost" @keyword.control)

(fitness_metric
  name: (identifier) @variable
  value: (float_literal) @number.float)

(factor
  value: (float_literal) @number.float)

(context_tier
  tier: _ @keyword)

; ======================== Module ========================

(module_declaration
  name: (qualified_identifier) @module)

(import_declaration
  alias: (identifier) @module)
