/**
 * AST type checker for the Anima language.
 *
 * Walks a tree-sitter AST in two passes:
 *   1. Declaration collection — register all top-level names and their types
 *   2. Statement/expression checking — validate types and accumulate diagnostics
 *
 * Sound but not complete: unsupported constructs are silently skipped
 * (the checker returns `unknown` rather than producing false positives).
 */

import {
  AnimaType,
  FieldType,
  ParamType,
  mkIntType,
  mkFloatType,
  mkStringType,
  mkBoolType,
  mkNullType,
  mkUnitType,
  mkAnyType,
  mkUnknownType,
  mkFunctionType,
  mkEntityType,
  mkSealedType,
  mkConfidentType,
  mkNullableType,
  mkListType,
  typeToString,
} from './types';
import { TypeEnvironment } from './type-env';
import { isSubtype } from './subtyping';
import { Diagnostic, Severity } from './diagnostics';
import { inferType, SyntaxNodeRef } from './infer';

// Re-export SyntaxNodeRef so consumers only need to import from checker
export { SyntaxNodeRef };

/** Identifiers that are keywords or built-in names — never flag as undefined. */
const SKIP_IDENTIFIERS = new Set([
  'true', 'false', 'null', 'this', 'self', 'it', 'result', 'else',
  'return', 'break', 'continue', 'throw',
  'invariant', 'ensure', 'prefer', 'avoid', 'assume', 'hint',
  'fun', 'val', 'var', 'if', 'when', 'for', 'while', 'do',
  'import', 'module', 'from', 'as',
  'data', 'entity', 'sealed', 'class', 'object', 'interface',
  'agent', 'intent', 'fuzzy', 'evolve', 'feature', 'context', 'resource',
  'can', 'cannot', 'tools', 'boundaries', 'factors',
  'is', 'in', 'to', 'per', 'not', 'and', 'or',
  'try', 'catch', 'finally',
  'delegate', 'spawn', 'recall', 'ask', 'diagnose', 'emit',
  'adapt', 'fallback',
  'output', // implicit name in intent functions
]);

// ---------------------------------------------------------------------------
// TypeChecker
// ---------------------------------------------------------------------------

export class TypeChecker {
  private diagnostics: Diagnostic[] = [];
  private env: TypeEnvironment;

  constructor() {
    this.env = new TypeEnvironment();
    this.seedBuiltins();
  }

  /**
   * Run the type checker on a parsed AST root node.
   * Returns accumulated diagnostics.
   */
  check(rootNode: SyntaxNodeRef): Diagnostic[] {
    this.diagnostics = [];
    // Pass 1: collect declarations
    this.collectDeclarations(rootNode, this.env);
    // Pass 2: check bodies
    this.checkNode(rootNode, this.env);
    return this.diagnostics;
  }

  /**
   * Get the current diagnostics (useful for testing).
   */
  getDiagnostics(): Diagnostic[] {
    return this.diagnostics;
  }

  // =========================================================================
  // Built-in seed
  // =========================================================================

  private seedBuiltins(): void {
    // Register common built-in functions
    this.env.define('println', mkFunctionType(
      [{ name: 'value', type: mkAnyType(), hasDefault: false }],
      mkUnitType(),
    ));
    this.env.define('print', mkFunctionType(
      [{ name: 'value', type: mkAnyType(), hasDefault: false }],
      mkUnitType(),
    ));
    this.env.define('readLine', mkFunctionType([], mkStringType()));
    this.env.define('toString', mkFunctionType(
      [{ name: 'value', type: mkAnyType(), hasDefault: false }],
      mkStringType(),
    ));
    this.env.define('listOf', mkFunctionType(
      [{ name: 'elements', type: mkAnyType(), hasDefault: true }],
      mkListType(mkAnyType()),
    ));
    this.env.define('mutableListOf', mkFunctionType(
      [{ name: 'elements', type: mkAnyType(), hasDefault: true }],
      mkListType(mkAnyType(), true),
    ));
    this.env.define('mapOf', mkFunctionType(
      [{ name: 'entries', type: mkAnyType(), hasDefault: true }],
      mkAnyType(),
    ));
    this.env.define('mutableMapOf', mkFunctionType(
      [{ name: 'entries', type: mkAnyType(), hasDefault: true }],
      mkAnyType(),
    ));
    this.env.define('emptyList', mkFunctionType([], mkListType(mkAnyType())));
    this.env.define('emptyMap', mkFunctionType([], mkAnyType()));
    this.env.define('require', mkFunctionType(
      [{ name: 'condition', type: mkBoolType(), hasDefault: false }],
      mkUnitType(),
    ));

    // Register well-known type names
    this.env.defineTypeAlias('Int', mkIntType());
    this.env.defineTypeAlias('Float', mkFloatType());
    this.env.defineTypeAlias('String', mkStringType());
    this.env.defineTypeAlias('Bool', mkBoolType());
    this.env.defineTypeAlias('Unit', mkUnitType());
    this.env.defineTypeAlias('Any', mkAnyType());
    this.env.defineTypeAlias('Null', mkNullType());
  }

