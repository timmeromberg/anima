/**
 * Type inference for Anima expressions.
 *
 * Given a tree-sitter SyntaxNode and a TypeEnvironment, infers the AnimaType
 * of the expression. Returns `unknown` for unsupported or ambiguous cases.
 */

import {
  AnimaType,
  mkIntType,
  mkFloatType,
  mkStringType,
  mkBoolType,
  mkNullType,
  mkUnitType,
  mkUnknownType,
  mkListType,
  mkMapType,
  mkConfidentType,
  mkNullableType,
  mkFunctionType,
  mkUnionType,
  typeToString,
  ParamType,
} from './types';
import { TypeEnvironment } from './type-env';
import { isSubtype } from './subtyping';

/**
 * Minimal SyntaxNode interface — mirrors the one in interpreter/src/values.ts
 * so the typechecker package has no hard dependency on the interpreter.
 */
export interface SyntaxNodeRef {
  type: string;
  text: string;
  children: SyntaxNodeRef[];
  childForFieldName(name: string): SyntaxNodeRef | null;
  namedChildren: SyntaxNodeRef[];
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Infer the type of an expression node.
 */
export function inferType(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  switch (node.type) {
    // ---- Literals ----
    case 'int_literal':
      return mkIntType();
    case 'float_literal':
      return mkFloatType();
    case 'string_template':
    case 'string_literal':
      return mkStringType();
    case 'bool_literal':
      return mkBoolType();
    case 'null_literal':
      return mkNullType();

    // ---- Identifiers ----
    case 'identifier':
      return inferIdentifier(node, env);
    case 'qualified_identifier':
      return inferQualifiedIdentifier(node, env);

    // ---- Expressions ----
    case 'binary_expression':
      return inferBinaryExpression(node, env);
    case 'unary_expression':
      return inferUnaryExpression(node, env);
    case 'call_expression':
      return inferCallExpression(node, env);
    case 'member_expression':
      return inferMemberExpression(node, env);
    case 'safe_member_expression':
      return inferSafeMemberExpression(node, env);
    case 'index_expression':
      return inferIndexExpression(node, env);
    case 'if_expression':
      return inferIfExpression(node, env);
    case 'when_expression':
      return inferWhenExpression(node, env);
    case 'lambda_expression':
      return inferLambdaExpression(node, env);
    case 'parenthesized_expression':
      return inferParenthesized(node, env);
    case 'confidence_expression_val':
      return inferConfidenceExpression(node, env);
    case 'range_expression':
      return mkListType(mkIntType());
    case 'elvis_expression':
      return inferElvisExpression(node, env);
    case 'non_null_expression':
      return inferNonNullExpression(node, env);

    // ---- Type checks / casts ----
    case 'type_check_expression':
      return mkBoolType();
    case 'type_cast_expression':
    case 'safe_cast_expression':
      return inferCastExpression(node, env);

    // ---- Containers ----
    case 'list_literal':
      return inferListLiteral(node, env);
    case 'map_literal':
      return inferMapLiteral(node, env);

    // ---- Block ----
    case 'block':
      return inferBlock(node, env);

    // ---- Statements that produce Unit ----
    case 'expression_statement':
      if (node.namedChildren.length > 0) {
        return inferType(node.namedChildren[0], env);
      }
      return mkUnitType();

    default:
      return mkUnknownType();
  }
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

function inferIdentifier(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const name = node.text;
  const type = env.lookup(name);
  if (type) return type;
  // Could be a type name used as constructor — check type aliases
  const resolved = env.resolveType(name);
  if (resolved) return resolved;
  return mkUnknownType();
}

function inferQualifiedIdentifier(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  // e.g. Shape.Circle — try the whole text first, then the last part
  const fullText = node.text;
  const type = env.lookup(fullText);
  if (type) return type;
  // Try last segment
  const parts = fullText.split('.');
  const last = parts[parts.length - 1];
  const lastType = env.lookup(last);
  if (lastType) return lastType;
  return mkUnknownType();
}

function inferBinaryExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const leftNode = node.childForFieldName('left');
  const rightNode = node.childForFieldName('right');
  if (!leftNode || !rightNode) return mkUnknownType();

  const leftType = inferType(leftNode, env);
  const rightType = inferType(rightNode, env);

  // Determine operator
  const op = getOperatorText(node);

  // Comparison operators always return Bool
  if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
    return mkBoolType();
  }

  // Logical operators always return Bool
  if (['&&', '||'].includes(op)) {
    return mkBoolType();
  }

  // String concatenation: String + anything => String
  if (op === '+' && (leftType.tag === 'string' || rightType.tag === 'string')) {
    return mkStringType();
  }

