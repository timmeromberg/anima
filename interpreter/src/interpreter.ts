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
  mkBuiltin,
  mkConfident,
  mkAgent,
  mkAgentType,
  getConfidence,
  unwrapConfident,
  isTruthy,
  valueToString,
  valuesEqual,
  asNumber,
  AgentBoundaries,
} from './values';
import {
  AnimaRuntimeError,
  AnimaTypeError,
  AnimaNameError,
  ReturnSignal,
  BreakSignal,
  ContinueSignal,
} from './errors';
import { registerBuiltins } from './builtins';
import { requiredField, childrenOfType, childOfType } from './ast';
import { nlSemanticEquals, nlSemanticImplies, nlExtractEntities } from './nl';
import { getMemoryStore, registerMemoryBuiltins } from './memory';
import { registerEvolutionBuiltins } from './evolution';
import { registerNLBuiltins } from './nl';

export class Interpreter {
  private globalEnv: Environment;
  /** Extension functions keyed by "TypeName.methodName" */
  private extensionFunctions = new Map<string, AnimaValue>();
  /** Directory of the currently executing file (for resolving imports) */
  private currentDir: string | null = null;
  /** Cache of already-imported module environments by resolved path */
  private moduleCache = new Map<string, Environment>();

  constructor() {
    this.globalEnv = new Environment();
    registerBuiltins(this.globalEnv);
    registerMemoryBuiltins(this.globalEnv);
    registerEvolutionBuiltins(this.globalEnv);
    registerNLBuiltins(this.globalEnv);
  }

  /**
   * Execute a full program from the root node of a parsed AST.
   * If a `main()` function is defined, it is called automatically.
   * @param filePath Optional path to the source file (enables import resolution)
   */
  run(rootNode: SyntaxNodeRef, filePath?: string): AnimaValue {
    if (filePath) {
      const path = require('path');
      this.currentDir = path.dirname(path.resolve(filePath));
    }
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
        return mkUnit(); // Module namespacing is a type-system concern
      case 'import_declaration':
        return this.evalImportDeclaration(node, env);
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

      // ---- Sealed classes and interfaces ----
      case 'sealed_declaration':
        return this.evalSealedDeclaration(node, env);
      case 'interface_declaration':
        return this.evalInterfaceDeclaration(node, env);
      case 'type_alias':
        return mkUnit(); // Type aliases are only relevant for type checking

      // ---- AI-first constructs ----
      case 'intent_declaration':
        return this.evalIntentDeclaration(node, env);
      case 'fuzzy_declaration':
        return this.evalFuzzyDeclaration(node, env);
      case 'agent_declaration':
        return this.evalAgentDeclaration(node, env);
      case 'evolving_declaration':
        return this.evalEvolvingDeclaration(node, env);
      case 'context_declaration':
        return this.evalContextDeclaration(node, env);
      case 'protocol_declaration':
        return this.evalProtocolDeclaration(node, env);
      case 'feature_declaration':
        return this.evalFeatureDeclaration(node, env);
      case 'resource_declaration':
        return this.evalResourceDeclaration(node, env);
      case 'diagnosable_declaration':
        return this.evalDiagnosableDeclaration(node, env);

      // ---- AI-first expression stubs ----
      case 'confidence_expression_val':
        return this.evalConfidenceExpression(node, env);
      case 'spawn_expression':
        return this.evalSpawnExpression(node, env);
      case 'delegate_expression':
        return this.evalDelegateExpression(node, env);
      case 'parallel_expression':
        return this.evalParallelExpression(node, env);
      case 'emit_expression':
        return this.evalEmitExpression(node, env);
      case 'semantic_expression':
        return this.evalSemanticExpression(node, env);
      case 'recall_expression':
        return this.evalRecallExpression(node, env);
      case 'ask_expression':
        // In v0.1, ask() returns the prompt string (non-interactive)
        return this.evalAskExpression(node, env);
      case 'diagnose_expression':
        // In v0.1, diagnose() returns null (diagnosis requires interactive runtime)
        return mkNull();

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
    const receiverNode = node.childForFieldName('receiver');

    const paramsNode = requiredField(node, 'parameters');
    const params = this.extractParams(paramsNode);

    const bodyNode = requiredField(node, 'body');

    const fn = mkFunction(name, params, bodyNode, env);
    // If body is a lambda with params, calling this function should return the lambda as a value
    if (bodyNode.type === 'lambda_expression' &&
        bodyNode.namedChildren.some(c => c.type === 'lambda_parameters')) {
      (fn as any).returnsLambda = true;
    }

    if (receiverNode) {
      // Extension function: fun String.shout() = ...
      const receiverType = receiverNode.text;
      this.extensionFunctions.set(`${receiverType}.${name}`, fn);
    } else {
      env.defineOrUpdate(name, fn, false);
    }
    return mkUnit();
  }

  private evalImportDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const path = require('path');
    const fs = require('fs');

