/**
 * Tree-walking interpreter for the Anima programming language.
 *
 * Evaluates the tree-sitter AST by recursively visiting nodes.
 */

import { Environment } from './environment';
import {
  AnimaValue,
  SyntaxNodeRef,
  ParamDef,
  EntityFieldDef,
  mkInt,
  mkFloat,
  mkString,
  mkBool,
  mkNull,
  mkUnit,
  mkList,
  mkMap,
  mkFunction,
  mkEntity,
  mkEntityType,
  isTruthy,
  valueToString,
  valuesEqual,
  asNumber,
} from './values';
import {
  AnimaRuntimeError,
  AnimaTypeError,
  AnimaNameError,
  ReturnSignal,
  BreakSignal,
} from './errors';
import { registerBuiltins } from './builtins';
import { requiredField, childrenOfType, childOfType } from './ast';

export class Interpreter {
  private globalEnv: Environment;

  constructor() {
    this.globalEnv = new Environment();
    registerBuiltins(this.globalEnv);
  }

  /**
   * Execute a full program from the root node of a parsed AST.
   * If a `main()` function is defined, it is called automatically.
   */
  run(rootNode: SyntaxNodeRef): AnimaValue {
    const result = this.evalProgram(rootNode, this.globalEnv);
    // Auto-call main() if it exists
    try {
      const mainFn = this.globalEnv.get('main');
      if (mainFn.kind === 'function' || mainFn.kind === 'builtin') {
        return this.callFunction(mainFn, [], new Map(), rootNode, this.globalEnv);
      }
    } catch (e) {
      if (e instanceof AnimaNameError) {
        // No main function — that's fine
      } else {
        throw e;
      }
    }
    return result;
  }

  /**
   * Get the global environment (useful for testing).
   */
  getGlobalEnv(): Environment {
    return this.globalEnv;
  }

  // ==================================================================
  // Program & Declarations
  // ==================================================================

  private evalProgram(node: SyntaxNodeRef, env: Environment): AnimaValue {
    let result: AnimaValue = mkUnit();
    for (const child of node.namedChildren) {
      result = this.evalNode(child, env);
    }
    return result;
  }

  /**
   * Main dispatch: evaluate any node.
   */
  evalNode(node: SyntaxNodeRef, env: Environment): AnimaValue {
    switch (node.type) {
      // ---- Declarations ----
      case 'function_declaration':
        return this.evalFunctionDeclaration(node, env);
      case 'val_declaration':
        return this.evalValDeclaration(node, env);
      case 'var_declaration':
        return this.evalVarDeclaration(node, env);
      case 'module_declaration':
      case 'import_declaration':
        // Ignored for now -- modules/imports are not yet supported
        return mkUnit();
      case 'line_comment':
      case 'block_comment':
        return mkUnit();

      // ---- Statements ----
      case 'assignment_statement':
        return this.evalAssignment(node, env);
      case 'return_statement':
        return this.evalReturn(node, env);
      case 'for_statement':
        return this.evalFor(node, env);
      case 'while_statement':
        return this.evalWhile(node, env);
      case 'expression_statement':
        return this.evalExpressionStatement(node, env);

      // ---- Expressions ----
      case 'identifier':
        return this.evalIdentifier(node, env);
      case 'qualified_identifier':
        return this.evalQualifiedIdentifier(node, env);
      case 'int_literal':
        return this.evalIntLiteral(node);
      case 'float_literal':
        return this.evalFloatLiteral(node);
      case 'string_template':
        return this.evalStringTemplate(node, env);
      case 'string_literal':
        return this.evalStringLiteral(node);
      case 'bool_literal':
        return this.evalBoolLiteral(node);
      case 'null_literal':
        return mkNull();
      case 'binary_expression':
        return this.evalBinaryExpression(node, env);
      case 'unary_expression':
        return this.evalUnaryExpression(node, env);
      case 'postfix_update_expression':
        return this.evalPostfixUpdate(node, env);
      case 'call_expression':
        return this.evalCallExpression(node, env);
      case 'member_expression':
        return this.evalMemberExpression(node, env);
      case 'safe_member_expression':
        return this.evalSafeMemberExpression(node, env);
      case 'index_expression':
        return this.evalIndexExpression(node, env);
      case 'if_expression':
        return this.evalIfExpression(node, env);
      case 'when_expression':
        return this.evalWhenExpression(node, env);
      case 'lambda_expression':
        return this.evalLambdaExpression(node, env);
      case 'parenthesized_expression':
        return this.evalParenthesizedExpression(node, env);
      case 'range_expression':
        return this.evalRangeExpression(node, env);
      case 'elvis_expression':
        return this.evalElvisExpression(node, env);
      case 'try_expression':
        return this.evalTryExpression(node, env);
      case 'non_null_expression':
        return this.evalNonNullExpression(node, env);
      case 'in_expression':
        return this.evalInExpression(node, env);
      case 'this_expression':
      case 'self_expression':
        return env.get('this');

      // ---- Block ----
      case 'block':
        return this.evalBlock(node, env);

      // ---- Entity declarations ----
      case 'entity_declaration':
        return this.evalEntityDeclaration(node, env);

      // ---- AI-first constructs (stubs) ----
      case 'intent_declaration':
      case 'evolving_declaration':
      case 'fuzzy_declaration':
      case 'agent_declaration':
      case 'feature_declaration':
      case 'context_declaration':
      case 'resource_declaration':
      case 'protocol_declaration':
      case 'diagnosable_declaration':
      case 'sealed_declaration':
      case 'interface_declaration':
      case 'type_alias':
        return this.evalStub(node);

      // ---- AI-first expression stubs ----
      case 'semantic_expression':
      case 'confidence_expression_val':
      case 'delegate_expression':
      case 'parallel_expression':
      case 'spawn_expression':
      case 'recall_expression':
      case 'ask_expression':
      case 'diagnose_expression':
      case 'emit_expression':
        return this.evalStub(node);

      // ---- Type expressions (ignored at runtime) ----
      case 'type_check_expression':
        return this.evalTypeCheck(node, env);
      case 'type_cast_expression':
      case 'safe_cast_expression':
        // For now, just return the value unchanged
        return this.evalNode(requiredField(node, 'value'), env);

      default:
        throw new AnimaRuntimeError(
          `Unsupported node type: '${node.type}'`,
          node.startPosition.row + 1,
          node.startPosition.column,
        );
    }
  }

  // ==================================================================
  // Declarations
  // ==================================================================

  private evalFunctionDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;

