/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Operator precedence levels (higher = tighter binding)
const PREC = {
  CONFIDENCE: 1,
  ELVIS: 2,
  OR: 3,
  AND: 4,
  SEMANTIC: 5,
  EQUALITY: 6,
  COMPARISON: 7,
  CONTAINMENT: 8,
  RANGE: 9,
  ADDITIVE: 10,
  MULTIPLICATIVE: 11,
  TYPE_OP: 12,
  UNARY: 13,
  POSTFIX: 14,
  MEMBER: 15,
  PRIMARY: 16,
};

module.exports = grammar({
  name: 'anima',

  word: $ => $.identifier,

  extras: $ => [
    /\s+/,
    $.line_comment,
    $.block_comment,
    ';',
  ],

  supertypes: $ => [
    $._declaration,
    $._expression,
    $._statement,
    $._type,
  ],

  conflicts: $ => [
    // Lambda { body } vs block { statements }
    [$.lambda_expression, $.block],
    // identifier vs qualified_identifier in expression context
    [$.qualified_identifier, $._expression],
    // (Type) -> is function_type or parenthesized_type before when arrow
    [$.function_type, $.parenthesized_type],
    // if expression with bare expressions in branches
    [$._expression, $.if_expression],
  ],

  rules: {
    // ================================================================
    // Program
    // ================================================================

    program: $ => repeat($._declaration),

    // ================================================================
    // Declarations
    // ================================================================

    _declaration: $ => choice(
      $.import_declaration,
      $.module_declaration,
      $.function_declaration,
      $.intent_declaration,
      $.evolving_declaration,
      $.fuzzy_declaration,
      $.entity_declaration,
      $.sealed_declaration,
      $.interface_declaration,
      $.type_alias,
      $.agent_declaration,
      $.feature_declaration,
      $.context_declaration,
      $.resource_declaration,
      $.protocol_declaration,
      $.diagnosable_declaration,
      $.val_declaration,
      $.var_declaration,
    ),

    // ======================== Imports & Modules =====================

    import_declaration: $ => seq(
      'import',
      '{',
      commaSep1($.identifier),
      '}',
      'from',
      $.string_literal,
      optional(seq('as', field('alias', $.identifier))),
    ),

    module_declaration: $ => seq(
      'module',
      field('name', choice($.identifier, $.qualified_identifier)),
    ),

    // ======================== Functions =============================

    function_declaration: $ => seq(
      repeat($.modifier),
      'fun',
      optional($.type_parameters),
      optional(seq(field('receiver', $._type), '.')),
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      optional(seq(':', field('return_type', $._type))),
      optional(field('context_clause', $.context_clause)),
      field('body', choice($.block, seq('=', $._expression))),
    ),

    modifier: _ => choice(
      'public', 'private', 'internal', 'protected',
      'suspend', 'inline', 'override',
    ),

    parameter_list: $ => seq(
      '(',
      optional(commaSep1($.parameter)),
      ')',
    ),

    parameter: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $._type),
      optional(seq('=', field('default', $._expression))),
    ),

    context_clause: $ => choice(
      seq('needs', commaSep1($.qualified_identifier)),
      seq('reads', commaSep1($.qualified_identifier)),
    ),

    // ======================== Intent Functions ======================

    intent_declaration: $ => seq(
      repeat($.modifier),
      'intent',
      'fun',
      optional($.type_parameters),
      optional(seq(field('receiver', $._type), '.')),
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      optional(seq(':', field('return_type', $._type))),
      optional(field('context_clause', $.context_clause)),
      field('body', $.intent_body),
    ),

    intent_body: $ => seq(
      '{',
      repeat($._intent_clause),
      '}',
    ),

    _intent_clause: $ => choice(
      $.ensure_clause,
      $.prefer_clause,
      $.avoid_clause,
      $.assume_clause,
      $.hint_clause,
      $.cost_clause,
      $.fallback_clause,
      $.adapt_clause,
      $.given_block,
      $._statement,
    ),

    ensure_clause: $ => seq('ensure', $.block),

    prefer_clause: $ => seq(
      'prefer',
      $.block,
      optional(seq('weight', $.float_literal)),
    ),

    avoid_clause: $ => seq(
      'avoid',
      $.block,
      optional(seq('weight', $.float_literal)),
    ),

    assume_clause: $ => seq('assume', $.block),

    hint_clause: $ => seq('hint', '(', $.string_template, ')'),

    cost_clause: $ => seq(
      'cost',
      '{',
      repeat($.cost_field),
      '}',
    ),

    cost_field: $ => seq(
      field('name', $.identifier),
      '=',
      field('value', $._expression),
    ),

    fallback_clause: $ => seq('fallback', $.block),

    adapt_clause: $ => seq(
      'adapt',
      '<',
      field('error_type', $._type),
      '>',
      choice($.lambda_expression, $.block),
    ),

    // ======================== Evolving Functions ====================

    evolving_declaration: $ => seq(
      'evolving',
      repeat($.modifier),
      'intent',
      'fun',
      optional($.type_parameters),
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      optional(seq(':', field('return_type', $._type))),
      optional(field('context_clause', $.context_clause)),
      '{',
      repeat($._intent_clause),
      optional($.strategy_block),
      optional($.evolve_block),
      '}',
    ),

    strategy_block: $ => seq('strategy', $.block),

    evolve_block: $ => seq(
      'evolve',
      '{',
      repeat($._evolve_clause),
      '}',
    ),

    _evolve_clause: $ => choice(
      $.fitness_block,
      $.allow_block,
      $.forbid_block,
      $.trigger_clause,
      $.rollback_clause,
      $.review_block,
    ),

    fitness_block: $ => seq(
      'fitness',
      '{',
      repeat($.fitness_metric),
      '}',
    ),

    fitness_metric: $ => seq(
      field('name', $.identifier),
      'weight',
      field('value', $.float_literal),
    ),

    allow_block: $ => seq(
      'allow',
      '{',
      repeat($.evolution_rule),
      '}',
    ),

    forbid_block: $ => seq(
      'forbid',
      '{',
      repeat($.evolution_rule),
      '}',
    ),

    evolution_rule: $ => seq(
      $.identifier,
      optional(seq('(', optional(commaSep1($._argument)), ')')),
    ),

    trigger_clause: $ => seq('triggerWhen', $.block),
    rollback_clause: $ => seq('rollbackWhen', $.block),

    review_block: $ => seq(
      'review',
      '{',
      repeat($.review_rule),
      '}',
    ),

    review_rule: $ => choice(
      seq('autoApproveIf', $.block),
      seq('humanApproveIf', $.block),
    ),

    // ======================== Fuzzy Predicates ======================

    fuzzy_declaration: $ => seq(
      'fuzzy',
      'fun',
      optional($.type_parameters),
      optional(seq(field('receiver', $._type), '.')),
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      optional(seq(':', 'Boolean')),
      field('body', $.fuzzy_body),
    ),

    fuzzy_body: $ => seq(
      '{',
      repeat($._fuzzy_clause),
      '}',
    ),

    _fuzzy_clause: $ => choice(
      $.factors_block,
      $.metric_block,
      $._statement,
    ),

    factors_block: $ => seq(
      'factors',
      '{',
      repeat($.factor),
      '}',
    ),

    factor: $ => seq(
      field('condition', $._expression),
      'weight',
      field('value', $.float_literal),
    ),

    metric_block: $ => seq('metric', $.block),

    // ======================== Agents ===============================

    agent_declaration: $ => seq(
      'agent',
      field('name', $.identifier),
      optional(seq(
        '(',
        optional(commaSep1(choice($.field_parameter, $.parameter))),
        ')',
      )),
      optional(seq(':', commaSep1($._type))),
      field('body', $.agent_body),
    ),

    agent_body: $ => seq(
      '{',
      repeat($._agent_section),
      '}',
    ),

    _agent_section: $ => choice(
      $.agent_context_section,
      $.tools_section,
      $.boundaries_section,
      $.team_section,
      $.evolving_declaration,
      $.intent_declaration,
      $.function_declaration,
      $.on_handler,
    ),

    agent_context_section: $ => seq(
      'context',
      '{',
      repeat($.field_declaration),
      '}',
    ),

    tools_section: $ => seq(
      'tools',
      '{',
      repeat($.tool_declaration),
      '}',
    ),

    tool_declaration: $ => seq(
      'fun',
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      optional(seq(':', field('return_type', $._type))),
    ),

    boundaries_section: $ => seq(
      'boundaries',
      '{',
      repeat($._boundary_rule),
      '}',
    ),

    _boundary_rule: $ => choice(
      $.boundary_assignment,
      $.can_block,
      $.cannot_block,
      $.requires_approval_block,
    ),

    boundary_assignment: $ => seq(
      field('name', $.identifier),
      '=',
      field('value', $._expression),
    ),

    can_block: $ => seq('can', $.block),
    cannot_block: $ => seq('cannot', $.block),
    requires_approval_block: $ => seq('requiresApproval', $.block),

    team_section: $ => seq(
      'team',
      '{',
      repeat($.team_member),
      '}',
    ),

    team_member: $ => seq(
      'val',
      field('name', $.identifier),
      '=',
      'spawn',
      '<',
      field('agent_type', $._type),
      '>',
      '(',
      optional(commaSep1($._argument)),
      ')',
    ),

    on_handler: $ => seq(
      'on',
      '<',
      field('event_type', $._type),
      '>',
      choice($.lambda_expression, $.block),
    ),

    // ======================== Data Entities =========================

    entity_declaration: $ => seq(
      'data',
      'entity',
      field('name', $.identifier),
      optional($.type_parameters),
      '(',
      optional(commaSep1($.field_parameter)),
      ')',
      optional(seq(':', commaSep1($._type))),
      optional(field('body', $.entity_body)),
    ),

    field_parameter: $ => seq(
      repeat($.modifier),
      choice('val', 'var'),
      field('name', $.identifier),
      ':',
      field('type', $._type),
      optional(seq('=', field('default', $._expression))),
    ),

    entity_body: $ => seq(
      '{',
      repeat(choice($.invariant_clause, $.function_declaration)),
      '}',
    ),

    invariant_clause: $ => seq('invariant', $.block),

    // ======================== Sealed Classes ========================

    sealed_declaration: $ => seq(
      'sealed',
      'class',
      field('name', $.identifier),
      optional($.type_parameters),
      optional(seq(':', field('supertype', $._type))),
      '{',
      repeat($.sealed_member),
      '}',
    ),

    sealed_member: $ => choice(
      $.sealed_data_class,
      $.sealed_object,
    ),

    sealed_data_class: $ => seq(
      'data',
      'class',
      field('name', $.identifier),
      '(',
      optional(commaSep1($.field_parameter)),
      ')',
      optional(seq(':', field('supertype', $._type), '(', ')')),
    ),

    sealed_object: $ => seq(
      'object',
      field('name', $.identifier),
      optional(seq(':', field('supertype', $._type), '(', ')')),
    ),

    // ======================== Interfaces ============================

    interface_declaration: $ => seq(
      'interface',
      field('name', $.identifier),
      optional($.type_parameters),
      optional(seq(':', commaSep1($._type))),
      '{',
      repeat($._interface_member),
      '}',
    ),

    _interface_member: $ => choice(
      $.abstract_field,
      $.function_signature,
      $.function_declaration,
    ),

    abstract_field: $ => seq(
      'val',
      field('name', $.identifier),
      ':',
      field('type', $._type),
    ),

    function_signature: $ => seq(
      'fun',
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      ':',
      field('return_type', $._type),
    ),

    // ======================== Type Aliases ==========================

    type_alias: $ => seq(
      'type',
      field('name', $.identifier),
      optional($.type_parameters),
      '=',
      field('type', $._type),
    ),

    // ======================== Diagnosable Classes ===================

    diagnosable_declaration: $ => seq(
      'diagnosable',
      'class',
      field('name', $.identifier),
      '(',
      optional(commaSep1($.field_parameter)),
      ')',
      optional(seq(':', field('supertype', $._type), '(', ')')),
      '{',
      optional($.diagnose_block),
      optional($.suggest_block),
      optional($.auto_fix_block),
      '}',
    ),

    diagnose_block: $ => seq(
      'diagnose',
      '{',
      repeat($.diagnose_check),
      '}',
    ),

    diagnose_check: $ => seq(
      'check',
      $.block,
      optional(seq('yields', $.string_template)),
    ),

    suggest_block: $ => seq(
      'suggest',
      '{',
      repeat($.string_template),
      '}',
    ),

    auto_fix_block: $ => seq(
      'autoFix',
      optional(seq('(', commaSep1($._argument), ')')),
      '{',
      repeat(choice($.attempt_clause, $.verify_clause)),
      '}',
    ),

    attempt_clause: $ => seq('attempt', $.block),
    verify_clause: $ => seq('verify', $.block),

    // ======================== Features & Specs ======================

    feature_declaration: $ => seq(
      'feature',
      '(',
      field('name', $.string_literal),
      ')',
      '{',
      repeat(choice($.spec_declaration, $.deployment_block)),
      '}',
    ),

    spec_declaration: $ => seq(
      'spec',
      '(',
      field('name', $.string_literal),
      ')',
      '{',
      repeat(choice(
        $.given_block,
        $.whenever_block,
        $.then_block,
      )),
      '}',
    ),

    given_block: $ => seq('given', $.block),
    whenever_block: $ => seq('whenever', $.block),
    then_block: $ => seq('then', $.block),

    deployment_block: $ => seq(
      'deployment',
      '{',
      repeat(seq($.identifier, '=', $._expression)),
      '}',
    ),

    // ======================== Context & Memory =====================

    context_declaration: $ => seq(
      'context',
      field('name', $.identifier),
      '{',
      repeat($.context_tier),
      optional($.auto_learn_block),
      optional($.decay_block),
      '}',
    ),

    context_tier: $ => seq(
      field('tier', choice('persistent', 'session', 'ephemeral')),
      '{',
      repeat($.field_declaration),
      '}',
    ),

    field_declaration: $ => seq(
      choice('val', 'var'),
      field('name', $.identifier),
      ':',
      field('type', $._type),
      optional(choice(
        seq('=', field('value', $._expression)),
        seq('by', field('delegate', $._expression)),
      )),
    ),

    auto_learn_block: $ => seq(
      'autoLearn',
      '{',
      repeat($.learn_rule),
      '}',
    ),

    learn_rule: $ => seq(
      'rule',
      '(',
      $.string_literal,
      ')',
      '{',
      seq('whenever', $.block),
      seq('store', $.block),
      '}',
    ),

    decay_block: $ => seq(
      'decay',
      '{',
      repeat(seq($.identifier, '=', $._expression)),
      '}',
    ),

    // ======================== Shared Resources =====================

    resource_declaration: $ => seq(
      'shared',
      'resource',
      field('name', $.identifier),
      '(',
      optional(commaSep1(choice($.field_parameter, $.parameter))),
      ')',
      '{',
      $.access_policy,
      '}',
    ),

    access_policy: $ => seq(
      'accessPolicy',
      '{',
      repeat($._policy_rule),
      '}',
    ),

    _policy_rule: $ => choice(
      seq($.identifier, '=', $._expression),
      seq('onConflict', choice($.lambda_expression, $.block)),
    ),

    // ======================== Protocols =============================

    protocol_declaration: $ => seq(
      'protocol',
      field('name', $.identifier),
      '{',
      repeat($.message_declaration),
      '}',
    ),

    message_declaration: $ => seq(
      'message',
      field('name', $.identifier),
      '(',
      optional(commaSep1($.field_parameter)),
      ')',
    ),

    // ================================================================
    // Types
    // ================================================================

    _type: $ => choice(
      $.primitive_type,
      $.type_identifier,
      $.confidence_type,
      $.nullable_type,
      $.union_type,
      $.intersection_type,
      $.nl_type,
      $.generic_type,
      $.tuple_type,
      $.function_type,
      $.parenthesized_type,
    ),

    primitive_type: _ => choice(
      'Int', 'Float', 'String', 'Bool', 'Byte',
      'Unit', 'Any', 'Nothing', 'ID', 'DateTime', 'Boolean',
    ),

    type_identifier: $ => prec.right(1, seq(
      choice($.identifier, $.qualified_identifier),
      optional($.type_arguments),
    )),

    confidence_type: $ => prec.left(PREC.CONFIDENCE, seq(
      $._type,
      '@',
      $.confidence_expression,
    )),

    nullable_type: $ => prec.left(PREC.POSTFIX, seq(
      $._type,
      '?',
    )),

    union_type: $ => prec.left(1, seq(
      $._type,
      '|',
      $._type,
    )),

    intersection_type: $ => prec.left(2, seq(
      $._type,
      '&',
      $._type,
    )),

    nl_type: $ => prec.right(2, seq(
      'NL',
      optional(seq('<', $.identifier, '>')),
    )),

    generic_type: $ => seq(
      choice('Fuzzy', 'Intent', 'Stream', 'List', 'MutableList',
             'Set', 'Map', 'MutableMap', 'Result'),
      '<',
      commaSep1($._type),
      '>',
    ),

    tuple_type: $ => seq(
      '[',
      commaSep1($._type),
      ']',
    ),

    function_type: $ => prec.right(seq(
      '(',
      optional(commaSep1($._type)),
      ')',
      '->',
      $._type,
    )),

    parenthesized_type: $ => seq('(', $._type, ')'),

    type_parameters: $ => seq(
      '<',
      commaSep1($.type_parameter),
      '>',
    ),

    type_parameter: $ => seq(
      field('name', $.identifier),
      optional(seq(':', field('bound', $._type))),
    ),

    type_arguments: $ => seq(
      '<',
      commaSep1($._type),
      '>',
    ),

    confidence_expression: $ => choice(
      $.float_literal,
      'Confidence',
      '_',
      seq('(', '>', $.float_literal, ')'),
      seq('(', '<', $.float_literal, ')'),
      seq('(', $.float_literal, '..', $.float_literal, ')'),
    ),

    // ================================================================
    // Expressions
    // ================================================================

    _expression: $ => choice(
      $.identifier,
      $.qualified_identifier,
      $._literal,
      $.this_expression,
      $.self_expression,
      $.parenthesized_expression,
      $.member_expression,
      $.safe_member_expression,
      $.non_null_expression,
      $.call_expression,
      $.index_expression,
      $.confidence_expression_val,
      $.binary_expression,
      $.unary_expression,
      $.postfix_update_expression,
      $.type_check_expression,
      $.type_cast_expression,
      $.safe_cast_expression,
      $.range_expression,
      $.in_expression,
      $.elvis_expression,
      $.semantic_expression,
      $.when_expression,
      $.if_expression,
      $.lambda_expression,
      $.delegate_expression,
      $.parallel_expression,
      $.recall_expression,
      $.ask_expression,
      $.diagnose_expression,
      $.emit_expression,
      $.try_expression,
      $.spawn_expression,
    ),

    this_expression: _ => 'this',
    self_expression: _ => 'self',

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    member_expression: $ => prec.left(PREC.MEMBER, seq(
      field('object', $._expression),
      '.',
      field('member', $.identifier),
    )),

    safe_member_expression: $ => prec.left(PREC.MEMBER, seq(
      field('object', $._expression),
      '?.',
      field('member', $.identifier),
    )),

    non_null_expression: $ => prec.left(PREC.POSTFIX, seq(
      $._expression,
      '!!',
    )),

    call_expression: $ => prec.left(PREC.POSTFIX, seq(
      field('function', $._expression),
      choice(
        seq(
          '(',
          optional(commaSep1($._argument)),
          ')',
          optional(field('trailing_lambda', $.lambda_expression)),
        ),
        field('trailing_lambda', $.lambda_expression),
      ),
    )),

    _argument: $ => choice(
      $.named_argument,
      $._expression,
    ),

    named_argument: $ => seq(
      field('name', choice($.identifier, 'from')),
      '=',
      field('value', $._expression),
    ),

    index_expression: $ => prec.left(PREC.POSTFIX, seq(
      field('object', $._expression),
      '[',
      field('index', $._expression),
      ']',
    )),

    confidence_expression_val: $ => prec.left(PREC.CONFIDENCE, seq(
      field('value', $._expression),
      '@',
      field('confidence', $.confidence_expression),
    )),

    binary_expression: $ => choice(
      ...[
        ['*', PREC.MULTIPLICATIVE],
        ['/', PREC.MULTIPLICATIVE],
        ['%', PREC.MULTIPLICATIVE],
        ['per', PREC.MULTIPLICATIVE],
        ['+', PREC.ADDITIVE],
        ['-', PREC.ADDITIVE],
        ['<', PREC.COMPARISON],
        ['>', PREC.COMPARISON],
        ['<=', PREC.COMPARISON],
        ['>=', PREC.COMPARISON],
        ['==', PREC.EQUALITY],
        ['!=', PREC.EQUALITY],
        ['matches', PREC.EQUALITY],
        ['&&', PREC.AND],
        ['||', PREC.OR],
        ['to', PREC.RANGE],
      ].map(([op, prec_level]) =>
        prec.left(prec_level, seq(
          field('left', $._expression),
          field('operator', op),
          field('right', $._expression),
        ))
      ),
    ),

    unary_expression: $ => prec.right(PREC.UNARY, seq(
      field('operator', choice('-', '!')),
      field('operand', $._expression),
    )),

    postfix_update_expression: $ => prec.left(PREC.POSTFIX, seq(
      field('operand', $._expression),
      field('operator', choice('++', '--')),
    )),

    type_check_expression: $ => prec.left(PREC.TYPE_OP, seq(
      field('value', $._expression),
      'is',
      field('type', $._type),
      optional(seq('@', field('confidence', $.confidence_expression))),
    )),

    type_cast_expression: $ => prec.left(PREC.TYPE_OP, seq(
      field('value', $._expression),
      'as',
      field('type', $._type),
    )),

    safe_cast_expression: $ => prec.left(PREC.TYPE_OP, seq(
      field('value', $._expression),
      'as?',
      field('type', $._type),
    )),

    range_expression: $ => prec.left(PREC.RANGE, seq(
      field('start', $._expression),
      '..',
      field('end', $._expression),
    )),

    in_expression: $ => prec.left(PREC.CONTAINMENT, seq(
      field('value', $._expression),
      'in',
      field('collection', $._expression),
    )),

    elvis_expression: $ => prec.right(PREC.ELVIS, seq(
      field('value', $._expression),
      '?:',
      field('fallback', $._expression),
    )),

    semantic_expression: $ => prec.left(PREC.SEMANTIC, seq(
      field('left', $._expression),
      field('operator', choice('~=', '~>', '<~')),
      field('right', $._expression),
    )),

    when_expression: $ => seq(
      'when',
      optional(seq('(', field('subject', $._expression), ')')),
      '{',
      repeat($.when_branch),
      '}',
    ),

    when_branch: $ => choice(
      seq(
        field('condition', $.when_condition),
        '->',
        field('body', choice($._expression, $.block)),
      ),
      seq(
        'else',
        '->',
        field('body', choice($._expression, $.block)),
      ),
    ),

    when_condition: $ => choice(
      seq('is', $._type, optional(seq('@', $.confidence_expression))),
      $._expression,
    ),

    if_expression: $ => prec.right(seq(
      'if',
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', choice($.block, $._expression)),
      optional(seq(
        'else',
        field('alternative', choice($.if_expression, $.block, $._expression)),
      )),
    )),

    lambda_expression: $ => seq(
      '{',
      optional(seq($.lambda_parameters, '->')),
      repeat($._statement),
      '}',
    ),

    lambda_parameters: $ => commaSep1($.identifier),

    string_template: $ => seq(
      '"',
      repeat(choice(
        $.string_content,
        $.template_substitution,
        $.simple_substitution,
        $.escape_sequence,
      )),
      '"',
    ),

    string_content: _ => token.immediate(prec(1, /[^"\\$]+/)),
    template_substitution: $ => seq(
      token.immediate('${'),
      $._expression,
      '}',
    ),
    simple_substitution: $ => seq(
      token.immediate('$'),
      $.identifier,
    ),
    escape_sequence: _ => token.immediate(/\\[\\'"nbrt$]/),

    // Special call expressions
    delegate_expression: $ => seq(
      'delegate',
      '(',
      field('target', $._expression),
      ')',
      field('body', choice($.lambda_expression, $.block)),
    ),

    parallel_expression: $ => seq(
      'parallel',
      field('body', $.lambda_expression),
    ),

    spawn_expression: $ => seq(
      'spawn',
      '<',
      field('type', $._type),
      '>',
      '(',
      optional(commaSep1($._argument)),
      ')',
    ),

    recall_expression: $ => seq('recall', '(', $._expression, ')'),
    ask_expression: $ => seq('ask', '(', $._expression, ')'),
    diagnose_expression: $ => seq('diagnose', '(', $._expression, ')'),
    emit_expression: $ => seq('emit', '(', $._expression, ')'),

    try_expression: $ => seq(
      'try',
      field('body', $.block),
      repeat1($.catch_clause),
    ),

    catch_clause: $ => seq(
      'catch',
      '(',
      field('name', $.identifier),
      ':',
      field('type', $._type),
      ')',
      field('body', $.block),
    ),

    // ================================================================
    // Statements
    // ================================================================

    _statement: $ => choice(
      $.val_declaration,
      $.var_declaration,
      $.assignment_statement,
      $.return_statement,
      $.for_statement,
      $.while_statement,
      $.expression_statement,
    ),

    val_declaration: $ => seq(
      'val',
      field('pattern', $._pattern),
      optional(seq(':', field('type', $._type))),
      '=',
      field('value', $._expression),
    ),

    var_declaration: $ => seq(
      'var',
      field('name', $.identifier),
      optional(seq(':', field('type', $._type))),
      optional(seq('=', field('value', $._expression))),
    ),

    assignment_statement: $ => prec.right(seq(
      field('target', $._expression),
      '=',
      field('value', $._expression),
    )),

    return_statement: $ => prec.right(seq(
      'return',
      optional(field('value', $._expression)),
    )),

    for_statement: $ => seq(
      'for',
      '(',
      field('variable', $.identifier),
      'in',
      field('iterable', $._expression),
      ')',
      field('body', $.block),
    ),

    while_statement: $ => seq(
      'while',
      '(',
      field('condition', $._expression),
      ')',
      field('body', $.block),
    ),

    expression_statement: $ => $._expression,

    // ================================================================
    // Patterns
    // ================================================================

    _pattern: $ => choice(
      $.identifier,
      $.destructuring_pattern,
      $.wildcard_pattern,
    ),

    destructuring_pattern: $ => seq(
      '(',
      commaSep1($.identifier),
      ')',
    ),

    wildcard_pattern: _ => '_',

    // ================================================================
    // Blocks
    // ================================================================

    block: $ => seq(
      '{',
      repeat($._statement),
      '}',
    ),

    // ================================================================
    // Literals & Identifiers
    // ================================================================

    _literal: $ => choice(
      $.int_literal,
      $.float_literal,
      $.string_template,
      $.bool_literal,
      $.null_literal,
    ),

    int_literal: _ => token(/[0-9][0-9_]*/),

    float_literal: _ => token(/[0-9][0-9]*\.[0-9][0-9_]*/),

    string_literal: $ => seq(
      '"',
      repeat(choice(
        /[^"\\]+/,
        $.escape_sequence,
      )),
      '"',
    ),

    bool_literal: _ => choice('true', 'false'),

    null_literal: _ => 'null',

    identifier: _ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    qualified_identifier: $ => prec.left(seq(
      $.identifier,
      repeat1(seq('.', $.identifier)),
    )),

    // ================================================================
    // Comments
    // ================================================================

    line_comment: _ => token(seq('//', /.*/)),

    block_comment: _ => token(seq(
      '/*',
      /[^*]*\*+([^/*][^*]*\*+)*/,
      '/',
    )),
  },
});

// ================================================================
// Helpers
// ================================================================

/**
 * Creates a comma-separated list of one or more items.
 * @param {RuleOrLiteral} rule
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)), optional(','));
}
