/**
 * AST type helpers for working with tree-sitter SyntaxNode.
 *
 * Rather than building a custom AST, we work directly with
 * tree-sitter's SyntaxNode and provide helpers/guards for
 * the Anima-specific node types.
 */

import type { SyntaxNodeRef } from './values';

// ---- Declaration node types ----

export type DeclarationType =
  | 'function_declaration'
  | 'val_declaration'
  | 'var_declaration'
  | 'import_declaration'
  | 'module_declaration'
  | 'intent_declaration'
  | 'evolving_declaration'
  | 'fuzzy_declaration'
  | 'entity_declaration'
  | 'sealed_declaration'
  | 'interface_declaration'
  | 'type_alias'
  | 'agent_declaration'
  | 'feature_declaration'
  | 'context_declaration'
  | 'resource_declaration'
  | 'protocol_declaration'
  | 'diagnosable_declaration';

// ---- Statement node types ----

export type StatementType =
  | 'val_declaration'
  | 'var_declaration'
  | 'assignment_statement'
  | 'return_statement'
  | 'for_statement'
  | 'while_statement'
  | 'expression_statement';

// ---- Expression node types ----

export type ExpressionType =
  | 'identifier'
  | 'qualified_identifier'
  | 'int_literal'
  | 'float_literal'
  | 'string_template'
  | 'string_literal'
  | 'bool_literal'
  | 'null_literal'
  | 'binary_expression'
  | 'unary_expression'
  | 'postfix_update_expression'
  | 'call_expression'
  | 'member_expression'
  | 'safe_member_expression'
  | 'index_expression'
  | 'if_expression'
  | 'when_expression'
  | 'lambda_expression'
  | 'parenthesized_expression'
  | 'range_expression'
  | 'elvis_expression'
  | 'try_expression'
  | 'this_expression'
  | 'self_expression'
  | 'non_null_expression'
  | 'in_expression'
  | 'type_check_expression'
  | 'type_cast_expression'
  | 'safe_cast_expression'
  | 'string_content'
  | 'template_substitution'
  | 'simple_substitution'
  | 'escape_sequence'
  | 'delegate_expression'
  | 'parallel_expression'
  | 'spawn_expression'
  | 'recall_expression'
  | 'ask_expression'
  | 'diagnose_expression'
  | 'emit_expression'
  | 'semantic_expression'
  | 'confidence_expression_val';

// ---- Helpers ----

/**
 * Get all named children of a given type.
 */
export function childrenOfType(node: SyntaxNodeRef, type: string): SyntaxNodeRef[] {
  return node.namedChildren.filter(c => c.type === type);
}

/**
 * Get the first named child of a given type, or null.
 */
export function childOfType(node: SyntaxNodeRef, type: string): SyntaxNodeRef | null {
  return node.namedChildren.find(c => c.type === type) ?? null;
}

/**
 * Check if a node is of a specific type.
 */
export function isNodeType(node: SyntaxNodeRef, type: string): boolean {
  return node.type === type;
}

/**
 * Get the field from a node by field name, or throw if not found.
 */
export function requiredField(node: SyntaxNodeRef, fieldName: string): SyntaxNodeRef {
  const child = node.childForFieldName(fieldName);
  if (!child) {
    throw new Error(`Expected field '${fieldName}' on ${node.type} node, but it was missing`);
  }
  return child;
}

/**
 * Get an optional field from a node.
 */
export function optionalField(node: SyntaxNodeRef, fieldName: string): SyntaxNodeRef | null {
  return node.childForFieldName(fieldName);
}

/**
 * Get the operator text from a binary expression.
 * The operator is stored as an anonymous child node between left and right.
 */
export function getOperator(node: SyntaxNodeRef): string {
  const opNode = node.childForFieldName('operator');
  if (opNode) return opNode.text;

  // Fallback: look for anonymous operator between named children
  for (const child of node.children) {
    if (!child.type.startsWith('_') && child !== node.childForFieldName('left') && child !== node.childForFieldName('right') && child !== node.childForFieldName('operand')) {
      const text = child.text;
      if (['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!=', '&&', '||', 'to', 'per', 'matches', '!', '++', '--'].includes(text)) {
        return text;
      }
    }
  }
  return '';
}