    const paramsNode = requiredField(node, 'parameters');
    const params = this.extractParams(paramsNode);

    const bodyNode = requiredField(node, 'body');

    const fn = mkFunction(name, params, bodyNode, env);
    env.defineOrUpdate(name, fn, false);
    return mkUnit();
  }

  private evalValDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const patternNode = node.childForFieldName('pattern');
    const valueNode = requiredField(node, 'value');

    const value = this.evalNode(valueNode, env);

    if (patternNode) {
      if (patternNode.type === 'identifier') {
        env.define(patternNode.text, value, false);
      } else if (patternNode.type === 'destructuring_pattern') {
        const identifiers = patternNode.namedChildren.filter(c => c.type === 'identifier');
        if (value.kind === 'entity') {
          // Destructure entity by field order
          for (let i = 0; i < identifiers.length; i++) {
            const fieldName = i < value.fieldOrder.length ? value.fieldOrder[i] : null;
            const fieldVal = fieldName ? value.fields.get(fieldName) ?? mkNull() : mkNull();
            env.define(identifiers[i].text, fieldVal, false);
          }
        } else if (value.kind === 'list') {
          for (let i = 0; i < identifiers.length; i++) {
            env.define(
              identifiers[i].text,
              i < value.elements.length ? value.elements[i] : mkNull(),
              false,
            );
          }
        } else {
          throw new AnimaTypeError(
            'Destructuring requires a list or entity value',
            patternNode.startPosition.row + 1,
            patternNode.startPosition.column,
          );
        }
      } else if (patternNode.type === 'wildcard_pattern') {
        // _ pattern -- discard the value
      }
    }

    return mkUnit();
  }

  private evalVarDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;
    const valueNode = node.childForFieldName('value');
    const value = valueNode ? this.evalNode(valueNode, env) : mkNull();
    env.define(name, value, true);
    return mkUnit();
  }

  private evalEntityDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;

    // Extract field definitions from field_parameter children
    const fieldDefs: EntityFieldDef[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'field_parameter') {
        const fieldName = requiredField(child, 'name').text;
        // Check if it's var (mutable) -- default is val (immutable)
        const isVar = child.children.some(c => c.text === 'var');
        const defaultNode = child.childForFieldName('default');
        fieldDefs.push({
          name: fieldName,
          mutable: isVar,
          defaultValue: defaultNode ?? undefined,
        });
      }
    }

    // Collect invariant blocks from entity_body
    const invariants: SyntaxNodeRef[] = [];
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      for (const child of bodyNode.namedChildren) {
        if (child.type === 'invariant_clause') {
          const block = childOfType(child, 'block');
          if (block) invariants.push(block);
        }
      }
    }

    // Register entity type as a callable constructor
    const entityType = mkEntityType(name, fieldDefs, invariants, env);
    env.defineOrUpdate(name, entityType, false);
    return mkUnit();
  }

  // ==================================================================
  // Statements
  // ==================================================================

  private evalAssignment(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const targetNode = requiredField(node, 'target');
    const valueNode = requiredField(node, 'value');
    const value = this.evalNode(valueNode, env);

    if (targetNode.type === 'identifier') {
      env.set(targetNode.text, value);
    } else if (targetNode.type === 'index_expression') {
      // list[i] = value  or  map[key] = value
      const obj = this.evalNode(requiredField(targetNode, 'object'), env);
      const idx = this.evalNode(requiredField(targetNode, 'index'), env);

      if (obj.kind === 'list') {
        if (!obj.mutable) throw new AnimaRuntimeError('Cannot modify immutable list');
        if (idx.kind !== 'int') throw new AnimaTypeError('List index must be Int');
        if (idx.value < 0 || idx.value >= obj.elements.length) {
          throw new AnimaRuntimeError(`Index ${idx.value} out of bounds for list of size ${obj.elements.length}`);
        }
        obj.elements[idx.value] = value;
      } else if (obj.kind === 'map') {
        if (!obj.mutable) throw new AnimaRuntimeError('Cannot modify immutable map');
        obj.entries.set(valueToString(idx), value);
      } else {
        throw new AnimaTypeError('Cannot index into ' + obj.kind);
      }
    } else if (targetNode.type === 'member_expression') {
      const objNode = requiredField(targetNode, 'object');
      const memberNode = requiredField(targetNode, 'member');
      const obj = this.evalNode(objNode, env);
      const memberName = memberNode.text;

      if (obj.kind === 'entity') {
        if (!obj.fields.has(memberName)) {
          throw new AnimaRuntimeError(
            `No field '${memberName}' on ${obj.typeName}`,
            targetNode.startPosition.row + 1,
            targetNode.startPosition.column,
          );
        }
        obj.fields.set(memberName, value);
      } else {
        throw new AnimaRuntimeError(
          `Cannot assign to member of ${obj.kind}`,
          targetNode.startPosition.row + 1,
          targetNode.startPosition.column,
        );
      }
    } else {
      throw new AnimaRuntimeError(
        `Cannot assign to ${targetNode.type}`,
        targetNode.startPosition.row + 1,
        targetNode.startPosition.column,
      );
    }
    return mkUnit();
  }

  private evalReturn(node: SyntaxNodeRef, _env: Environment): never {
    const valueNode = node.childForFieldName('value');
    const value = valueNode ? this.evalNode(valueNode, _env) : mkUnit();
    throw new ReturnSignal(value);
  }

  private evalFor(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const varNode = requiredField(node, 'variable');
    const iterableNode = requiredField(node, 'iterable');
    const bodyNode = requiredField(node, 'body');

    const iterable = this.evalNode(iterableNode, env);

    if (iterable.kind !== 'list') {
      throw new AnimaTypeError(
        `Cannot iterate over ${iterable.kind}`,
        iterableNode.startPosition.row + 1,
        iterableNode.startPosition.column,
      );
    }

    for (const element of iterable.elements) {
      const loopEnv = env.child();
      loopEnv.define(varNode.text, element, false);
      try {
        this.evalBlock(bodyNode, loopEnv);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        throw e;
      }
    }

    return mkUnit();
  }

  private evalWhile(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const condNode = requiredField(node, 'condition');
    const bodyNode = requiredField(node, 'body');

    while (true) {
      const cond = this.evalNode(condNode, env);
      if (!isTruthy(cond)) break;
      try {
        this.evalBlock(bodyNode, env);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        throw e;
      }
    }

    return mkUnit();
  }

  private evalExpressionStatement(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // expression_statement has a single child that is the expression
    if (node.namedChildren.length > 0) {
      return this.evalNode(node.namedChildren[0], env);
    }
    return mkUnit();
  }

  // ==================================================================
  // Blocks
  // ==================================================================

  evalBlock(node: SyntaxNodeRef, parentEnv: Environment): AnimaValue {
    const blockEnv = parentEnv.child();
    let result: AnimaValue = mkUnit();
    for (const child of node.namedChildren) {
      result = this.evalNode(child, blockEnv);
    }
    return result;
  }

  /**
   * Evaluate a block or lambda_expression used as a block body.
   * In the tree-sitter grammar, `if` consequence with `{...}` can parse
   * as lambda_expression instead of block due to parser conflicts.
   */
  private evalBlockOrLambdaAsBlock(node: SyntaxNodeRef, env: Environment): AnimaValue {
    if (node.type === 'block') {
      return this.evalBlock(node, env);
    }
    if (node.type === 'lambda_expression') {
      // Treat as a block: evaluate statements inside
      return this.evalLambdaAsBlock(node, env);
    }
    // It's a bare expression
    return this.evalNode(node, env);
  }

  /**
   * When a lambda_expression is used as a block body (e.g. in if consequence),
   * we evaluate its statements directly rather than creating a closure.
   */
  private evalLambdaAsBlock(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const blockEnv = env.child();
    let result: AnimaValue = mkUnit();

    // A lambda_expression acting as block has statements as children.
    // If it has lambda_parameters, it's a real lambda -- but when used
    // as an if block, it won't have parameters.
    const hasParams = node.namedChildren.some(c => c.type === 'lambda_parameters');
    if (hasParams) {
      // This is actually a lambda, not a block substitute
      return this.evalLambdaExpression(node, env);
    }

    for (const child of node.namedChildren) {
      result = this.evalNode(child, blockEnv);
    }
    return result;
  }

  // ==================================================================
  // Expressions
  // ==================================================================

  private evalIdentifier(node: SyntaxNodeRef, env: Environment): AnimaValue {
    return env.get(node.text);
  }

  private evalQualifiedIdentifier(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // A qualified identifier like a.b.c -- treat the first part as an
    // identifier lookup then chain member accesses
    const parts = node.namedChildren.filter(c => c.type === 'identifier');
    if (parts.length === 0) {
      throw new AnimaRuntimeError('Empty qualified identifier');
    }

    let value = env.get(parts[0].text);
    for (let i = 1; i < parts.length; i++) {
      value = this.accessMember(value, parts[i].text, node);
    }
    return value;
  }

  private evalIntLiteral(node: SyntaxNodeRef): AnimaValue {
    const text = node.text.replace(/_/g, '');
    return mkInt(parseInt(text, 10));
  }

  private evalFloatLiteral(node: SyntaxNodeRef): AnimaValue {
    const text = node.text.replace(/_/g, '');
    return mkFloat(parseFloat(text));
  }

  private evalStringTemplate(node: SyntaxNodeRef, env: Environment): AnimaValue {
    let result = '';
    for (const child of node.namedChildren) {
      switch (child.type) {
        case 'string_content':
          result += child.text;
          break;
        case 'template_substitution': {
          // The expression is inside ${...}
          const expr = child.namedChildren[0];
          if (expr) {
            const val = this.evalNode(expr, env);
            result += valueToString(val);
          }
          break;
        }
        case 'simple_substitution': {
          // $identifier
          const ident = child.namedChildren.find(c => c.type === 'identifier');
          if (ident) {
            const val = env.get(ident.text);
            result += valueToString(val);
          }
          break;
        }
        case 'escape_sequence':
          result += this.interpretEscape(child.text);
          break;
        default:
          // Unknown child -- skip
          break;
      }
    }
    return mkString(result);
  }

  private evalStringLiteral(node: SyntaxNodeRef): AnimaValue {
    // string_literal is "..." without template support
    // Extract content between quotes
    let result = '';
    for (const child of node.namedChildren) {
      if (child.type === 'escape_sequence') {
        result += this.interpretEscape(child.text);
      } else {
        result += child.text;
      }
    }
    // If no named children, extract directly (minus quotes)
    if (node.namedChildren.length === 0) {
      const text = node.text;
      result = text.slice(1, -1); // Remove surrounding quotes
    }
    return mkString(result);
  }

  private interpretEscape(esc: string): string {
    switch (esc) {
      case '\\n': return '\n';
      case '\\t': return '\t';
      case '\\r': return '\r';
      case '\\\\': return '\\';
      case '\\"': return '"';
      case "\\'": return "'";
      case '\\b': return '\b';
      case '\\$': return '$';
      default: return esc.slice(1); // Strip the backslash
    }
  }

  private evalBoolLiteral(node: SyntaxNodeRef): AnimaValue {
    return mkBool(node.text === 'true');
  }

  private evalBinaryExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const leftNode = requiredField(node, 'left');
    const rightNode = requiredField(node, 'right');

    // Find operator -- it's stored as a field in the grammar
    const opNode = node.childForFieldName('operator');
    const op = opNode ? opNode.text : this.findOperator(node);

    // Short-circuit for logical operators
    if (op === '&&') {
      const left = this.evalNode(leftNode, env);
      if (!isTruthy(left)) return mkBool(false);
      return mkBool(isTruthy(this.evalNode(rightNode, env)));
    }
    if (op === '||') {
      const left = this.evalNode(leftNode, env);
      if (isTruthy(left)) return mkBool(true);
      return mkBool(isTruthy(this.evalNode(rightNode, env)));
    }

    const left = this.evalNode(leftNode, env);
    const right = this.evalNode(rightNode, env);

    switch (op) {
      // Arithmetic
      case '+': return this.evalAdd(left, right, node);
      case '-': return this.evalArith(left, right, (a, b) => a - b, node);
      case '*': return this.evalArith(left, right, (a, b) => a * b, node);
      case '/': return this.evalDiv(left, right, node);
      case '%': return this.evalArith(left, right, (a, b) => a % b, node);

      // Comparison
      case '<': return mkBool(this.compareValues(left, right) < 0);
      case '>': return mkBool(this.compareValues(left, right) > 0);
      case '<=': return mkBool(this.compareValues(left, right) <= 0);
      case '>=': return mkBool(this.compareValues(left, right) >= 0);

      // Equality
      case '==': return mkBool(valuesEqual(left, right));
      case '!=': return mkBool(!valuesEqual(left, right));

      // The 'to' operator creates a pair (2-element list)
      case 'to': return mkList([left, right]);

      default:
        throw new AnimaRuntimeError(
          `Unsupported operator: '${op}'`,
          node.startPosition.row + 1,
          node.startPosition.column,
        );
    }
  }

  /**
   * Find the operator text by scanning anonymous children.
   */
  private findOperator(node: SyntaxNodeRef): string {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');
    for (const child of node.children) {
      if (child !== leftNode && child !== rightNode) {
        const t = child.text.trim();
        if (t && t !== '(' && t !== ')') return t;
      }
    }
    return '';
  }

  private evalAdd(left: AnimaValue, right: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    // String concatenation
    if (left.kind === 'string' || right.kind === 'string') {
      return mkString(valueToString(left) + valueToString(right));
    }
    return this.evalArith(left, right, (a, b) => a + b, node);
  }

  private evalArith(
    left: AnimaValue,
    right: AnimaValue,
    op: (a: number, b: number) => number,
    node: SyntaxNodeRef,
  ): AnimaValue {
    if ((left.kind === 'int' || left.kind === 'float') &&
        (right.kind === 'int' || right.kind === 'float')) {
      const result = op(left.value, right.value);
      // If either operand is float, result is float
      if (left.kind === 'float' || right.kind === 'float') {
        return mkFloat(result);
      }
      return mkInt(result);
    }
    throw new AnimaTypeError(
      `Cannot perform arithmetic on ${left.kind} and ${right.kind}`,
      node.startPosition.row + 1,
      node.startPosition.column,
    );
  }

  private evalDiv(left: AnimaValue, right: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    if ((left.kind === 'int' || left.kind === 'float') &&
        (right.kind === 'int' || right.kind === 'float')) {
      if (right.value === 0) {
        throw new AnimaRuntimeError(
          'Division by zero',
          node.startPosition.row + 1,
          node.startPosition.column,
        );
      }
      if (left.kind === 'float' || right.kind === 'float') {
        return mkFloat(left.value / right.value);
      }
      return mkInt(Math.trunc(left.value / right.value));
    }
    throw new AnimaTypeError(
      `Cannot divide ${left.kind} by ${right.kind}`,
      node.startPosition.row + 1,
      node.startPosition.column,
    );
  }

  private compareValues(left: AnimaValue, right: AnimaValue): number {
    if ((left.kind === 'int' || left.kind === 'float') &&
        (right.kind === 'int' || right.kind === 'float')) {
      return left.value - right.value;
    }
    if (left.kind === 'string' && right.kind === 'string') {
      return left.value.localeCompare(right.value);
    }
    throw new AnimaTypeError(`Cannot compare ${left.kind} and ${right.kind}`);
  }

  private evalUnaryExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const opNode = node.childForFieldName('operator');
    const operandNode = requiredField(node, 'operand');
    const op = opNode ? opNode.text : '';
    const operand = this.evalNode(operandNode, env);

    switch (op) {
      case '-':
        if (operand.kind === 'int') return mkInt(-operand.value);
        if (operand.kind === 'float') return mkFloat(-operand.value);
        throw new AnimaTypeError(`Cannot negate ${operand.kind}`);
      case '!':
        return mkBool(!isTruthy(operand));
      default:
        throw new AnimaRuntimeError(`Unknown unary operator: '${op}'`);
    }
  }

  private evalPostfixUpdate(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const operandNode = requiredField(node, 'operand');
    const opNode = node.childForFieldName('operator');
    // Fallback: check the last child for ++ or --
    let op = opNode ? opNode.text : '';
    if (!op) {
      for (const child of node.children) {
        if (child.text === '++' || child.text === '--') {
          op = child.text;
          break;
        }
      }
    }

    if (operandNode.type !== 'identifier') {
      throw new AnimaRuntimeError('Postfix update requires an identifier');
    }

    const current = env.get(operandNode.text);
    if (current.kind !== 'int') {
      throw new AnimaTypeError(`Cannot apply ${op} to ${current.kind}`);
    }

    const oldValue = current.value;
    const newValue = op === '++' ? oldValue + 1 : oldValue - 1;
    env.set(operandNode.text, mkInt(newValue));

    // Postfix: return old value
    return mkInt(oldValue);
  }

  private evalCallExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const funcNode = requiredField(node, 'function');
    const callee = this.evalNode(funcNode, env);

    // Collect arguments: skip the function node, gather the rest
    const args: AnimaValue[] = [];
    const namedArgs = new Map<string, AnimaValue>();
    const funcStart = funcNode.startPosition;
    const funcEnd = funcNode.endPosition;

    for (const child of node.namedChildren) {
      // Skip the function node (compare by position since object identity
      // may not hold for tree-sitter field accessors vs namedChildren)
      if (child.startPosition.row === funcStart.row &&
          child.startPosition.column === funcStart.column &&
          child.endPosition.row === funcEnd.row &&
          child.endPosition.column === funcEnd.column) {
        continue;
      }
      if (child.type === 'lambda_expression') {
        // Trailing lambda -- treat as last argument
        args.push(this.evalLambdaExpression(child, env));
        continue;
      }
      if (child.type === 'named_argument') {
        const argName = requiredField(child, 'name').text;
        const argValue = this.evalNode(requiredField(child, 'value'), env);
        namedArgs.set(argName, argValue);
        continue;
      }
      // Regular positional argument (could be any expression)
      args.push(this.evalNode(child, env));
    }

    return this.callFunction(callee, args, namedArgs, node, env);
  }

  private callFunction(
    callee: AnimaValue,
    args: AnimaValue[],
    namedArgs: Map<string, AnimaValue>,
    callSite: SyntaxNodeRef,
    callerEnv: Environment,
  ): AnimaValue {
    if (callee.kind === 'entity_type') {
      return this.constructEntity(callee, args, namedArgs, callSite, callerEnv);
    }

    if (callee.kind === 'builtin') {
      return callee.fn(args, namedArgs);
    }

    if (callee.kind === 'function') {
      const funcEnv = callee.closure.child();

      // Bind parameters
      for (let i = 0; i < callee.params.length; i++) {
        const param = callee.params[i];
        const namedValue = namedArgs.get(param.name);
        if (namedValue !== undefined) {
          funcEnv.define(param.name, namedValue, false);
        } else if (i < args.length) {
          funcEnv.define(param.name, args[i], false);
        } else if (param.defaultValue) {
          // Evaluate default value in the caller's environment
          funcEnv.define(param.name, this.evalNode(param.defaultValue, callerEnv), false);
        } else {
          throw new AnimaRuntimeError(
            `Missing argument '${param.name}' in call to '${callee.name}'`,
            callSite.startPosition.row + 1,
            callSite.startPosition.column,
          );
        }
      }

      // Execute body
      try {
        const body = callee.body;
        if (body.type === 'block') {
          return this.evalBlock(body, funcEnv);
        } else if (body.type === 'lambda_expression') {
          // Lambda body -- evaluate its statement children directly
          let result: AnimaValue = mkUnit();
          for (const child of body.namedChildren) {
            if (child.type === 'lambda_parameters') continue;
            result = this.evalNode(child, funcEnv);
          }
          return result;
        } else {
          // Expression body (fun foo() = expr)
          return this.evalNode(body, funcEnv);
        }
      } catch (e) {
        if (e instanceof ReturnSignal) {
          return e.value as AnimaValue;
        }
        throw e;
      }
    }

    throw new AnimaTypeError(
      `'${valueToString(callee)}' is not callable`,
      callSite.startPosition.row + 1,
      callSite.startPosition.column,
    );
  }

  private evalMemberExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const objNode = requiredField(node, 'object');
    const memberNode = requiredField(node, 'member');
    const obj = this.evalNode(objNode, env);
    const memberName = memberNode.text;

    return this.accessMember(obj, memberName, node);
  }

  private evalSafeMemberExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const objNode = requiredField(node, 'object');
    const memberNode = requiredField(node, 'member');
    const obj = this.evalNode(objNode, env);

    if (obj.kind === 'null') return mkNull();

    const memberName = memberNode.text;
    return this.accessMember(obj, memberName, node);
  }

  private accessMember(obj: AnimaValue, name: string, node: SyntaxNodeRef): AnimaValue {
    // List members
    if (obj.kind === 'list') {
      switch (name) {
        case 'size': return mkInt(obj.elements.length);
        case 'length': return mkInt(obj.elements.length);
        case 'isEmpty': return mkBuiltinMethod(() => mkBool(obj.elements.length === 0));
        case 'first': return obj.elements.length > 0 ? obj.elements[0] : mkNull();
        case 'last': return obj.elements.length > 0 ? obj.elements[obj.elements.length - 1] : mkNull();
        case 'add': return mkBuiltinMethod((args) => {
          if (!obj.mutable) throw new AnimaRuntimeError('Cannot modify immutable list');
          obj.elements.push(args[0]);
          return mkUnit();
        });
        case 'contains': return mkBuiltinMethod((args) => {
          return mkBool(obj.elements.some(el => valuesEqual(el, args[0])));
        });
        case 'filter': return mkBuiltinMethod((args) => {
          return this.listFilter(obj, args[0], node);
        });
        case 'map': return mkBuiltinMethod((args) => {
          return this.listMap(obj, args[0], node);
        });
        case 'forEach': return mkBuiltinMethod((args) => {
          return this.listForEach(obj, args[0], node);
        });
        case 'sortedBy': return mkBuiltinMethod((args) => {
          return this.listSortedBy(obj, args[0], node);
        });
        case 'flatMap': return mkBuiltinMethod((args) => {
          return this.listFlatMap(obj, args[0], node);
        });
        case 'reduce': return mkBuiltinMethod((args) => {
          return this.listReduce(obj, args[0], args[1], node);
        });
        case 'fold': return mkBuiltinMethod((args) => {
          return this.listReduce(obj, args[0], args[1], node);
        });
        case 'any': return mkBuiltinMethod((args) => {
          return this.listAny(obj, args[0], node);
        });
        case 'all': return mkBuiltinMethod((args) => {
          return this.listAll(obj, args[0], node);
        });
        case 'none': return mkBuiltinMethod((args) => {
          return this.listNone(obj, args[0], node);
        });
        case 'distinct': return mkBuiltinMethod(() => {
          const distinctElements: AnimaValue[] = [];
          for (const el of obj.elements) {
            if (!distinctElements.some(existing => valuesEqual(existing, el))) {
              distinctElements.push(el);
            }
          }
          return mkList(distinctElements);
        });
        case 'joinToString': return mkBuiltinMethod((args) => {
          const separator = args.length > 0 ? args[0] : mkString(',');
          if (separator.kind !== 'string') throw new AnimaTypeError('joinToString() expects a String separator');
          return mkString(obj.elements.map(valueToString).join(separator.value));
        });
        case 'find': return mkBuiltinMethod((args) => {
          return this.listFind(obj, args[0], node);
        });
        case 'indexOf': return mkBuiltinMethod((args) => {
          for (let i = 0; i < obj.elements.length; i++) {
            if (valuesEqual(obj.elements[i], args[0])) {
              return mkInt(i);
            }
          }
          return mkInt(-1);
        });
        case 'count': return mkBuiltinMethod((args) => {
          if (args.length === 0) return mkInt(obj.elements.length);
          if (args.length === 1) return this.listCountBy(obj, args[0], node);
          throw new AnimaRuntimeError('count() takes at most 1 argument');
        });
        case 'reversed': return mkBuiltinMethod(() => {
          return mkList([...obj.elements].reverse());
        });
        case 'zip': return mkBuiltinMethod((args) => {
          const other = args[0];
          if (other.kind !== 'list') throw new AnimaTypeError('zip() expects a List');
          const len = Math.min(obj.elements.length, other.elements.length);
          const zipped: AnimaValue[] = [];
          for (let i = 0; i < len; i++) {
            zipped.push(mkList([obj.elements[i], other.elements[i]]));
          }
          return mkList(zipped);
        });
        case 'take': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'int') throw new AnimaTypeError('take() expects an Int');
          const n = Math.max(0, args[0].value);
          return mkList(obj.elements.slice(0, n));
        });
        case 'drop': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'int') throw new AnimaTypeError('drop() expects an Int');
          const n = Math.max(0, args[0].value);
          return mkList(obj.elements.slice(n));
        });
        case 'sumOf': return mkBuiltinMethod((args) => {
          return this.listSumOf(obj, args[0], node);
        });
      }
    }

    // String members
    if (obj.kind === 'string') {
      switch (name) {
        case 'length': return mkInt(obj.value.length);
        case 'size': return mkInt(obj.value.length);
        case 'isEmpty': return mkBuiltinMethod(() => mkBool(obj.value.length === 0));
        case 'isNotBlank': return mkBuiltinMethod(() => mkBool(obj.value.trim().length > 0));
        case 'uppercase': return mkBuiltinMethod(() => mkString(obj.value.toUpperCase()));
        case 'lowercase': return mkBuiltinMethod(() => mkString(obj.value.toLowerCase()));
        case 'trim': return mkBuiltinMethod(() => mkString(obj.value.trim()));
        case 'contains': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'string') throw new AnimaTypeError('contains() expects a String');
          return mkBool(obj.value.includes(args[0].value));
        });
        case 'startsWith': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'string') throw new AnimaTypeError('startsWith() expects a String');
          return mkBool(obj.value.startsWith(args[0].value));
        });
        case 'endsWith': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'string') throw new AnimaTypeError('endsWith() expects a String');
          return mkBool(obj.value.endsWith(args[0].value));
        });
        case 'split': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'string') throw new AnimaTypeError('split() expects a String');
          return mkList(obj.value.split(args[0].value).map(s => mkString(s)));
        });
        case 'substring': return mkBuiltinMethod((args) => {
          const start = asNumber(args[0]);
          const end = args.length > 1 ? asNumber(args[1]) : obj.value.length;
          return mkString(obj.value.substring(start, end));
        });
      }
    }

    // Map members
    if (obj.kind === 'map') {
      switch (name) {
        case 'size': return mkInt(obj.entries.size);
        case 'isEmpty': return mkBuiltinMethod(() => mkBool(obj.entries.size === 0));
        case 'containsKey': return mkBuiltinMethod((args) => {
          return mkBool(obj.entries.has(valueToString(args[0])));
        });
        case 'getOrDefault': return mkBuiltinMethod((args) => {
          const key = valueToString(args[0]);
          const value = obj.entries.get(key);
          return value ?? args[1];
        });
        case 'filter': return mkBuiltinMethod((args) => {
          return this.mapFilter(obj, args[0], node);
        });
        case 'map': return mkBuiltinMethod((args) => {
          return this.mapMapValues(obj, args[0], node);
        });
        case 'entries': return this.mapEntriesToList(obj);
        case 'forEach': return mkBuiltinMethod((args) => {
          return this.mapForEach(obj, args[0], node);
        });
        case 'put': return mkBuiltinMethod((args) => {
          if (!obj.mutable) throw new AnimaRuntimeError('Cannot modify immutable map');
          obj.entries.set(valueToString(args[0]), args[1]);
          return mkUnit();
        });
        case 'remove': return mkBuiltinMethod((args) => {
          if (!obj.mutable) throw new AnimaRuntimeError('Cannot modify immutable map');
          obj.entries.delete(valueToString(args[0]));
          return mkUnit();
        });
        case 'toList': return mkBuiltinMethod(() => this.mapEntriesToList(obj));
        case 'keys': return mkList(
          Array.from(obj.entries.keys()).map(k => mkString(k)),
        );
        case 'values': return mkList(Array.from(obj.entries.values()));
        default: {
          // Treat as key access
          const v = obj.entries.get(name);
          return v ?? mkNull();
        }
      }
    }

    // Int/Float members
    if (obj.kind === 'int' || obj.kind === 'float') {
      switch (name) {
        case 'toFloat': return mkBuiltinMethod(() => mkFloat(obj.value));
        case 'toInt': return mkBuiltinMethod(() => mkInt(Math.trunc(obj.value)));
        case 'toString': return mkBuiltinMethod(() => mkString(valueToString(obj)));
      }
    }

    // Entity members
    if (obj.kind === 'entity') {
      // Field access
      const fieldValue = obj.fields.get(name);
      if (fieldValue !== undefined) {
        return fieldValue;
      }

      switch (name) {
        case 'toString': return mkBuiltinMethod(() => mkString(valueToString(obj)));
        case 'copy': return mkBuiltinMethod((_args, namedArgs) => {
          const newFields = new Map(obj.fields);
          if (namedArgs) {
            for (const [k, v] of namedArgs) {
              if (!newFields.has(k)) {
                throw new AnimaRuntimeError(`Unknown field '${k}' in ${obj.typeName}.copy()`);
              }
              newFields.set(k, v);
            }
          }
          return mkEntity(obj.typeName, newFields, [...obj.fieldOrder]);
        });
      }

      throw new AnimaRuntimeError(
        `No member '${name}' on ${obj.typeName}`,
        node.startPosition.row + 1,
        node.startPosition.column,
      );
    }

    throw new AnimaRuntimeError(
      `No member '${name}' on ${obj.kind}`,
      node.startPosition.row + 1,
      node.startPosition.column,
    );
  }

  private evalIndexExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const objNode = requiredField(node, 'object');
    const idxNode = requiredField(node, 'index');
    const obj = this.evalNode(objNode, env);
    const idx = this.evalNode(idxNode, env);

    if (obj.kind === 'list') {
      if (idx.kind !== 'int') throw new AnimaTypeError('List index must be Int');
      if (idx.value < 0 || idx.value >= obj.elements.length) {
        return mkNull(); // Out of bounds returns null
      }
      return obj.elements[idx.value];
    }

    if (obj.kind === 'map') {
      const key = valueToString(idx);
      return obj.entries.get(key) ?? mkNull();
    }

    if (obj.kind === 'string') {
      if (idx.kind !== 'int') throw new AnimaTypeError('String index must be Int');
      if (idx.value < 0 || idx.value >= obj.value.length) {
        return mkNull();
      }
      return mkString(obj.value[idx.value]);
    }

    throw new AnimaTypeError(
      `Cannot index into ${obj.kind}`,
      node.startPosition.row + 1,
      node.startPosition.column,
    );
  }

  private evalIfExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const condNode = requiredField(node, 'condition');
    const consequenceNode = requiredField(node, 'consequence');
    const alternativeNode = node.childForFieldName('alternative');

    const condition = this.evalNode(condNode, env);

    if (isTruthy(condition)) {
      return this.evalBlockOrLambdaAsBlock(consequenceNode, env);
    } else if (alternativeNode) {
      return this.evalBlockOrLambdaAsBlock(alternativeNode, env);
    }

    return mkUnit();
  }

  private evalWhenExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const subjectNode = node.childForFieldName('subject');
    const subject = subjectNode ? this.evalNode(subjectNode, env) : null;

    const branches = childrenOfType(node, 'when_branch');

    for (const branch of branches) {
      const condNode = branch.childForFieldName('condition');
      const bodyNode = requiredField(branch, 'body');

      if (!condNode) {
        // This is the 'else' branch (no condition field)
        return this.evalBlockOrLambdaAsBlock(bodyNode, env);
      }

      // when_condition node
      if (condNode.type === 'when_condition') {
        // Check if it's an 'is' type check
        const isType = condNode.children.some(c => c.text === 'is');
        if (isType && subject) {
          // Type checking -- for now, just check basic types
          // Not fully implemented
          continue;
        }
        // Expression condition
        const condExpr = condNode.namedChildren[0];
        if (condExpr) {
          if (subject) {
            // Compare subject with condition value
            const condVal = this.evalNode(condExpr, env);
            if (valuesEqual(subject, condVal)) {
              return this.evalBlockOrLambdaAsBlock(bodyNode, env);
            }
          } else {
            // No subject -- condition is evaluated as boolean
            const condVal = this.evalNode(condExpr, env);
            if (isTruthy(condVal)) {
              return this.evalBlockOrLambdaAsBlock(bodyNode, env);
            }
          }
        }
      }
    }

    return mkUnit();
  }

  private evalLambdaExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const paramsNode = childOfType(node, 'lambda_parameters');
    const params: ParamDef[] = [];

    if (paramsNode) {
      for (const lp of paramsNode.namedChildren) {
        if (lp.type === 'lambda_parameter') {
          const ident = lp.namedChildren.find(c => c.type === 'identifier');
          if (ident) {
            params.push({ name: ident.text });
          }
        }
      }
    } else {
      // Implicit 'it' parameter for lambdas without explicit params
      // Only if the lambda has statements (not being used as a block)
      params.push({ name: 'it' });
    }

    // Build a synthetic body: we'll use the node itself and handle
    // lambda body evaluation specially
    return mkFunction('<lambda>', params, node, env);
  }

  private evalParenthesizedExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const inner = node.namedChildren[0];
    if (!inner) return mkUnit();
    return this.evalNode(inner, env);
  }

  private evalRangeExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const startNode = requiredField(node, 'start');
    const endNode = requiredField(node, 'end');

    const start = this.evalNode(startNode, env);
    const end = this.evalNode(endNode, env);

    if (start.kind !== 'int' || end.kind !== 'int') {
      throw new AnimaTypeError('Range endpoints must be Int');
    }

    const elements: AnimaValue[] = [];
    const step = start.value <= end.value ? 1 : -1;
    for (let i = start.value; step > 0 ? i <= end.value : i >= end.value; i += step) {
      elements.push(mkInt(i));
    }

    return mkList(elements);
  }

  private evalElvisExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const valueNode = requiredField(node, 'value');
    const fallbackNode = requiredField(node, 'fallback');

    const value = this.evalNode(valueNode, env);
    if (value.kind === 'null') {
      return this.evalNode(fallbackNode, env);
    }
    return value;
  }

  private evalTryExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const bodyNode = requiredField(node, 'body');
    const catchClauses = childrenOfType(node, 'catch_clause');

    try {
      return this.evalBlock(bodyNode, env);
    } catch (e) {
      if (e instanceof ReturnSignal) throw e; // Don't catch return signals
      if (e instanceof BreakSignal) throw e;

      for (const clause of catchClauses) {
        const nameNode = requiredField(clause, 'name');
        const clauseBody = requiredField(clause, 'body');

        // For now, catch all errors (no type discrimination)
        const catchEnv = env.child();
        const errorMsg = e instanceof Error ? e.message : String(e);
        catchEnv.define(nameNode.text, mkString(errorMsg), false);

        return this.evalBlock(clauseBody, catchEnv);
      }

      // No matching catch clause -- re-throw
      throw e;
    }
  }

  private evalNonNullExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const inner = node.namedChildren[0];
    if (!inner) throw new AnimaRuntimeError('Empty non-null assertion');
    const value = this.evalNode(inner, env);
    if (value.kind === 'null') {
      throw new AnimaRuntimeError(
        'Non-null assertion failed: value is null',
        node.startPosition.row + 1,
        node.startPosition.column,
      );
    }
    return value;
  }

  private evalInExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const valueNode = requiredField(node, 'value');
    const collectionNode = requiredField(node, 'collection');

    const value = this.evalNode(valueNode, env);
    const collection = this.evalNode(collectionNode, env);

    if (collection.kind === 'list') {
      return mkBool(collection.elements.some(el => valuesEqual(el, value)));
    }
    if (collection.kind === 'map') {
      return mkBool(collection.entries.has(valueToString(value)));
    }
    if (collection.kind === 'string' && value.kind === 'string') {
      return mkBool(collection.value.includes(value.value));
    }

    throw new AnimaTypeError(`Cannot check containment in ${collection.kind}`);
  }

  private evalTypeCheck(_node: SyntaxNodeRef, env: Environment): AnimaValue {
    // Basic type check: value is Type
    const valueNode = requiredField(_node, 'value');
    const value = this.evalNode(valueNode, env);

    // For now, get the type text and do a basic check
    const typeNode = _node.childForFieldName('type');
    if (!typeNode) return mkBool(false);

    const typeName = typeNode.text;
    switch (typeName) {
      case 'Int': return mkBool(value.kind === 'int');
      case 'Float': return mkBool(value.kind === 'float');
      case 'String': return mkBool(value.kind === 'string');
      case 'Bool':
      case 'Boolean': return mkBool(value.kind === 'bool');
      case 'List': return mkBool(value.kind === 'list');
      case 'Map': return mkBool(value.kind === 'map');
      default:
        // Check entity type name
        if (value.kind === 'entity') {
          return mkBool(value.typeName === typeName);
        }
        return mkBool(false);
    }
  }

  // ==================================================================
  // Entity construction
  // ==================================================================

  private constructEntity(
    entityType: Extract<AnimaValue, { kind: 'entity_type' }>,
    args: AnimaValue[],
    namedArgs: Map<string, AnimaValue>,
    callSite: SyntaxNodeRef,
    callerEnv: Environment,
  ): AnimaValue {
    const fields = new Map<string, AnimaValue>();
    const fieldOrder: string[] = [];

    for (let i = 0; i < entityType.fieldDefs.length; i++) {
      const def = entityType.fieldDefs[i];
      fieldOrder.push(def.name);

      const namedValue = namedArgs.get(def.name);
      if (namedValue !== undefined) {
        fields.set(def.name, namedValue);
      } else if (i < args.length) {
        fields.set(def.name, args[i]);
      } else if (def.defaultValue) {
        fields.set(def.name, this.evalNode(def.defaultValue, callerEnv));
      } else {
        throw new AnimaRuntimeError(
          `Missing field '${def.name}' in ${entityType.typeName} constructor`,
          callSite.startPosition.row + 1,
          callSite.startPosition.column,
        );
      }
    }

    // Check invariants
    if (entityType.invariants.length > 0) {
      const invEnv = entityType.closure.child();
      // Bind fields as variables so invariants can reference them
      for (const [name, value] of fields) {
        invEnv.define(name, value, false);
      }
      // Also bind 'this' for member-style access
      const entity = mkEntity(entityType.typeName, fields, fieldOrder);
      invEnv.defineOrUpdate('this', entity, false);

      for (const invariant of entityType.invariants) {
        const result = this.evalBlock(invariant, invEnv);
        if (result.kind === 'bool' && !result.value) {
          throw new AnimaRuntimeError(
            `Invariant violation in ${entityType.typeName}`,
            invariant.startPosition.row + 1,
            invariant.startPosition.column,
          );
        }
      }
    }

    return mkEntity(entityType.typeName, fields, fieldOrder);
  }

  // ==================================================================
  // Stubs for unimplemented features
  // ==================================================================

  private evalStub(_node: SyntaxNodeRef): AnimaValue {
    // Silently skip AI-first constructs
    return mkUnit();
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private extractParams(paramsNode: SyntaxNodeRef): ParamDef[] {
    const params: ParamDef[] = [];
    for (const child of paramsNode.namedChildren) {
      if (child.type === 'parameter') {
        const nameNode = requiredField(child, 'name');
        const defaultNode = child.childForFieldName('default');
        params.push({
          name: nameNode.text,
          defaultValue: defaultNode ?? undefined,
        });
      }
    }
    return params;
  }

  // ---- Higher-order collection operations ----

  private listFilter(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const result: AnimaValue[] = [];
    for (const el of list.elements) {
      const keep = this.callFunction(fn, [el], new Map(), node, this.globalEnv);
      if (isTruthy(keep)) {
        result.push(el);
      }
    }
    return mkList(result);
  }

  private listMap(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const result: AnimaValue[] = [];
    for (const el of list.elements) {
      result.push(this.callFunction(fn, [el], new Map(), node, this.globalEnv));
    }
    return mkList(result);
  }

  private listForEach(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    for (const el of list.elements) {
      this.callFunction(fn, [el], new Map(), node, this.globalEnv);
    }
    return mkUnit();
  }

  private listSortedBy(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const sorted = [...list.elements];
    sorted.sort((left, right) => {
      const leftKey = this.callFunction(fn, [left], new Map(), node, this.globalEnv);
      const rightKey = this.callFunction(fn, [right], new Map(), node, this.globalEnv);
      return this.compareValues(leftKey, rightKey);
    });
    return mkList(sorted);
  }

  private listFlatMap(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const result: AnimaValue[] = [];
    for (const el of list.elements) {
      const mapped = this.callFunction(fn, [el], new Map(), node, this.globalEnv);
      if (mapped.kind === 'list') {
        result.push(...mapped.elements);
      } else {
        result.push(mapped);
      }
    }
    return mkList(result);
  }

  private listReduce(
    list: Extract<AnimaValue, { kind: 'list' }>,
    initial: AnimaValue,
    fn: AnimaValue,
    node: SyntaxNodeRef,
  ): AnimaValue {
    let acc = initial;
    for (const el of list.elements) {
      acc = this.callFunction(fn, [acc, el], new Map(), node, this.globalEnv);
    }
    return acc;
  }

  private listAny(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    for (const el of list.elements) {
      if (isTruthy(this.callFunction(fn, [el], new Map(), node, this.globalEnv))) {
        return mkBool(true);
      }
    }
    return mkBool(false);
  }

  private listAll(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    for (const el of list.elements) {
      if (!isTruthy(this.callFunction(fn, [el], new Map(), node, this.globalEnv))) {
        return mkBool(false);
      }
    }
    return mkBool(true);
  }

  private listNone(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    for (const el of list.elements) {
      if (isTruthy(this.callFunction(fn, [el], new Map(), node, this.globalEnv))) {
        return mkBool(false);
      }
    }
    return mkBool(true);
  }

  private listFind(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    for (const el of list.elements) {
      if (isTruthy(this.callFunction(fn, [el], new Map(), node, this.globalEnv))) {
        return el;
      }
    }
    return mkNull();
  }

  private listCountBy(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    let count = 0;
    for (const el of list.elements) {
      if (isTruthy(this.callFunction(fn, [el], new Map(), node, this.globalEnv))) {
        count++;
      }
    }
    return mkInt(count);
  }

  private listSumOf(list: Extract<AnimaValue, { kind: 'list' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    let sum = 0;
    let hasFloat = false;
    for (const el of list.elements) {
      const extracted = this.callFunction(fn, [el], new Map(), node, this.globalEnv);
      sum += asNumber(extracted);
      if (extracted.kind === 'float') {
        hasFloat = true;
      }
    }
    return hasFloat ? mkFloat(sum) : mkInt(sum);
  }

  private mapFilter(map: Extract<AnimaValue, { kind: 'map' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const result = new Map<string, AnimaValue>();
    for (const [key, value] of map.entries) {
      const keep = this.callFunction(fn, [mkString(key), value], new Map(), node, this.globalEnv);
      if (isTruthy(keep)) {
        result.set(key, value);
      }
    }
    return mkMap(result);
  }

  private mapMapValues(map: Extract<AnimaValue, { kind: 'map' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const result = new Map<string, AnimaValue>();
    for (const [key, value] of map.entries) {
      result.set(
        key,
        this.callFunction(fn, [mkString(key), value], new Map(), node, this.globalEnv),
      );
    }
    return mkMap(result);
  }

  private mapForEach(map: Extract<AnimaValue, { kind: 'map' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    for (const [key, value] of map.entries) {
      this.callFunction(fn, [mkString(key), value], new Map(), node, this.globalEnv);
    }
    return mkUnit();
  }

  private mapEntriesToList(map: Extract<AnimaValue, { kind: 'map' }>): AnimaValue {
    return mkList(
      Array.from(map.entries.entries()).map(([key, value]) => mkList([mkString(key), value])),
    );
  }
}

// Helper to create a builtin method value
function mkBuiltinMethod(fn: (args: AnimaValue[], namedArgs?: Map<string, AnimaValue>) => AnimaValue): AnimaValue {
  return { kind: 'builtin', name: '<method>', fn };
}