    // Extract imported names (identifier children before 'from')
    const names: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') names.push(child.text);
    }

    // Extract the source path from the string_literal child
    const pathNode = node.namedChildren.find(c => c.type === 'string_literal');
    if (!pathNode) {
      throw new AnimaRuntimeError('import: missing source path');
    }
    // Strip quotes from string literal
    const importPath = pathNode.text.slice(1, -1);

    // Check for alias
    const aliasNode = node.childForFieldName('alias');
    const alias = aliasNode?.text;

    // Resolve the file path
    if (!this.currentDir) {
      throw new AnimaRuntimeError('import: cannot resolve imports without a file path (use --eval with a file)');
    }

    let resolvedPath: string;
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // Relative import
      resolvedPath = path.resolve(this.currentDir, importPath);
      if (!resolvedPath.endsWith('.anima')) resolvedPath += '.anima';
    } else {
      // Could be a standard library or package import — skip for now
      return mkUnit();
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new AnimaRuntimeError(`import: file not found: ${resolvedPath}`);
    }

    // Check cache
    let moduleEnv = this.moduleCache.get(resolvedPath);
    if (!moduleEnv) {
      // Parse and execute the imported file
      const { parse: parseAnima } = require('./parser');
      const source = fs.readFileSync(resolvedPath, 'utf-8');
      const result = parseAnima(source);

      if (result.hasErrors) {
        throw new AnimaRuntimeError(`import: parse errors in ${resolvedPath}`);
      }

      // Execute in a fresh environment (with builtins)
      moduleEnv = new Environment();
      registerBuiltins(moduleEnv);

      const savedDir = this.currentDir;
      this.currentDir = path.dirname(resolvedPath);
      this.evalProgram(result.rootNode, moduleEnv);
      this.currentDir = savedDir;

      this.moduleCache.set(resolvedPath, moduleEnv);
    }

    // Bind imported names into the current environment
    if (alias) {
      // import { ... } from "..." as Foo -> namespace all under alias
      const nsMap = new Map<string, AnimaValue>();
      for (const name of names) {
        try {
          nsMap.set(name, moduleEnv.get(name));
        } catch {
          throw new AnimaRuntimeError(`import: '${name}' not found in ${importPath}`);
        }
      }
      env.define(alias, mkMap(nsMap, false), false);
    } else {
      for (const name of names) {
        try {
          env.define(name, moduleEnv.get(name), false);
        } catch {
          throw new AnimaRuntimeError(`import: '${name}' not found in ${importPath}`);
        }
      }
    }

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

  private evalSealedDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const sealedName = nameNode.text;

    // Namespace map for Shape.Circle / Shape.None access
    const nsEntries = new Map<string, AnimaValue>();

    // Register each sealed variant as an entity type constructor
    for (const child of node.namedChildren) {
      if (child.type === 'sealed_member') {
        const dataClass = childOfType(child, 'sealed_data_class');
        if (dataClass) {
          const variantName = requiredField(dataClass, 'name').text;

          // Extract field definitions
          const fieldDefs: EntityFieldDef[] = [];
          for (const fc of dataClass.namedChildren) {
            if (fc.type === 'field_parameter') {
              const fieldName = requiredField(fc, 'name').text;
              const isVar = fc.children.some(c => c.text === 'var');
              fieldDefs.push({ name: fieldName, mutable: isVar });
            }
          }

          // Register variant as entity type with sealed parent info
          const variantType = mkEntityType(variantName, fieldDefs, [], env);
          // Store the sealed parent name for `is` type checking
          if (variantType.kind === 'entity_type') {
            (variantType as any).sealedParent = sealedName;
          }
          env.defineOrUpdate(variantName, variantType, false);
          nsEntries.set(variantName, variantType);
        }

        const sealedObj = childOfType(child, 'sealed_object');
        if (sealedObj) {
          const objName = requiredField(sealedObj, 'name').text;
          // Singleton object — create an entity instance with no fields
          const objValue = mkEntity(objName, new Map(), []);
          (objValue as any).sealedParent = sealedName;
          env.defineOrUpdate(objName, objValue, false);
          nsEntries.set(objName, objValue);
        }
      }
    }

    // Register the sealed class name as a namespace for qualified access
    env.defineOrUpdate(sealedName, mkMap(nsEntries), false);

    return mkUnit();
  }

  private evalInterfaceDeclaration(_node: SyntaxNodeRef, _env: Environment): AnimaValue {
    // Interfaces are type-only constructs; no runtime behavior needed yet.
    // They'll be relevant when we add the type checker (Phase 2).
    return mkUnit();
  }

  // ==================================================================
  // Intent Functions
  // ==================================================================

  private evalIntentDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;
    const paramsNode = requiredField(node, 'parameters');
    const params = this.extractParams(paramsNode);
    const bodyNode = requiredField(node, 'body'); // intent_body

    // Parse the intent body to extract clauses
    const clauses = this.parseIntentClauses(bodyNode);

    // Create a builtin that executes the intent in fallback mode
    const intentFn = mkBuiltin(name, (args: AnimaValue[]) => {
      // Bind parameters
      const intentEnv = env.child();
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        const val = i < args.length ? args[i] : (p.defaultValue ? this.evalNode(p.defaultValue, intentEnv) : mkNull());
        intentEnv.define(p.name, val, false);
      }

      // Execute fallback block if present, otherwise execute any statement clauses
      let result: AnimaValue = mkNull();
      if (clauses.fallback) {
        try {
          result = this.evalBlock(clauses.fallback, intentEnv);
        } catch (e) {
          if (e instanceof ReturnSignal) {
            result = e.value as AnimaValue;
          } else {
            throw e;
          }
        }
      } else if (clauses.statements.length > 0) {
        for (const stmt of clauses.statements) {
          try {
            result = this.evalNode(stmt, intentEnv);
          } catch (e) {
            if (e instanceof ReturnSignal) {
              result = e.value as AnimaValue;
              break;
            }
            throw e;
          }
        }
      }

      // Bind 'output' for ensure/prefer/avoid post-condition checks
      intentEnv.define('output', result, false);

      // Check ensure clauses (hard post-conditions)
      for (const ensureBlock of clauses.ensures) {
        const check = this.evalBlock(ensureBlock, intentEnv);
        if (!isTruthy(check)) {
          throw new AnimaRuntimeError(
            `Intent '${name}' ensure clause failed`,
            ensureBlock.startPosition.row + 1,
            ensureBlock.startPosition.column,
          );
        }
      }

      return result;
    });

    env.defineOrUpdate(name, intentFn, false);
    return mkUnit();
  }

  private parseIntentClauses(bodyNode: SyntaxNodeRef): {
    ensures: SyntaxNodeRef[];
    prefers: { block: SyntaxNodeRef; weight: number }[];
    avoids: { block: SyntaxNodeRef; weight: number }[];
    fallback: SyntaxNodeRef | null;
    statements: SyntaxNodeRef[];
  } {
    const ensures: SyntaxNodeRef[] = [];
    const prefers: { block: SyntaxNodeRef; weight: number }[] = [];
    const avoids: { block: SyntaxNodeRef; weight: number }[] = [];
    let fallback: SyntaxNodeRef | null = null;
    const statements: SyntaxNodeRef[] = [];

    for (const child of bodyNode.namedChildren) {
      switch (child.type) {
        case 'ensure_clause': {
          const block = child.namedChildren.find(c => c.type === 'block');
          if (block) ensures.push(block);
          break;
        }
        case 'prefer_clause': {
          const block = child.namedChildren.find(c => c.type === 'block');
          const weightNode = child.namedChildren.find(c => c.type === 'float_literal');
          if (block) prefers.push({ block, weight: weightNode ? parseFloat(weightNode.text) : 1.0 });
          break;
        }
        case 'avoid_clause': {
          const block = child.namedChildren.find(c => c.type === 'block');
          const weightNode = child.namedChildren.find(c => c.type === 'float_literal');
          if (block) avoids.push({ block, weight: weightNode ? parseFloat(weightNode.text) : 1.0 });
          break;
        }
        case 'fallback_clause': {
          const block = child.namedChildren.find(c => c.type === 'block');
          if (block) fallback = block;
          break;
        }
        case 'assume_clause':
        case 'hint_clause':
        case 'cost_clause':
        case 'adapt_clause':
          // Advisory/metadata clauses — no runtime behavior in v0.1
          break;
        default:
          // Regular statements inside intent body
          statements.push(child);
          break;
      }
    }

    return { ensures, prefers, avoids, fallback, statements };
  }

  // ==================================================================
  // Fuzzy Predicates
  // ==================================================================

  private evalFuzzyDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;
    const paramsNode = requiredField(node, 'parameters');
    const params = this.extractParams(paramsNode);
    const bodyNode = requiredField(node, 'body'); // fuzzy_body

    // Create a builtin that evaluates the fuzzy predicate
    const fuzzyFn = mkBuiltin(name, (args: AnimaValue[]) => {
      // Bind parameters
      const fuzzyEnv = env.child();
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        const val = i < args.length ? args[i] : (p.defaultValue ? this.evalNode(p.defaultValue, fuzzyEnv) : mkNull());
        fuzzyEnv.define(p.name, val, false);
      }

      // Find factors_block or metric_block
      for (const child of bodyNode.namedChildren) {
        if (child.type === 'factors_block') {
          return this.evalFactorsBlock(child, fuzzyEnv);
        }
        if (child.type === 'metric_block') {
          const block = child.namedChildren.find(c => c.type === 'block');
          if (block) {
            try {
              return this.evalBlock(block, fuzzyEnv);
            } catch (e) {
              if (e instanceof ReturnSignal) return e.value as AnimaValue;
              throw e;
            }
          }
        }
      }

      return mkConfident(mkBool(false), 0);
    });

    env.defineOrUpdate(name, fuzzyFn, false);
    return mkUnit();
  }

  private evalFactorsBlock(node: SyntaxNodeRef, env: Environment): AnimaValue {
    let totalScore = 0;
    let totalWeight = 0;

    for (const factor of node.namedChildren) {
      if (factor.type !== 'factor') continue;

      const condNode = factor.childForFieldName('condition');
      const weightNode = factor.childForFieldName('value');
      if (!condNode || !weightNode) continue;

      const weight = parseFloat(weightNode.text);
      totalWeight += weight;

      const condResult = this.evalNode(condNode, env);
      // If the condition result is itself a confident bool, use its confidence as the score
      if (condResult.kind === 'confident' && condResult.value.kind === 'bool') {
        const score = condResult.value.value ? condResult.confidence : (1 - condResult.confidence);
        totalScore += score * weight;
      } else {
        // Crisp evaluation: truthy = 1.0, falsy = 0.0
        const score = isTruthy(condResult) ? 1.0 : 0.0;
        totalScore += score * weight;
      }
    }

    // Normalize if weights don't sum to 1
    const confidence = totalWeight > 0 ? totalScore / totalWeight : 0;
    const result = confidence >= 0.5;
    return mkConfident(mkBool(result), confidence);
  }

  // ==================================================================
  // Agent Runtime
  // ==================================================================

  private evalAgentDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;

    // Register the agent type — the declaration node and closure are stored
    // so that spawn can instantiate agents later.
    const agentType = mkAgentType(name, node, env);
    env.defineOrUpdate(name, agentType, false);
    return mkUnit();
  }

  private evalSpawnExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // spawn<AgentType>(args...)
    const typeNode = requiredField(node, 'type');
    const typeName = typeNode.text;

    // Look up the agent type
    const agentType = env.get(typeName);
    if (agentType.kind !== 'agent_type') {
      throw new AnimaTypeError(
        `'${typeName}' is not an agent type`,
        node.startPosition.row + 1,
        node.startPosition.column,
      );
    }

    // Collect spawn arguments (positional and named)
    const args: AnimaValue[] = [];
    const namedArgs = new Map<string, AnimaValue>();
    for (const child of node.namedChildren) {
      // Skip the type node
      if (child === typeNode || child.type === 'type_identifier' || child.type === 'identifier') {
        // May be the type argument — skip if position matches
        if (child.text === typeName) continue;
      }
      if (child.type === 'named_argument') {
        const argName = requiredField(child, 'name').text;
        const argValue = this.evalNode(requiredField(child, 'value'), env);
        namedArgs.set(argName, argValue);
        continue;
      }
      // Regular positional argument
      if (child.type !== 'type_identifier' && child.type !== 'identifier') {
        args.push(this.evalNode(child, env));
      }
    }

    return this.instantiateAgent(agentType, args, namedArgs, node, env);
  }

  private instantiateAgent(
    agentType: Extract<AnimaValue, { kind: 'agent_type' }>,
    args: AnimaValue[],
    namedArgs: Map<string, AnimaValue>,
    callSite: SyntaxNodeRef,
    callerEnv: Environment,
  ): AnimaValue {
    const decl = agentType.declaration;
    const agentEnv = agentType.closure.child();

    // Bind constructor parameters from the declaration
    const paramNodes: SyntaxNodeRef[] = [];
    for (const child of decl.namedChildren) {
      if (child.type === 'parameter' || child.type === 'field_parameter') {
        paramNodes.push(child);
      }
    }

    for (let i = 0; i < paramNodes.length; i++) {
      const pNode = paramNodes[i];
      const pName = requiredField(pNode, 'name').text;
      const namedValue = namedArgs.get(pName);
      if (namedValue !== undefined) {
        agentEnv.define(pName, namedValue, false);
      } else if (i < args.length) {
        agentEnv.define(pName, args[i], false);
      } else {
        const defaultNode = pNode.childForFieldName('default');
        if (defaultNode) {
          agentEnv.define(pName, this.evalNode(defaultNode, callerEnv), false);
        } else {
          throw new AnimaRuntimeError(
            `Missing argument '${pName}' in spawn<${agentType.typeName}>()`,
            callSite.startPosition.row + 1,
            callSite.startPosition.column,
          );
        }
      }
    }

    // Walk the agent body sections
    const bodyNode = requiredField(decl, 'body');
    const methods = new Map<string, AnimaValue>();
    const eventHandlers = new Map<string, AnimaValue>();
    const boundaries: AgentBoundaries = { toolCallCount: 0, canActions: [], cannotActions: [] };

    for (const section of bodyNode.namedChildren) {
      switch (section.type) {
        case 'agent_context_section': {
          for (const fieldDecl of section.namedChildren) {
            if (fieldDecl.type === 'field_declaration') {
              const fieldName = requiredField(fieldDecl, 'name').text;
              const isMutable = fieldDecl.children.some(c => c.text === 'var');
              const valueNode = fieldDecl.childForFieldName('value');
              const value = valueNode ? this.evalNode(valueNode, agentEnv) : mkNull();
              agentEnv.define(fieldName, value, isMutable);
            }
          }
          break;
        }
        case 'tools_section': {
          for (const toolDecl of section.namedChildren) {
            if (toolDecl.type === 'tool_declaration') {
              const toolName = requiredField(toolDecl, 'name').text;
              // Tool stubs track calls against boundary limits
              agentEnv.define(toolName, mkBuiltin(toolName, () => {
                throw new AnimaRuntimeError(`Tool '${toolName}' is not connected to an implementation`);
              }), false);
            }
          }
          break;
        }
        case 'boundaries_section': {
          for (const rule of section.namedChildren) {
            if (rule.type === 'boundary_assignment') {
              const bName = requiredField(rule, 'name').text;
              const bValue = this.evalNode(requiredField(rule, 'value'), agentEnv);
              agentEnv.define(bName, bValue, false);
              if (bName === 'maxToolCalls' && bValue.kind === 'int') {
                boundaries.maxToolCalls = bValue.value;
              }
            } else if (rule.type === 'can_block') {
              const block = childOfType(rule, 'block');
              if (block) {
                for (const stmt of block.namedChildren) {
                  boundaries.canActions.push(stmt.text.replace(/;/g, '').trim());
                }
              }
            } else if (rule.type === 'cannot_block') {
              const block = childOfType(rule, 'block');
              if (block) {
                for (const stmt of block.namedChildren) {
                  boundaries.cannotActions.push(stmt.text.replace(/;/g, '').trim());
                }
              }
            }
          }
          break;
        }
        case 'function_declaration': {
          this.evalFunctionDeclaration(section, agentEnv);
          const fnName = requiredField(section, 'name').text;
          methods.set(fnName, agentEnv.get(fnName));
          break;
        }
        case 'intent_declaration': {
          this.evalIntentDeclaration(section, agentEnv);
          const fnName = requiredField(section, 'name').text;
          methods.set(fnName, agentEnv.get(fnName));
          break;
        }
        case 'on_handler': {
          const eventTypeNode = requiredField(section, 'event_type');
          const eventName = eventTypeNode.text;
          const handlerBody = section.namedChildren.find(
            c => c.type === 'lambda_expression' || c.type === 'block'
          );
          if (handlerBody) {
            eventHandlers.set(eventName, mkFunction(`on<${eventName}>`, [{ name: 'event' }], handlerBody, agentEnv));
          }
          break;
        }
        case 'team_section': {
          // Evaluate team member spawn expressions
          for (const member of section.namedChildren) {
            if (member.type === 'team_member') {
              this.evalNode(member, agentEnv);
            }
          }
          break;
        }
      }
    }

    return mkAgent(agentType.typeName, agentEnv, methods, eventHandlers, boundaries);
  }

  // ==================================================================
  // Delegation, Parallel, Emit
  // ==================================================================

  private evalDelegateExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // delegate(agent) { expr } — evaluate the body in the agent's context
    const targetNode = requiredField(node, 'target');
    const bodyNode = requiredField(node, 'body');
    const target = this.evalNode(targetNode, env);

    if (target.kind !== 'agent') {
      throw new AnimaTypeError(
        `delegate() target must be an agent, got ${target.kind}`,
        node.startPosition.row + 1,
        node.startPosition.column,
      );
    }

    // Check boundary: maxToolCalls
    if (target.boundaries.maxToolCalls !== undefined) {
      target.boundaries.toolCallCount++;
      if (target.boundaries.toolCallCount > target.boundaries.maxToolCalls) {
        throw new AnimaRuntimeError(
          `Agent '${target.typeName}' exceeded maxToolCalls limit (${target.boundaries.maxToolCalls})`,
          node.startPosition.row + 1,
          node.startPosition.column,
        );
      }
    }

    // Execute the body in the agent's context environment
    // The body can reference the agent's methods and context fields
    return this.evalFunctionBody(bodyNode, target.context);
  }

  private evalParallelExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // parallel { ... } — single-threaded simulation: just execute the body sequentially
    const bodyNode = requiredField(node, 'body');
    return this.evalFunctionBody(bodyNode, env);
  }

  private evalEmitExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // emit(value) — dispatch to event handlers registered in the current environment
    const valueNode = node.namedChildren[0];
    if (!valueNode) return mkUnit();
    const eventValue = this.evalNode(valueNode, env);

    // Walk up the environment to find an agent that has a handler for this event type
    this.dispatchEvent(eventValue, env);
    return mkUnit();
  }

  private dispatchEvent(event: AnimaValue, env: Environment): void {
    // Determine event type name from the value
    let eventTypeName: string;
    if (event.kind === 'entity') {
      eventTypeName = event.typeName;
    } else if (event.kind === 'string') {
      eventTypeName = event.value;
    } else {
      eventTypeName = event.kind;
    }

    // Search for agents in the environment that handle this event type
    // In v0.1, we check if 'this' or 'self' is an agent with matching handler
    try {
      const self = env.get('this');
      if (self.kind === 'agent') {
        const handler = self.eventHandlers.get(eventTypeName);
        if (handler && handler.kind === 'function') {
          const handlerEnv = handler.closure.child();
          handlerEnv.define('event', event, false);
          this.evalFunctionBody(handler.body, handlerEnv);
        }
      }
    } catch (_) { /* no 'this' in scope */ }
  }

  // ==================================================================
  // Evolving declarations
  // ==================================================================

  private evalContextDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;

    // A context declaration creates a map of tier → fields
    const contextEntries = new Map<string, AnimaValue>();

    for (const child of node.namedChildren) {
      if (child.type === 'context_tier') {
        // First child text is the tier name (persistent, session, ephemeral)
        const tierName = child.children[0]?.text ?? 'unknown';
        const tierFields = new Map<string, AnimaValue>();

        for (const field of child.namedChildren) {
          if (field.type === 'field_declaration') {
            const fieldName = requiredField(field, 'name').text;
            const valueNode = field.childForFieldName('value');
            const val = valueNode ? this.evalNode(valueNode, env) : mkNull();
            tierFields.set(fieldName, val);
          }
        }

        contextEntries.set(tierName, mkMap(tierFields));
      }
    }

    const contextValue = mkMap(contextEntries);
    env.defineOrUpdate(name, contextValue, false);
    return mkUnit();
  }

  private evalProtocolDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;

    // A protocol registers each message as an entity type constructor
    const nsEntries = new Map<string, AnimaValue>();

    for (const child of node.namedChildren) {
      if (child.type === 'message_declaration') {
        const msgName = requiredField(child, 'name').text;

        const fieldDefs: EntityFieldDef[] = [];
        for (const fc of child.namedChildren) {
          if (fc.type === 'field_parameter') {
            const fieldName = requiredField(fc, 'name').text;
            const isVar = fc.children.some(c => c.text === 'var');
            fieldDefs.push({ name: fieldName, mutable: isVar });
          }
        }

        const msgType = mkEntityType(msgName, fieldDefs, [], env);
        env.defineOrUpdate(msgName, msgType, false);
        nsEntries.set(msgName, msgType);
      }
    }

    // Register the protocol name as a namespace
    env.defineOrUpdate(name, mkMap(nsEntries), false);
    return mkUnit();
  }

  private evalFeatureDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const featureName = nameNode.text.replace(/^"|"$/g, '');

    // Execute each spec (BDD given/whenever/then blocks)
    for (const child of node.namedChildren) {
      if (child.type === 'spec_declaration') {
        const specName = requiredField(child, 'name').text.replace(/^"|"$/g, '');
        const specEnv = env.child();

        try {
          for (const block of child.namedChildren) {
            if (block.type === 'given_block' || block.type === 'whenever_block' || block.type === 'then_block') {
              const body = block.namedChildren[0]; // the block node
              if (body) {
                // Execute block contents directly in specEnv (shared scope)
                for (const stmt of body.namedChildren) {
                  this.evalNode(stmt, specEnv);
                }
              }
            }
          }
        } catch (_e) {
          // Spec execution errors are silently ignored in v0.1
          // (specs reference test helpers and stubs not available at runtime)
        }
      }
    }

    return mkUnit();
  }

  private evalDiagnosableDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;

    // Register as an entity type with its field parameters
    const fieldDefs: EntityFieldDef[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'field_parameter') {
        const fieldName = requiredField(child, 'name').text;
        const isVar = child.children.some(c => c.text === 'var');
        fieldDefs.push({ name: fieldName, mutable: isVar });
      }
    }

    const diagType = mkEntityType(name, fieldDefs, [], env);
    // Mark as diagnosable for type checking
    if (diagType.kind === 'entity_type') {
      (diagType as any).diagnosable = true;
    }
    env.defineOrUpdate(name, diagType, false);
    return mkUnit();
  }

  private evalResourceDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const nameNode = requiredField(node, 'name');
    const name = nameNode.text;

    // Register resource as an entity type with its field parameters
    const fieldDefs: EntityFieldDef[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'field_parameter') {
        const fieldName = requiredField(child, 'name').text;
        const isVar = child.children.some(c => c.text === 'var');
        fieldDefs.push({ name: fieldName, mutable: isVar });
      }
    }

    const resourceType = mkEntityType(name, fieldDefs, [], env);
    env.defineOrUpdate(name, resourceType, false);
    return mkUnit();
  }

  private evalEvolvingDeclaration(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // evolve { ... } — register the construct for evolution tracking
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text ?? '<anonymous>';

    // Register with evolution engine
    const { getEvolutionEngine } = require('./evolution');
    const engine = getEvolutionEngine();
    engine.register(name, node.text);

    // Evaluate the body normally (the evolving construct works like a normal declaration for now)
    const bodyNode = node.childForFieldName('body');
    if (bodyNode) {
      return this.evalNode(bodyNode, env);
    }
    return mkUnit();
  }

  // ==================================================================
  // Semantic expressions and recall
  // ==================================================================

  private evalSemanticExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // Semantic operators: ~= (equality), ~> (implication), <~ (containment)
    const leftNode = node.childForFieldName('left') ?? node.namedChildren[0];
    const rightNode = node.childForFieldName('right') ?? node.namedChildren[1];
    if (!leftNode || !rightNode) return mkBool(false);

    const left = this.evalNode(leftNode, env);
    const right = this.evalNode(rightNode, env);

    const leftStr = left.kind === 'string' ? left.value : valueToString(left);
    const rightStr = right.kind === 'string' ? right.value : valueToString(right);

    // Determine operator from node text
    const nodeText = node.text;
    if (nodeText.includes('~=')) {
      return mkBool(nlSemanticEquals(leftStr, rightStr));
    } else if (nodeText.includes('~>')) {
      return mkBool(nlSemanticImplies(leftStr, rightStr));
    } else if (nodeText.includes('<~')) {
      return mkBool(nlSemanticImplies(rightStr, leftStr));
    }

    return mkBool(false);
  }

  private evalRecallExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // recall(query) — search memory store
    const queryNode = node.namedChildren[0];
    if (!queryNode) return mkList([]);

    const query = this.evalNode(queryNode, env);
    const queryStr = query.kind === 'string' ? query.value : valueToString(query);
    const results = getMemoryStore().recall(queryStr);

    return mkList(results.map(e => {
      const entries = new Map<string, AnimaValue>();
      entries.set('key', mkString(e.key));
      entries.set('value', e.value);
      entries.set('relevance', mkFloat(e.relevance));
      return mkMap(entries);
    }));
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

    let elements: AnimaValue[];
    if (iterable.kind === 'list') {
      elements = iterable.elements;
    } else if (iterable.kind === 'map') {
      // Convert map entries to MapEntry entities
      elements = [];
      for (const [k, v] of iterable.entries) {
        elements.push(this.mkMapEntry(k, v));
      }
    } else {
      throw new AnimaTypeError(
        `Cannot iterate over ${iterable.kind}`,
        iterableNode.startPosition.row + 1,
        iterableNode.startPosition.column,
      );
    }

    for (const element of elements) {
      const loopEnv = env.child();
      loopEnv.define(varNode.text, element, false);
      try {
        this.evalBlock(bodyNode, loopEnv);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) continue;
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
        if (e instanceof ContinueSignal) continue;
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
    const name = node.text;
    if (name === 'break') throw new BreakSignal();
    if (name === 'continue') throw new ContinueSignal();
    return env.get(name);
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

  private evalConfidenceExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const valueNode = requiredField(node, 'value');
    const confNode = requiredField(node, 'confidence');
    const value = this.evalNode(valueNode, env);
    const confidence = this.parseConfidenceValue(confNode);
    return mkConfident(value, confidence);
  }

  /** Parse a confidence_expression node into a numeric confidence value */
  private parseConfidenceValue(node: SyntaxNodeRef): number {
    // confidence_expression contains: float_literal | 'Confidence' | '_' | (>float) | (<float) | (float..float)
    // Find the float_literal child
    const floatChild = node.namedChildren.find(c => c.type === 'float_literal');
    if (floatChild) {
      return parseFloat(floatChild.text);
    }
    // Direct float_literal (node itself might be the float)
    if (node.type === 'float_literal') {
      return parseFloat(node.text);
    }
    // Check text for keywords
    const text = node.text.trim();
    if (text === 'Confidence' || text === '_') {
      return 1.0; // Runtime-determined or wildcard
    }
    // Fallback for complex expressions
    return 1.0;
  }

  private evalBinaryExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    const leftNode = requiredField(node, 'left');
    const rightNode = requiredField(node, 'right');

    // Find operator -- it's stored as a field in the grammar
    const opNode = node.childForFieldName('operator');
    const op = opNode ? opNode.text : this.findOperator(node);

    // Short-circuit for logical operators with confidence propagation
    if (op === '&&') {
      const left = this.evalNode(leftNode, env);
      const cL = getConfidence(left);
      if (!isTruthy(left)) return this.wrapIfConfident(mkBool(false), cL);
      const right = this.evalNode(rightNode, env);
      const cR = getConfidence(right);
      return this.wrapIfConfident(mkBool(isTruthy(right)), Math.min(cL, cR));
    }
    if (op === '||') {
      const left = this.evalNode(leftNode, env);
      const cL = getConfidence(left);
      if (isTruthy(left)) return this.wrapIfConfident(mkBool(true), cL);
      const right = this.evalNode(rightNode, env);
      const cR = getConfidence(right);
      return this.wrapIfConfident(mkBool(isTruthy(right)), Math.max(cL, cR));
    }

    const left = this.evalNode(leftNode, env);
    const right = this.evalNode(rightNode, env);
    const cL = getConfidence(left);
    const cR = getConfidence(right);
    // Unwrap for computation
    const uL = unwrapConfident(left);
    const uR = unwrapConfident(right);

    let result: AnimaValue;
    let resultConf: number;

    switch (op) {
      // Arithmetic — product rule
      case '+':
        result = this.evalAdd(uL, uR, node);
        resultConf = cL * cR;
        break;
      case '-':
        result = this.evalArith(uL, uR, (a, b) => a - b, node);
        resultConf = cL * cR;
        break;
      case '*':
        result = this.evalArith(uL, uR, (a, b) => a * b, node);
        resultConf = cL * cR;
        break;
      case '/':
        result = this.evalDiv(uL, uR, node);
        resultConf = cL * cR;
        break;
      case '%':
        result = this.evalArith(uL, uR, (a, b) => a % b, node);
        resultConf = cL * cR;
        break;

      // Comparison — product rule
      case '<':
        result = mkBool(this.compareValues(uL, uR) < 0);
        resultConf = cL * cR;
        break;
      case '>':
        result = mkBool(this.compareValues(uL, uR) > 0);
        resultConf = cL * cR;
        break;
      case '<=':
        result = mkBool(this.compareValues(uL, uR) <= 0);
        resultConf = cL * cR;
        break;
      case '>=':
        result = mkBool(this.compareValues(uL, uR) >= 0);
        resultConf = cL * cR;
        break;

      // Equality — product rule
      case '==':
        result = mkBool(valuesEqual(uL, uR));
        resultConf = cL * cR;
        break;
      case '!=':
        result = mkBool(!valuesEqual(uL, uR));
        resultConf = cL * cR;
        break;

      // The 'to' operator creates a pair (2-element list)
      case 'to':
        return mkList([left, right]);

      default:
        throw new AnimaRuntimeError(
          `Unsupported operator: '${op}'`,
          node.startPosition.row + 1,
          node.startPosition.column,
        );
    }

    return this.wrapIfConfident(result, resultConf);
  }

  /** Wrap a value with confidence only if conf < 1.0 */
  private wrapIfConfident(value: AnimaValue, conf: number): AnimaValue {
    if (conf >= 1.0) return value;
    return mkConfident(value, conf);
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
    const conf = getConfidence(operand);
    const u = unwrapConfident(operand);

    switch (op) {
      case '-':
        if (u.kind === 'int') return this.wrapIfConfident(mkInt(-u.value), conf);
        if (u.kind === 'float') return this.wrapIfConfident(mkFloat(-u.value), conf);
        throw new AnimaTypeError(`Cannot negate ${u.kind}`);
      case '!':
        // Negation preserves confidence
        return this.wrapIfConfident(mkBool(!isTruthy(u)), conf);
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

    // Handle trailing lambda after call: `fold(1) { acc, x -> ... }`
    // Parser produces: call_expression(function=call_expression(fold, 1), trailing_lambda=lambda)
    // We merge into a single call: fold(1, lambda)
    const trailingLambda = node.namedChildren.find(c =>
      c.type === 'lambda_expression' &&
      !(c.startPosition.row === funcNode.startPosition.row &&
        c.startPosition.column === funcNode.startPosition.column));
    if (funcNode.type === 'call_expression' && trailingLambda) {
      // Evaluate the inner call_expression's function and args, then append the trailing lambda
      const innerFuncNode = requiredField(funcNode, 'function');
      const innerCallee = this.evalNode(innerFuncNode, env);
      const args: AnimaValue[] = [];
      const namedArgs = new Map<string, AnimaValue>();
      const innerFuncStart = innerFuncNode.startPosition;
      const innerFuncEnd = innerFuncNode.endPosition;

      for (const child of funcNode.namedChildren) {
        if (child.startPosition.row === innerFuncStart.row &&
            child.startPosition.column === innerFuncStart.column &&
            child.endPosition.row === innerFuncEnd.row &&
            child.endPosition.column === innerFuncEnd.column) continue;
        if (child.type === 'lambda_expression') {
          args.push(this.evalLambdaExpression(child, env));
          continue;
        }
        if (child.type === 'named_argument') {
          namedArgs.set(requiredField(child, 'name').text, this.evalNode(requiredField(child, 'value'), env));
          continue;
        }
        args.push(this.evalNode(child, env));
      }
      // Append the outer trailing lambda
      args.push(this.evalLambdaExpression(trailingLambda, env));
      return this.callFunction(innerCallee, args, namedArgs, node, env);
    }

    const callee = this.evalNode(funcNode, env);

    // Safe call propagation: if callee is null from a ?. chain, return null
    if (callee.kind === 'null' && funcNode.type === 'safe_member_expression') {
      return mkNull();
    }

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

    if (callee.kind === 'agent_type') {
      return this.instantiateAgent(callee, args, namedArgs, callSite, callerEnv);
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

      // If this function's body is a lambda meant to be returned as a closure
      if (callee.returnsLambda) {
        return this.evalLambdaExpression(callee.body, funcEnv);
      }
      return this.evalFunctionBody(callee.body, funcEnv);
    }

    throw new AnimaTypeError(
      `'${valueToString(callee)}' is not callable`,
      callSite.startPosition.row + 1,
      callSite.startPosition.column,
    );
  }

  private evalFunctionBody(body: SyntaxNodeRef, env: Environment): AnimaValue {
    try {
      if (body.type === 'block') {
        return this.evalBlock(body, env);
      } else if (body.type === 'lambda_expression') {
        let result: AnimaValue = mkUnit();
        for (const child of body.namedChildren) {
          if (child.type === 'lambda_parameters') continue;
          result = this.evalNode(child, env);
        }
        return result;
      } else {
        return this.evalNode(body, env);
      }
    } catch (e) {
      if (e instanceof ReturnSignal) {
        return e.value as AnimaValue;
      }
      throw e;
    }
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
    // Confident value members
    if (obj.kind === 'confident') {
      switch (name) {
        case 'confidence': return mkFloat(obj.confidence);
        case 'value': return obj.value;
        case 'unwrap': return mkBuiltinMethod(() => obj.value);
        case 'decompose': return mkBuiltinMethod(() => mkList([obj.value, mkFloat(obj.confidence)]));
        case 'toString': return mkBuiltinMethod(() => mkString(valueToString(obj)));
      }
      // For other members, delegate to inner value and propagate confidence
      const innerResult = this.accessMember(obj.value, name, node);
      return this.wrapIfConfident(innerResult, obj.confidence);
    }

    // Universal toString method
    if (name === 'toString') {
      return mkBuiltinMethod(() => mkString(valueToString(obj)));
    }

    // List members
    if (obj.kind === 'list') {
      switch (name) {
        case 'size': return mkInt(obj.elements.length);
        case 'length': return mkInt(obj.elements.length);
        case 'isEmpty': return mkBuiltinMethod(() => mkBool(obj.elements.length === 0));
        case 'first': return mkBuiltinMethod(() => obj.elements.length > 0 ? obj.elements[0] : mkNull());
        case 'last': return mkBuiltinMethod(() => obj.elements.length > 0 ? obj.elements[obj.elements.length - 1] : mkNull());
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
          // reduce uses first element as initial value, takes only a lambda
          const listVal = obj as Extract<AnimaValue, { kind: 'list' }>;
          if (listVal.elements.length === 0) {
            throw new AnimaRuntimeError('reduce on empty list');
          }
          const initial = listVal.elements[0];
          const rest = mkList(listVal.elements.slice(1));
          return this.listReduce(rest as Extract<AnimaValue, { kind: 'list' }>, initial, args[0], node);
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
        case 'associateBy': return mkBuiltinMethod((args) => {
          const entries = new Map<string, AnimaValue>();
          for (const el of obj.elements) {
            const key = this.callFunction(args[0], [el], new Map(), node, this.globalEnv);
            entries.set(valueToString(key), el);
          }
          return mkMap(entries);
        });
        case 'groupBy': return mkBuiltinMethod((args) => {
          const groups = new Map<string, AnimaValue[]>();
          for (const el of obj.elements) {
            const key = valueToString(this.callFunction(args[0], [el], new Map(), node, this.globalEnv));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(el);
          }
          const entries = new Map<string, AnimaValue>();
          for (const [k, v] of groups) entries.set(k, mkList(v));
          return mkMap(entries);
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
        case 'replace': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'string' || args[1].kind !== 'string') throw new AnimaTypeError('replace() expects (String, String)');
          return mkString(obj.value.split(args[0].value).join(args[1].value));
        });
        case 'indexOf': return mkBuiltinMethod((args) => {
          if (args[0].kind !== 'string') throw new AnimaTypeError('indexOf() expects a String');
          return mkInt(obj.value.indexOf(args[0].value));
        });
        case 'toInt': return mkBuiltinMethod(() => {
          const n = parseInt(obj.value, 10);
          if (isNaN(n)) throw new AnimaRuntimeError(`Cannot convert '${obj.value}' to Int`);
          return mkInt(n);
        });
        case 'toFloat': return mkBuiltinMethod(() => {
          const n = parseFloat(obj.value);
          if (isNaN(n)) throw new AnimaRuntimeError(`Cannot convert '${obj.value}' to Float`);
          return mkFloat(n);
        });
        case 'reversed': return mkBuiltinMethod(() => mkString(obj.value.split('').reverse().join('')));
        case 'repeat': return mkBuiltinMethod((args) => mkString(obj.value.repeat(asNumber(args[0]))));
        case 'padStart': return mkBuiltinMethod((args) => {
          const len = asNumber(args[0]);
          const fill = args.length > 1 && args[1].kind === 'string' ? args[1].value : ' ';
          return mkString(obj.value.padStart(len, fill));
        });
        case 'padEnd': return mkBuiltinMethod((args) => {
          const len = asNumber(args[0]);
          const fill = args.length > 1 && args[1].kind === 'string' ? args[1].value : ' ';
          return mkString(obj.value.padEnd(len, fill));
        });
        // NL string members
        case 'entities': return mkList(nlExtractEntities(obj.value).map(e => mkString(e)));
        case 'clarify': return mkBuiltinMethod(() => {
          const { nlClarify } = require('./nl');
          return mkString(nlClarify(obj.value));
        });
        case 'summarize': return mkBuiltinMethod(() => {
          const { nlSummarize } = require('./nl');
          return mkString(nlSummarize(obj.value));
        });
        case 'operations': return mkList([
          mkString('entities'), mkString('clarify'), mkString('summarize'),
          mkString('classify'),
        ]);
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
    }

    // Agent members
    if (obj.kind === 'agent') {
      // Method lookup
      const method = obj.methods.get(name);
      if (method) return method;

      // Context field access
      try {
        return obj.context.get(name);
      } catch (_) { /* fall through */ }

      switch (name) {
        case 'typeName': return mkString(obj.typeName);
        case 'toString': return mkBuiltinMethod(() => mkString(valueToString(obj)));
        case 'toolCallCount': return mkInt(obj.boundaries.toolCallCount);
        case 'maxToolCalls': return obj.boundaries.maxToolCalls !== undefined
          ? mkInt(obj.boundaries.maxToolCalls) : mkNull();
        case 'canActions': return mkList(obj.boundaries.canActions.map(a => mkString(a)));
        case 'cannotActions': return mkList(obj.boundaries.cannotActions.map(a => mkString(a)));
      }
    }

    // Extension function lookup (works for all types)
    const extFn = this.lookupExtensionFunction(obj, name);
    if (extFn && extFn.kind === 'function') {
      // Return a builtin method that calls the extension function with `this` bound
      const capturedObj = obj;
      const capturedExtFn = extFn;
      return mkBuiltinMethod((args) => {
        const extEnv = new Environment(capturedExtFn.closure);
        extEnv.define('this', capturedObj, false);
        // Bind params
        for (let i = 0; i < capturedExtFn.params.length; i++) {
          const p = capturedExtFn.params[i];
          const val = i < args.length ? args[i] : (p.defaultValue ? this.evalNode(p.defaultValue, extEnv) : mkNull());
          extEnv.define(p.name, val, false);
        }
        return this.evalFunctionBody(capturedExtFn.body, extEnv);
      });
    }

    const typeName = obj.kind === 'entity' ? obj.typeName : obj.kind;
    throw new AnimaRuntimeError(
      `No member '${name}' on ${typeName}`,
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
          // Find the type identifier in the condition
          const typeNode = condNode.namedChildren.find(c =>
            c.type === 'type_identifier' || c.type === 'primitive_type' || c.type === 'identifier'
          );
          if (typeNode) {
            const typeName = typeNode.type === 'type_identifier'
              ? typeNode.namedChildren[0]?.text ?? typeNode.text
              : typeNode.text;

            let matches = false;
            switch (typeName) {
              case 'Int': matches = subject.kind === 'int'; break;
              case 'Float': matches = subject.kind === 'float'; break;
              case 'String': matches = subject.kind === 'string'; break;
              case 'Bool': case 'Boolean': matches = subject.kind === 'bool'; break;
              case 'List': matches = subject.kind === 'list'; break;
              case 'Map': matches = subject.kind === 'map'; break;
              default:
                if (subject.kind === 'entity') {
                  matches = subject.typeName === typeName;
                  if (!matches) {
                    try {
                      const et = env.get(subject.typeName);
                      if (et.kind === 'entity_type' && (et as any).sealedParent === typeName) {
                        matches = true;
                      }
                    } catch (_) { /* ignore */ }
                  }
                }
                break;
            }

            if (matches) {
              return this.evalBlockOrLambdaAsBlock(bodyNode, env);
            }
          }
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
    } else if (this.nodeReferencesIt(node)) {
      // Implicit 'it' parameter only when the lambda body actually uses 'it'
      params.push({ name: 'it' });
    }

    // Build a synthetic body: we'll use the node itself and handle
    // lambda body evaluation specially
    return mkFunction('<lambda>', params, node, env);
  }

  /** Recursively check if any identifier node in the subtree has text 'it'. */
  private nodeReferencesIt(node: SyntaxNodeRef): boolean {
    if (node.type === 'identifier' && node.text === 'it') return true;
    for (const child of node.namedChildren) {
      if (this.nodeReferencesIt(child)) return true;
    }
    return false;
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
    const finallyClause = node.namedChildren.find(c => c.type === 'finally_clause');

    let result: AnimaValue = mkUnit();
    let thrownError: any = null;
    let hasError = false;

    try {
      result = this.evalBlock(bodyNode, env);
    } catch (e) {
      // Re-throw control flow signals (but still run finally)
      if (e instanceof ReturnSignal || e instanceof BreakSignal || e instanceof ContinueSignal) {
        if (finallyClause) {
          const finallyBody = finallyClause.namedChildren[0];
          if (finallyBody) this.evalBlock(finallyBody, env);
        }
        throw e;
      }

      let caught = false;
      for (const clause of catchClauses) {
        const nameNode = requiredField(clause, 'name');
        const clauseBody = requiredField(clause, 'body');

        const catchEnv = env.child();
        const errorMsg = e instanceof Error ? e.message : String(e);
        catchEnv.define(nameNode.text, mkString(errorMsg), false);

        result = this.evalBlock(clauseBody, catchEnv);
        caught = true;
        break;
      }

      if (!caught) {
        thrownError = e;
        hasError = true;
      }
    }

    // Execute finally block
    if (finallyClause) {
      const finallyBody = finallyClause.namedChildren[0];
      if (finallyBody) this.evalBlock(finallyBody, env);
    }

    if (hasError) throw thrownError;
    return result;
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
        // Check entity type name or sealed parent
        if (value.kind === 'entity') {
          if (value.typeName === typeName) return mkBool(true);
          // Check if the entity's type was declared as a sealed variant of typeName
          try {
            const entityType = env.get(value.typeName);
            if (entityType.kind === 'entity_type' && (entityType as any).sealedParent === typeName) {
              return mkBool(true);
            }
          } catch (_) { /* ignore */ }
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
  // Extension function support
  // ==================================================================

  /** Map a runtime value kind to the type name used in extension function receivers */
  private valueTypeName(v: AnimaValue): string {
    switch (v.kind) {
      case 'int': return 'Int';
      case 'float': return 'Float';
      case 'string': return 'String';
      case 'bool': return 'Boolean';
      case 'list': return 'List';
      case 'map': return 'Map';
      case 'entity': return v.typeName;
      default: return v.kind;
    }
  }

  /** Look up an extension function for the given object and method name */
  private lookupExtensionFunction(obj: AnimaValue, name: string): AnimaValue | null {
    // Try exact type name first
    const typeName = this.valueTypeName(obj);
    const key = `${typeName}.${name}`;
    const fn = this.extensionFunctions.get(key);
    if (fn) return fn;

    // For entities, also check sealed parent
    if (obj.kind === 'entity') {
      const entityType = this.globalEnv.get(obj.typeName);
      if (entityType.kind === 'entity_type' && (entityType as any).sealedParent) {
        const parentKey = `${(entityType as any).sealedParent}.${name}`;
        const parentFn = this.extensionFunctions.get(parentKey);
        if (parentFn) return parentFn;
      }
    }

    return null;
  }

  // ==================================================================
  // Stubs for unimplemented features
  // ==================================================================

  private evalAskExpression(node: SyntaxNodeRef, env: Environment): AnimaValue {
    // In v0.1, ask() is non-interactive: evaluate the prompt and return it as a string
    const promptNode = node.namedChildren[0];
    if (promptNode) {
      const prompt = this.evalNode(promptNode, env);
      return prompt.kind === 'string' ? prompt : mkString(valueToString(prompt));
    }
    return mkString('[ask: no prompt]');
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

  private mkMapEntry(key: string, value: AnimaValue): AnimaValue {
    return mkEntity('MapEntry',
      new Map<string, AnimaValue>([['key', mkString(key)], ['value', value]]),
      ['key', 'value']);
  }

  private mapFilter(map: Extract<AnimaValue, { kind: 'map' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const result = new Map<string, AnimaValue>();
    for (const [key, value] of map.entries) {
      const entry = this.mkMapEntry(key, value);
      const keep = this.callFunction(fn, [entry], new Map(), node, this.globalEnv);
      if (isTruthy(keep)) {
        result.set(key, value);
      }
    }
    return mkMap(result);
  }

  private mapMapValues(map: Extract<AnimaValue, { kind: 'map' }>, fn: AnimaValue, node: SyntaxNodeRef): AnimaValue {
    const result = new Map<string, AnimaValue>();
    for (const [key, value] of map.entries) {
      const entry = this.mkMapEntry(key, value);
      result.set(
        key,
        this.callFunction(fn, [entry], new Map(), node, this.globalEnv),
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