  // =========================================================================
  // Pass 1 — Declaration collection
  // =========================================================================

  private collectDeclarations(node: SyntaxNodeRef, env: TypeEnvironment): void {
    for (const child of node.namedChildren) {
      switch (child.type) {
        case 'function_declaration':
          this.collectFunction(child, env);
          break;
        case 'val_declaration':
          this.collectValDeclaration(child, env);
          break;
        case 'var_declaration':
          this.collectVarDeclaration(child, env);
          break;
        case 'entity_declaration':
          this.collectEntityDeclaration(child, env);
          break;
        case 'sealed_declaration':
          this.collectSealedDeclaration(child, env);
          break;
        case 'interface_declaration':
          this.collectInterfaceDeclaration(child, env);
          break;
        case 'type_alias':
          this.collectTypeAlias(child, env);
          break;
        case 'intent_declaration':
          this.collectIntentDeclaration(child, env);
          break;
        case 'fuzzy_declaration':
          this.collectFuzzyDeclaration(child, env);
          break;
        case 'agent_declaration':
          this.collectAgentDeclaration(child, env);
          break;
        // Other declarations — register name if available
        case 'feature_declaration':
        case 'context_declaration':
        case 'resource_declaration':
        case 'protocol_declaration':
        case 'diagnosable_declaration':
        case 'evolving_declaration':
          this.collectGenericDeclaration(child, env);
          break;
        default:
          // Not a declaration — skip in pass 1
          break;
      }
    }
  }

  private collectFunction(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;

    // Skip extension functions for now (receiver type handling)
    const receiverNode = node.childForFieldName('receiver');
    if (receiverNode) return;

    const params = this.extractParamTypes(node);
    const returnType = this.resolveReturnTypeAnnotation(node, env);

    env.define(name, mkFunctionType(params, returnType));
  }

  private collectValDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const patternNode = node.childForFieldName('pattern');
    if (!patternNode) return;