  // Arithmetic operators
  if (['+', '-', '*', '/', '%'].includes(op)) {
    if (leftType.tag === 'int' && rightType.tag === 'int') {
      return op === '/' ? mkFloatType() : mkIntType();
    }
    if (isNumeric(leftType) && isNumeric(rightType)) {
      return mkFloatType();
    }
  }

  // 'to' creates a Pair/range (we model as a tuple-like list)
  if (op === 'to') {
    return mkListType(leftType);
  }

  return mkUnknownType();
}

function inferUnaryExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const operandNode = node.childForFieldName('operand');
  if (!operandNode) {
    // Try first named child
    if (node.namedChildren.length > 0) {
      const inner = inferType(node.namedChildren[0], env);
      return inferUnaryResultType(node, inner);
    }
    return mkUnknownType();
  }
  const operandType = inferType(operandNode, env);
  return inferUnaryResultType(node, operandType);
}

function inferUnaryResultType(node: SyntaxNodeRef, operandType: AnimaType): AnimaType {
  const op = getOperatorText(node);
  if (op === '!' || op === 'not') return mkBoolType();
  if (op === '-') return operandType; // negation preserves type
  return operandType;
}

function inferCallExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const funcNode = node.childForFieldName('function');
  if (!funcNode) return mkUnknownType();

  const funcType = inferType(funcNode, env);
  if (funcType.tag === 'function') {
    return funcType.returnType;
  }

  // Could be an entity constructor — if funcType is an entity, calling it returns that entity
  if (funcType.tag === 'entity') {
    return funcType;
  }

  return mkUnknownType();
}

function inferMemberExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const objNode = node.childForFieldName('object');
  const memberNode = node.childForFieldName('member');
  if (!objNode || !memberNode) return mkUnknownType();

  const objType = inferType(objNode, env);
  const memberName = memberNode.text;

  return lookupMemberType(objType, memberName);
}

function inferSafeMemberExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const objNode = node.childForFieldName('object');
  const memberNode = node.childForFieldName('member');
  if (!objNode || !memberNode) return mkUnknownType();

  const objType = inferType(objNode, env);
  const memberName = memberNode.text;

  // Safe member access (?.) unwraps nullable, result is nullable
  const innerType = objType.tag === 'nullable' ? objType.inner : objType;
  const fieldType = lookupMemberType(innerType, memberName);
  if (fieldType.tag === 'unknown') return mkUnknownType();
  return mkNullableType(fieldType);
}

function inferIndexExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const objNode = node.childForFieldName('object');
  if (!objNode) return mkUnknownType();

  const objType = inferType(objNode, env);
  if (objType.tag === 'list') return mkNullableType(objType.element);
  if (objType.tag === 'map') return mkNullableType(objType.value);
  if (objType.tag === 'string') return mkStringType();
  return mkUnknownType();
}

function inferIfExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const consequenceNode = node.childForFieldName('consequence');
  const alternativeNode = node.childForFieldName('alternative');

  if (!consequenceNode) return mkUnitType();

  const thenType = inferType(consequenceNode, env);
  if (!alternativeNode) return mkNullableType(thenType);

  const elseType = inferType(alternativeNode, env);

  // If both branches return the same type, use that
  if (isSubtype(thenType, elseType) && isSubtype(elseType, thenType)) {
    return thenType;
  }
  // Otherwise form a union
  return mkUnionType([thenType, elseType]);
}

function inferWhenExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const branchTypes: AnimaType[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'when_branch') {
      const body = child.childForFieldName('body');
      if (body) branchTypes.push(inferType(body, env));
    } else if (child.type === 'when_else') {
      const body = child.childForFieldName('body');
      if (body) branchTypes.push(inferType(body, env));
    }
  }
  if (branchTypes.length === 0) return mkUnitType();
  if (branchTypes.length === 1) return branchTypes[0];

  // Check if all branches are the same type
  const first = branchTypes[0];
  if (branchTypes.every(t => isSubtype(t, first) && isSubtype(first, t))) {
    return first;
  }
  return mkUnionType(branchTypes);
}

function inferLambdaExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  // Extract parameter names (we don't know their types without context)
  const params: ParamType[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'lambda_parameter' || child.type === 'identifier') {
      params.push({ name: child.text, type: mkUnknownType(), hasDefault: false });
    }
  }

  // The body is the last named child (a block or expression)
  const bodyNode = node.namedChildren[node.namedChildren.length - 1];
  const returnType = bodyNode ? inferType(bodyNode, env) : mkUnitType();

  return mkFunctionType(params, returnType);
}

function inferParenthesized(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  if (node.namedChildren.length > 0) {
    return inferType(node.namedChildren[0], env);
  }
  return mkUnitType();
}

function inferConfidenceExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const valueNode = node.childForFieldName('value');
  if (!valueNode) {
    // Try first named child
    if (node.namedChildren.length > 0) {
      return mkConfidentType(inferType(node.namedChildren[0], env));
    }
    return mkConfidentType(mkUnknownType());
  }
  return mkConfidentType(inferType(valueNode, env));
}

function inferElvisExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const leftNode = node.childForFieldName('left');
  const rightNode = node.childForFieldName('right');
  if (!leftNode || !rightNode) return mkUnknownType();

  const leftType = inferType(leftNode, env);
  // Elvis unwraps nullable on the left; result is left's inner type or right's type
  const innerLeft = leftType.tag === 'nullable' ? leftType.inner : leftType;
  const rightType = inferType(rightNode, env);

  if (isSubtype(innerLeft, rightType) && isSubtype(rightType, innerLeft)) {
    return innerLeft;
  }
  return mkUnionType([innerLeft, rightType]);
}

function inferNonNullExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  const operandNode = node.childForFieldName('operand') ?? node.namedChildren[0];
  if (!operandNode) return mkUnknownType();
  const operandType = inferType(operandNode, env);
  if (operandType.tag === 'nullable') return operandType.inner;
  return operandType;
}

function inferCastExpression(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  // Try to resolve the target type name
  const typeNode = node.childForFieldName('type');
  if (typeNode) {
    return resolveTypeName(typeNode.text, env);
  }
  return mkUnknownType();
}

function inferListLiteral(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  if (node.namedChildren.length === 0) return mkListType(mkUnknownType());
  const elementType = inferType(node.namedChildren[0], env);
  return mkListType(elementType);
}

function inferMapLiteral(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  if (node.namedChildren.length === 0) return mkMapType(mkStringType(), mkUnknownType());
  // Try to infer from first entry
  const firstEntry = node.namedChildren[0];
  if (firstEntry && firstEntry.namedChildren.length >= 2) {
    const keyType = inferType(firstEntry.namedChildren[0], env);
    const valType = inferType(firstEntry.namedChildren[1], env);
    return mkMapType(keyType, valType);
  }
  return mkMapType(mkStringType(), mkUnknownType());
}

function inferBlock(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
  // Type of a block is the type of its last expression
  const children = node.namedChildren;
  if (children.length === 0) return mkUnitType();
  return inferType(children[children.length - 1], env);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function isNumeric(t: AnimaType): boolean {
  return t.tag === 'int' || t.tag === 'float';
}

/**
 * Look up a field or property on a type.
 */
function lookupMemberType(objType: AnimaType, memberName: string): AnimaType {
  if (objType.tag === 'entity') {
    const field = objType.fields.find(f => f.name === memberName);
    if (field) return field.type;
    return mkUnknownType();
  }
  if (objType.tag === 'interface') {
    const member = objType.members.find(m => m.name === memberName);
    if (member) return member.type;
    return mkUnknownType();
  }
  // Built-in properties on common types
  if (objType.tag === 'list') {
    if (memberName === 'size') return mkIntType();
    if (memberName === 'isEmpty') return mkFunctionType([], mkBoolType());
    if (memberName === 'first') return mkNullableType(objType.element);
    if (memberName === 'last') return mkNullableType(objType.element);
  }
  if (objType.tag === 'map') {
    if (memberName === 'size') return mkIntType();
    if (memberName === 'keys') return mkListType(objType.key);
    if (memberName === 'values') return mkListType(objType.value);
  }
  if (objType.tag === 'string') {
    if (memberName === 'length') return mkIntType();
    if (memberName === 'isEmpty') return mkFunctionType([], mkBoolType());
  }
  return mkUnknownType();
}

/**
 * Resolve a type name string to an AnimaType via the environment.
 */
function resolveTypeName(name: string, env: TypeEnvironment): AnimaType {
  const wellKnown: Record<string, AnimaType> = {
    Int: mkIntType(),
    Float: mkFloatType(),
    String: mkStringType(),
    Bool: mkBoolType(),
    Unit: mkUnitType(),
    Null: mkNullType(),
  };
  if (wellKnown[name]) return wellKnown[name];
  const resolved = env.resolveType(name);
  if (resolved) return resolved;
  return mkUnknownType();
}

/**
 * Extract operator text from a binary or unary expression node.
 */
function getOperatorText(node: SyntaxNodeRef): string {
  const opNode = node.childForFieldName('operator');
  if (opNode) return opNode.text;

  // Fallback: scan anonymous children for operator tokens
  for (const child of node.children) {
    const text = child.text;
    if (
      [
        '+', '-', '*', '/', '%', '<', '>', '<=', '>=',
        '==', '!=', '&&', '||', 'to', 'per', 'matches',
        '!', 'not', '++', '--',
      ].includes(text)
    ) {
      return text;
    }
  }
  return '';
}