    if (patternNode.type === 'identifier') {
      const name = patternNode.text;
      // Try explicit type annotation first
      const annotationType = this.resolveTypeAnnotation(node, env);
      if (annotationType.tag !== 'unknown') {
        env.define(name, annotationType);
        return;
      }
      // Fall back to inferring from the value
      const valueNode = node.childForFieldName('value');
      if (valueNode) {
        env.define(name, inferType(valueNode, env));
      } else {
        env.define(name, mkUnknownType());
      }
    }
    // Destructuring patterns — each identifier gets unknown type for now
    if (patternNode.type === 'destructuring_pattern') {
      for (const child of patternNode.namedChildren) {
        if (child.type === 'identifier') {
          env.define(child.text, mkUnknownType());
        }
      }
    }
  }

  private collectVarDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const annotationType = this.resolveTypeAnnotation(node, env);
    if (annotationType.tag !== 'unknown') {
      env.define(nameNode.text, annotationType);
      return;
    }

    const valueNode = node.childForFieldName('value');
    if (valueNode) {
      env.define(nameNode.text, inferType(valueNode, env));
    } else {
      env.define(nameNode.text, mkUnknownType());
    }
  }

  private collectEntityDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;

    const fields: FieldType[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'field_parameter') {
        const fieldNameNode = child.childForFieldName('name');
        if (!fieldNameNode) continue;
        const fieldType = this.resolveTypeAnnotation(child, env);
        const isVar = child.children.some(c => c.text === 'var');
        const hasDefault = child.childForFieldName('default') !== null;
        fields.push({
          name: fieldNameNode.text,
          type: fieldType.tag !== 'unknown' ? fieldType : mkAnyType(),
          mutable: isVar,
          hasDefault,
        });
      }
    }

    const entityType = mkEntityType(name, fields);
    env.define(name, entityType);
    env.defineTypeAlias(name, entityType);
  }

  private collectSealedDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const sealedName = nameNode.text;

    const variantNames: string[] = [];

    for (const child of node.namedChildren) {
      if (child.type === 'sealed_member') {
        const dataClass = child.namedChildren.find(c => c.type === 'sealed_data_class');
        const objectDecl = child.namedChildren.find(c => c.type === 'sealed_object');

        if (dataClass) {
          const variantNameNode = dataClass.childForFieldName('name');
          if (variantNameNode) {
            const variantName = variantNameNode.text;
            variantNames.push(variantName);

            // Extract fields
            const fields: FieldType[] = [];
            for (const fc of dataClass.namedChildren) {
              if (fc.type === 'field_parameter') {
                const fn = fc.childForFieldName('name');
                if (!fn) continue;
                const ft = this.resolveTypeAnnotation(fc, env);
                const isVar = fc.children.some(c => c.text === 'var');
                fields.push({
                  name: fn.text,
                  type: ft.tag !== 'unknown' ? ft : mkAnyType(),
                  mutable: isVar,
                  hasDefault: fc.childForFieldName('default') !== null,
                });
              }
            }

            const variantType = mkEntityType(variantName, fields, sealedName);
            env.define(variantName, variantType);
            env.defineTypeAlias(variantName, variantType);
          }
        } else if (objectDecl) {
          const objNameNode = objectDecl.childForFieldName('name');
          if (objNameNode) {
            const objName = objNameNode.text;
            variantNames.push(objName);
            const variantType = mkEntityType(objName, [], sealedName);
            env.define(objName, variantType);
            env.defineTypeAlias(objName, variantType);
          }
        }
      }
    }

    const sealedType = mkSealedType(sealedName, variantNames);
    env.define(sealedName, sealedType);
    env.defineTypeAlias(sealedName, sealedType);
  }

  private collectInterfaceDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    // Register as a type alias to unknown for now — interface checking is future work
    env.defineTypeAlias(nameNode.text, mkAnyType());
  }

  private collectTypeAlias(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    const targetNode = node.childForFieldName('type');
    if (!nameNode) return;

    if (targetNode) {
      const resolved = this.resolveTypeFromNode(targetNode, env);
      env.defineTypeAlias(nameNode.text, resolved);
    } else {
      env.defineTypeAlias(nameNode.text, mkUnknownType());
    }
  }

  private collectIntentDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const params = this.extractParamTypes(node);
    const returnType = this.resolveReturnTypeAnnotation(node, env);
    env.define(nameNode.text, mkFunctionType(params, returnType));
  }

  private collectFuzzyDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const params = this.extractParamTypes(node);
    // Fuzzy functions return Confident<Bool>
    env.define(nameNode.text, mkFunctionType(params, mkConfidentType(mkBoolType())));
  }

  private collectAgentDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    // Register agent as a known name
    env.define(nameNode.text, mkAnyType());

    // Collect tools and intent functions inside the agent
    for (const child of node.namedChildren) {
      if (child.type === 'agent_body') {
        for (const bodyChild of child.namedChildren) {
          if (bodyChild.type === 'intent_declaration') {
            this.collectIntentDeclaration(bodyChild, env);
          }
          if (bodyChild.type === 'function_declaration') {
            this.collectFunction(bodyChild, env);
          }
          if (bodyChild.type === 'tools_block') {
            // Tools declare function signatures
            for (const tool of bodyChild.namedChildren) {
              if (tool.type === 'function_declaration') {
                this.collectFunction(tool, env);
              }
            }
          }
        }
      }
    }
  }

  private collectGenericDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    env.define(nameNode.text, mkAnyType());
  }

  // =========================================================================
  // Pass 2 — Checking
  // =========================================================================

  private checkNode(node: SyntaxNodeRef, env: TypeEnvironment): void {
    switch (node.type) {
      case 'source_file':
      case 'program':
        this.checkChildren(node, env);
        break;

      case 'function_declaration':
        this.checkFunctionBody(node, env);
        break;

      case 'val_declaration':
        this.checkValDeclaration(node, env);
        break;

      case 'var_declaration':
        this.checkVarDeclaration(node, env);
        break;

      case 'expression_statement':
        this.checkChildren(node, env);
        break;

      case 'assignment_statement':
        this.checkAssignment(node, env);
        break;

      case 'call_expression':
        this.checkCallExpression(node, env);
        break;

      case 'binary_expression':
        this.checkBinaryExpression(node, env);
        break;

      case 'member_expression':
        this.checkMemberExpression(node, env);
        break;

      case 'safe_member_expression':
        this.checkMemberExpression(node, env);
        break;

      case 'qualified_identifier':
        // Qualified identifiers (e.g., Shape.Circle) — check only the first segment
        this.checkQualifiedIdentifier(node, env);
        break;

      case 'identifier':
        this.checkIdentifier(node, env);
        break;

      case 'if_expression':
        this.checkIfExpression(node, env);
        break;

      case 'for_statement':
        this.checkForStatement(node, env);
        break;

      case 'while_statement':
        this.checkWhileStatement(node, env);
        break;

      case 'return_statement':
        this.checkChildren(node, env);
        break;

      case 'block':
        this.checkBlock(node, env);
        break;

      case 'type_check_expression':
        this.checkTypeCheckExpression(node, env);
        break;

      // Entity declarations — check body (invariant blocks) with fields in scope
      case 'entity_declaration':
        this.checkEntityBody(node, env);
        break;

      // String templates — check interpolated expressions but not string content
      case 'string_template':
        this.checkStringTemplate(node, env);
        break;

      // These are leaf-ish nodes inside templates — don't walk into them blindly
      case 'simple_substitution':
      case 'template_substitution':
        this.checkChildren(node, env);
        break;
      case 'string_content':
      case 'escape_sequence':
        // No checking needed for literal string content
        break;

      // Declarations already handled in pass 1 — no additional pass-2 checking needed
      case 'sealed_declaration':
      case 'interface_declaration':
      case 'type_alias':
      case 'intent_declaration':
      case 'fuzzy_declaration':
      case 'agent_declaration':
      case 'module_declaration':
      case 'import_declaration':
      case 'feature_declaration':
      case 'context_declaration':
      case 'resource_declaration':
      case 'protocol_declaration':
      case 'evolving_declaration':
      case 'diagnosable_declaration':
        // No additional checking for these in v0.1
        break;

      // Type-related nodes — skip checking (not value expressions)
      case 'primitive_type':
      case 'generic_type':
      case 'nullable_type':
      case 'function_type':
      case 'tuple_type':
      case 'type_identifier':
        break;

      // Invariant clause — skip (handled by checkEntityBody)
      case 'invariant_clause':
        break;

      default:
        // Recurse into children for other node types
        this.checkChildren(node, env);
        break;
    }
  }

  private checkChildren(node: SyntaxNodeRef, env: TypeEnvironment): void {
    for (const child of node.namedChildren) {
      this.checkNode(child, env);
    }
  }

  private checkBlock(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const blockEnv = env.child();
    // Collect any declarations inside the block first
    this.collectDeclarations(node, blockEnv);
    for (const child of node.namedChildren) {
      this.checkNode(child, blockEnv);
    }
  }

  private checkFunctionBody(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return;

    // Create a child scope with parameters bound
    const fnEnv = env.child();
    const paramsNode = node.childForFieldName('parameters');
    if (paramsNode) {
      for (const child of paramsNode.namedChildren) {
        if (child.type === 'parameter') {
          const pName = child.childForFieldName('name');
          if (pName) {
            const pType = this.resolveTypeAnnotation(child, env);
            fnEnv.define(pName.text, pType.tag !== 'unknown' ? pType : mkAnyType());
          }
        }
      }
    }

    // Collect declarations in the body, then check
    this.collectDeclarations(bodyNode, fnEnv);
    this.checkNode(bodyNode, fnEnv);
  }

  private checkValDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const valueNode = node.childForFieldName('value');
    if (valueNode) {
      this.checkNode(valueNode, env);
    }
  }

  private checkVarDeclaration(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const valueNode = node.childForFieldName('value');
    if (valueNode) {
      this.checkNode(valueNode, env);
    }
  }

  private checkAssignment(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const targetNode = node.childForFieldName('target');
    const valueNode = node.childForFieldName('value');
    if (valueNode) {
      this.checkNode(valueNode, env);
    }
    if (targetNode) {
      this.checkNode(targetNode, env);
    }
  }

  private checkIdentifier(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const name = node.text;
    // Skip keywords, built-in values, and special names
    if (SKIP_IDENTIFIERS.has(name)) {
      return;
    }
    const type = env.lookup(name);
    if (!type) {
      const resolved = env.resolveType(name);
      if (!resolved) {
        this.report('error', `Undefined variable '${name}'`, node);
      }
    }
  }

  private checkQualifiedIdentifier(node: SyntaxNodeRef, env: TypeEnvironment): void {
    // For qualified identifiers like Shape.Circle, only check the root segment
    const parts = node.text.split('.');
    if (parts.length > 0) {
      const root = parts[0];
      if (!SKIP_IDENTIFIERS.has(root) && !env.lookup(root) && !env.resolveType(root)) {
        this.report('error', `Undefined variable '${root}'`, node);
      }
    }
  }

  private checkEntityBody(node: SyntaxNodeRef, env: TypeEnvironment): void {
    // Entity declarations have an optional body with invariant clauses.
    // Invariant blocks reference entity fields, so we create a scope with fields bound.
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return;

    const entityEnv = env.child();
    // Bind entity fields into scope
    for (const child of node.namedChildren) {
      if (child.type === 'field_parameter') {
        const fieldNameNode = child.childForFieldName('name');
        if (fieldNameNode) {
          const fieldType = this.resolveTypeAnnotation(child, env);
          entityEnv.define(fieldNameNode.text, fieldType.tag !== 'unknown' ? fieldType : mkAnyType());
        }
      }
    }

    // Check invariant blocks
    for (const child of bodyNode.namedChildren) {
      if (child.type === 'invariant_clause') {
        for (const inner of child.namedChildren) {
          this.checkNode(inner, entityEnv);
        }
      }
    }
  }

  private checkStringTemplate(node: SyntaxNodeRef, env: TypeEnvironment): void {
    // Walk only template_substitution and simple_substitution children,
    // not string_content or escape_sequence nodes.
    for (const child of node.namedChildren) {
      if (child.type === 'template_substitution') {
        // ${expression} — check the expression inside
        for (const inner of child.namedChildren) {
          this.checkNode(inner, env);
        }
      } else if (child.type === 'simple_substitution') {
        // $identifier — check that the identifier exists
        for (const inner of child.namedChildren) {
          if (inner.type === 'identifier') {
            this.checkIdentifier(inner, env);
          }
        }
      }
      // Skip string_content and escape_sequence
    }
  }

  private checkCallExpression(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    // Extract argument nodes: all named children except the function node and trailing_lambda
    const argNodes = getCallArguments(node, funcNode);

    // Don't report "undefined" for method calls on objects — member checking handles that
    if (funcNode.type === 'member_expression' || funcNode.type === 'safe_member_expression') {
      this.checkNode(funcNode, env);
      // Check arguments recursively
      for (const arg of argNodes) this.checkNode(arg, env);
      return;
    }

    const funcType = inferType(funcNode, env);

    // For identifier calls, also validate the name exists
    if (funcNode.type === 'identifier') {
      const name = funcNode.text;
      // Skip keyword-like names that may appear as call targets
      if (SKIP_IDENTIFIERS.has(name)) {
        // Still check arg nodes
        for (const arg of argNodes) this.checkNode(arg, env);
        return;
      }
      if (!env.lookup(name) && !env.resolveType(name)) {
        this.report('error', `Undefined function '${name}'`, funcNode);
        // Still check arg nodes for errors
        for (const arg of argNodes) this.checkNode(arg, env);
        return;
      }
    }

    const argCount = argNodes.length;

    // Check argument count
    if (funcType.tag === 'function') {
      const requiredCount = funcType.params.filter(p => !p.hasDefault).length;
      const maxCount = funcType.params.length;

      if (argCount < requiredCount) {
        this.report(
          'error',
          `Function '${funcNode.text}' expects at least ${requiredCount} argument(s) but got ${argCount}`,
          node,
        );
      } else if (argCount > maxCount && maxCount > 0 && requiredCount > 0) {
        // Only warn if we have required params — all-default params suggest variadic behavior
        this.report(
          'warning',
          `Function '${funcNode.text}' expects at most ${maxCount} argument(s) but got ${argCount}`,
          node,
        );
      }

      // Check individual argument types
      for (let i = 0; i < Math.min(argNodes.length, funcType.params.length); i++) {
        const argExpr = getArgumentExpression(argNodes[i]);
        const argType = inferType(argExpr, env);
        const paramType = funcType.params[i].type;

        if (argType.tag !== 'unknown' && paramType.tag !== 'any' && paramType.tag !== 'unknown') {
          if (!isSubtype(argType, paramType)) {
            this.report(
              'warning',
              `Argument ${i + 1}: expected ${typeToString(paramType)} but got ${typeToString(argType)}`,
              argNodes[i],
            );
          }
        }
      }
    } else if (funcType.tag === 'entity') {
      // Entity constructor call — check field count
      const requiredFields = funcType.fields.filter(f => !f.hasDefault).length;

      if (argCount < requiredFields) {
        this.report(
          'error',
          `Constructor '${funcType.name}' requires at least ${requiredFields} argument(s) but got ${argCount}`,
          node,
        );
      }
    }

    // Check arguments recursively
    for (const arg of argNodes) this.checkNode(arg, env);
  }

  private checkBinaryExpression(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');
    if (!leftNode || !rightNode) return;

    // Recurse into operands
    this.checkNode(leftNode, env);
    this.checkNode(rightNode, env);

    const leftType = inferType(leftNode, env);
    const rightType = inferType(rightNode, env);

    // Skip if either side is unknown
    if (leftType.tag === 'unknown' || rightType.tag === 'unknown') return;

    const op = this.getOperator(node);

    // Arithmetic operators require numeric or string types
    if (['+', '-', '*', '/', '%'].includes(op)) {
      if (op === '+') {
        // + allows string concatenation
        if (leftType.tag === 'string' || rightType.tag === 'string') return;
      }
      if (!isNumericType(leftType) || !isNumericType(rightType)) {
        this.report(
          'warning',
          `Operator '${op}' applied to incompatible types: ${typeToString(leftType)} and ${typeToString(rightType)}`,
          node,
        );
      }
    }

    // Comparison operators: values should be comparable
    if (['<', '>', '<=', '>='].includes(op)) {
      if (!isNumericType(leftType) && !isStringLike(leftType)) {
        this.report(
          'warning',
          `Comparison '${op}' may not be valid for types: ${typeToString(leftType)} and ${typeToString(rightType)}`,
          node,
        );
      }
    }

    // Logical operators require boolean
    if (['&&', '||'].includes(op)) {
      if (leftType.tag !== 'bool') {
        this.report('warning', `Left operand of '${op}' should be Bool, got ${typeToString(leftType)}`, leftNode);
      }
      if (rightType.tag !== 'bool') {
        this.report('warning', `Right operand of '${op}' should be Bool, got ${typeToString(rightType)}`, rightNode);
      }
    }
  }

  private checkMemberExpression(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const objNode = node.childForFieldName('object');
    const memberNode = node.childForFieldName('member');
    if (!objNode || !memberNode) return;

    this.checkNode(objNode, env);

    const objType = inferType(objNode, env);
    const memberName = memberNode.text;

    // Only check member access on known entity types
    if (objType.tag === 'entity') {
      const field = objType.fields.find(f => f.name === memberName);
      if (!field) {
        this.report(
          'error',
          `Property '${memberName}' does not exist on type '${objType.name}'`,
          memberNode,
        );
      }
    }
  }

  private checkIfExpression(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const condNode = node.childForFieldName('condition');
    if (condNode) {
      this.checkNode(condNode, env);
      const condType = inferType(condNode, env);
      if (condType.tag !== 'unknown' && condType.tag !== 'bool' && condType.tag !== 'any') {
        this.report('warning', `Condition should be Bool, got ${typeToString(condType)}`, condNode);
      }
    }
    const consequenceNode = node.childForFieldName('consequence');
    if (consequenceNode) this.checkNode(consequenceNode, env);
    const alternativeNode = node.childForFieldName('alternative');
    if (alternativeNode) this.checkNode(alternativeNode, env);
  }

  private checkForStatement(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const varNode = node.childForFieldName('variable');
    const iterableNode = node.childForFieldName('iterable');
    const bodyNode = node.childForFieldName('body');

    if (iterableNode) this.checkNode(iterableNode, env);

    // Create loop scope with the loop variable
    const loopEnv = env.child();
    if (varNode && iterableNode) {
      const iterType = inferType(iterableNode, env);
      if (iterType.tag === 'list') {
        loopEnv.define(varNode.text, iterType.element);
      } else if (iterType.tag === 'map') {
        loopEnv.define(varNode.text, mkAnyType()); // Map iteration yields entries
      } else {
        loopEnv.define(varNode.text, mkAnyType());
      }
    }

    if (bodyNode) {
      this.collectDeclarations(bodyNode, loopEnv);
      this.checkNode(bodyNode, loopEnv);
    }
  }

  private checkWhileStatement(node: SyntaxNodeRef, env: TypeEnvironment): void {
    const condNode = node.childForFieldName('condition');
    if (condNode) {
      this.checkNode(condNode, env);
    }
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) this.checkNode(bodyNode, env);
  }

  private checkTypeCheckExpression(node: SyntaxNodeRef, env: TypeEnvironment): void {
    // `expr is TypeName` — validate that TypeName exists
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      const typeName = typeNode.text;
      // Split on '.' for qualified names like TriageLevel.Emergent
      const parts = typeName.split('.');
      const baseName = parts[0];
      if (!env.resolveType(baseName) && !env.lookup(baseName)) {
        this.report('error', `Unknown type '${typeName}' in type check`, typeNode);
      }
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private extractParamTypes(funcNode: SyntaxNodeRef): ParamType[] {
    const paramsNode = funcNode.childForFieldName('parameters');
    if (!paramsNode) return [];

    const params: ParamType[] = [];
    for (const child of paramsNode.namedChildren) {
      if (child.type === 'parameter') {
        const pName = child.childForFieldName('name');
        const hasDefault = child.childForFieldName('default') !== null;
        const pType = this.resolveTypeAnnotation(child, this.env);
        params.push({
          name: pName?.text ?? '_',
          type: pType.tag !== 'unknown' ? pType : mkAnyType(),
          hasDefault,
        });
      }
    }
    return params;
  }

  /**
   * Try to extract a type annotation from a node that has a 'type' field.
   */
  private resolveTypeAnnotation(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
    const typeNode = node.childForFieldName('type');
    if (!typeNode) return mkUnknownType();
    return this.resolveTypeFromNode(typeNode, env);
  }

  /**
   * Try to extract a return type annotation from a function declaration.
   */
  private resolveReturnTypeAnnotation(node: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
    const returnTypeNode = node.childForFieldName('return_type');
    if (returnTypeNode) {
      return this.resolveTypeFromNode(returnTypeNode, env);
    }
    // Fallback: try 'type' field
    return this.resolveTypeAnnotation(node, env);
  }

  /**
   * Resolve a type expression node to an AnimaType.
   */
  private resolveTypeFromNode(typeNode: SyntaxNodeRef, env: TypeEnvironment): AnimaType {
    const text = typeNode.text.trim();

    // Check for nullable suffix
    if (text.endsWith('?')) {
      const inner = this.resolveTypeText(text.slice(0, -1), env);
      return mkNullableType(inner);
    }

    // Check for confidence annotation: T @ Confidence
    if (text.includes('@') && text.includes('Confidence')) {
      const baseName = text.split('@')[0].trim();
      const inner = this.resolveTypeText(baseName, env);
      return mkConfidentType(inner);
    }

    return this.resolveTypeText(text, env);
  }

  /**
   * Resolve a type name string to an AnimaType.
   */
  private resolveTypeText(text: string, env: TypeEnvironment): AnimaType {
    // Well-known primitives
    const wellKnown: Record<string, AnimaType> = {
      Int: mkIntType(),
      Float: mkFloatType(),
      String: mkStringType(),
      Bool: mkBoolType(),
      Boolean: mkBoolType(),
      Unit: mkUnitType(),
      Null: mkNullType(),
      Any: mkAnyType(),
      NL: mkStringType(), // NL is treated as a string-like type
      ID: mkStringType(), // ID is a string alias
      DateTime: mkStringType(), // DateTime placeholder
    };

    if (wellKnown[text]) return wellKnown[text];

    // Check for generic types like List<T>, Map<K, V>
    const genericMatch = text.match(/^(\w+)<(.+)>$/);
    if (genericMatch) {
      const baseName = genericMatch[1];
      if (baseName === 'List') {
        return mkListType(mkAnyType());
      }
      if (baseName === 'MutableList') {
        return mkListType(mkAnyType(), true);
      }
      // Map, Set, etc. — just return Any for now
      return mkAnyType();
    }

    // Check environment
    const resolved = env.resolveType(text);
    if (resolved) return resolved;

    // Check value-level (could be an entity name used as type)
    const valueLookup = env.lookup(text);
    if (valueLookup) return valueLookup;

    return mkUnknownType();
  }

  private getOperator(node: SyntaxNodeRef): string {
    const opNode = node.childForFieldName('operator');
    if (opNode) return opNode.text;
    for (const child of node.children) {
      const text = child.text;
      if (['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!=', '&&', '||', 'to', 'per'].includes(text)) {
        return text;
      }
    }
    return '';
  }

  private report(severity: Severity, message: string, node: SyntaxNodeRef): void {
    this.diagnostics.push({
      severity,
      message,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function isNumericType(t: AnimaType): boolean {
  return t.tag === 'int' || t.tag === 'float';
}

function isStringLike(t: AnimaType): boolean {
  return t.tag === 'string';
}

/**
 * Extract argument nodes from a call_expression.
 *
 * In the tree-sitter grammar, call_expression children are:
 *   function_node  "("  arg1  ","  arg2  ...  ")"  [trailing_lambda]
 *
 * Named children include the function node and all argument expressions.
 * We filter out the function node and trailing_lambda to get just arguments.
 */
function getCallArguments(callNode: SyntaxNodeRef, funcNode: SyntaxNodeRef): SyntaxNodeRef[] {
  const args: SyntaxNodeRef[] = [];
  const trailingLambda = callNode.childForFieldName('trailing_lambda');
  for (const child of callNode.namedChildren) {
    // Skip the function node, trailing lambda, and comments
    if (child === funcNode) continue;
    if (trailingLambda && child === trailingLambda) continue;
    if (child.type === 'line_comment' || child.type === 'block_comment') continue;
    args.push(child);
  }
  return args;
}

/**
 * Get the expression value from an argument node.
 * For named_argument nodes, returns the value field.
 * For plain expressions, returns the node itself.
 */
function getArgumentExpression(argNode: SyntaxNodeRef): SyntaxNodeRef {
  if (argNode.type === 'named_argument') {
    const valueNode = argNode.childForFieldName('value');
    if (valueNode) return valueNode;
  }
  return argNode;
}
