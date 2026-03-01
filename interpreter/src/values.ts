/**
 * Runtime value representations for the Anima interpreter.
 */

import type { Environment } from './environment';

/**
 * A tree-sitter SyntaxNode reference. We use a loose type here
 * so that the values module doesn't depend directly on tree-sitter types.
 * The interpreter passes the actual SyntaxNode objects.
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

export type AnimaValue =
  | { kind: 'int'; value: number }
  | { kind: 'float'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'list'; elements: AnimaValue[]; mutable: boolean }
  | { kind: 'map'; entries: Map<string, AnimaValue>; mutable: boolean }
  | { kind: 'function'; name: string; params: ParamDef[]; body: SyntaxNodeRef; closure: Environment; returnsLambda?: boolean }
  | { kind: 'builtin'; name: string; fn: BuiltinFn }
  | { kind: 'entity'; typeName: string; fields: Map<string, AnimaValue>; fieldOrder: string[] }
  | { kind: 'entity_type'; typeName: string; fieldDefs: EntityFieldDef[]; invariants: SyntaxNodeRef[]; closure: Environment }
  | { kind: 'confident'; value: AnimaValue; confidence: number }
  | { kind: 'agent'; typeName: string; context: Environment; methods: Map<string, AnimaValue>; eventHandlers: Map<string, AnimaValue>; boundaries: AgentBoundaries }
  | { kind: 'agent_type'; typeName: string; declaration: SyntaxNodeRef; closure: Environment }
  | { kind: 'unit' };

export interface EntityFieldDef {
  name: string;
  mutable: boolean;
  defaultValue?: SyntaxNodeRef;
}

export interface ParamDef {
  name: string;
  defaultValue?: SyntaxNodeRef;
}

export interface AgentBoundaries {
  maxToolCalls?: number;
  toolCallCount: number;
  canActions: string[];
  cannotActions: string[];
}

export type BuiltinFn = (args: AnimaValue[], namedArgs?: Map<string, AnimaValue>) => AnimaValue;

// ---- Value constructors ----

export function mkInt(value: number): AnimaValue {
  return { kind: 'int', value };
}

export function mkFloat(value: number): AnimaValue {
  return { kind: 'float', value };
}

export function mkString(value: string): AnimaValue {
  return { kind: 'string', value };
}

export function mkBool(value: boolean): AnimaValue {
  return { kind: 'bool', value };
}

export function mkNull(): AnimaValue {
  return { kind: 'null' };
}

export function mkUnit(): AnimaValue {
  return { kind: 'unit' };
}

export function mkList(elements: AnimaValue[], mutable = false): AnimaValue {
  return { kind: 'list', elements, mutable };
}

export function mkMap(entries: Map<string, AnimaValue>, mutable = false): AnimaValue {
  return { kind: 'map', entries, mutable };
}

export function mkFunction(
  name: string,
  params: ParamDef[],
  body: SyntaxNodeRef,
  closure: Environment,
): AnimaValue {
  return { kind: 'function', name, params, body, closure };
}

export function mkBuiltin(name: string, fn: BuiltinFn): AnimaValue {
  return { kind: 'builtin', name, fn };
}

export function mkEntity(typeName: string, fields: Map<string, AnimaValue>, fieldOrder: string[]): AnimaValue {
  return { kind: 'entity', typeName, fields, fieldOrder };
}

export function mkEntityType(
  typeName: string,
  fieldDefs: EntityFieldDef[],
  invariants: SyntaxNodeRef[],
  closure: Environment,
): AnimaValue {
  return { kind: 'entity_type', typeName, fieldDefs, invariants, closure };
}

export function mkAgent(
  typeName: string,
  context: Environment,
  methods: Map<string, AnimaValue>,
  eventHandlers: Map<string, AnimaValue> = new Map(),
  boundaries: AgentBoundaries = { toolCallCount: 0, canActions: [], cannotActions: [] },
): AnimaValue {
  return { kind: 'agent', typeName, context, methods, eventHandlers, boundaries };
}

export function mkAgentType(typeName: string, declaration: SyntaxNodeRef, closure: Environment): AnimaValue {
  return { kind: 'agent_type', typeName, declaration, closure };
}

export function mkConfident(value: AnimaValue, confidence: number): AnimaValue {
  // Clamp to [0, 1] and round to avoid floating point noise
  const c = Math.round(Math.max(0, Math.min(1, confidence)) * 1e10) / 1e10;
  // Don't double-wrap: if value is already confident, re-wrap the inner value
  if (value.kind === 'confident') {
    return { kind: 'confident', value: value.value, confidence: c };
  }
  return { kind: 'confident', value, confidence: c };
}

/**
 * Get the confidence of any value. Non-confident values have implicit confidence 1.0.
 */
export function getConfidence(v: AnimaValue): number {
  return v.kind === 'confident' ? v.confidence : 1.0;
}

/**
 * Get the unwrapped value (strips confidence wrapper if present).
 */
export function unwrapConfident(v: AnimaValue): AnimaValue {
  return v.kind === 'confident' ? v.value : v;
}

// ---- Value utilities ----

export function isTruthy(v: AnimaValue): boolean {
  switch (v.kind) {
    case 'bool': return v.value;
    case 'null': return false;
    case 'unit': return false;
    case 'int': return v.value !== 0;
    case 'float': return v.value !== 0;
    case 'string': return v.value.length > 0;
    case 'list': return v.elements.length > 0;
    case 'map': return v.entries.size > 0;
    case 'entity': return true;
    case 'entity_type': return true;
    case 'confident': return isTruthy(v.value);
    default: return true;
  }
}

export function valueToString(v: AnimaValue): string {
  switch (v.kind) {
    case 'int': return String(v.value);
    case 'float': {
      const s = String(v.value);
      return s.includes('.') ? s : s + '.0';
    }
    case 'string': return v.value;
    case 'bool': return String(v.value);
    case 'null': return 'null';
    case 'unit': return 'Unit';
    case 'list': return `[${v.elements.map(valueToString).join(', ')}]`;
    case 'map': {
      const pairs: string[] = [];
      v.entries.forEach((val, key) => {
        pairs.push(`${key}: ${valueToString(val)}`);
      });
      return `{${pairs.join(', ')}}`;
    }
    case 'function': return `<function ${v.name}>`;
    case 'builtin': return `<builtin ${v.name}>`;
    case 'entity': {
      const fields: string[] = [];
      for (const key of v.fieldOrder) {
        fields.push(`${key}=${valueToString(v.fields.get(key)!)}`);
      }
      return `${v.typeName}(${fields.join(', ')})`;
    }
    case 'entity_type': return `<entity_type ${v.typeName}>`;
    case 'confident': return `${valueToString(v.value)} @ ${v.confidence}`;
    case 'agent': return `<agent ${v.typeName}>`;
    case 'agent_type': return `<agent_type ${v.typeName}>`;
  }
}

export function valuesEqual(a: AnimaValue, b: AnimaValue): boolean {
  // Unwrap confidence for equality comparison
  const ua = unwrapConfident(a);
  const ub = unwrapConfident(b);
  if (ua !== a || ub !== b) return valuesEqual(ua, ub);

  if (a.kind !== b.kind) {
    // Allow int/float comparison
    if ((a.kind === 'int' || a.kind === 'float') && (b.kind === 'int' || b.kind === 'float')) {
      return a.value === b.value;
    }
    return false;
  }
  switch (a.kind) {
    case 'int':
    case 'float':
    case 'string':
    case 'bool':
      return a.value === (b as typeof a).value;
    case 'null':
    case 'unit':
      return true;
    case 'list': {
      const bList = b as Extract<AnimaValue, { kind: 'list' }>;
      if (a.elements.length !== bList.elements.length) return false;
      return a.elements.every((el, i) => valuesEqual(el, bList.elements[i]));
    }
    case 'map': {
      const bMap = b as Extract<AnimaValue, { kind: 'map' }>;
      if (a.entries.size !== bMap.entries.size) return false;
      for (const [k, v] of a.entries) {
        const bv = bMap.entries.get(k);
        if (bv === undefined || !valuesEqual(v, bv)) return false;
      }
      return true;
    }
    case 'entity': {
      const bEntity = b as Extract<AnimaValue, { kind: 'entity' }>;
      if (a.typeName !== bEntity.typeName) return false;
      if (a.fields.size !== bEntity.fields.size) return false;
      for (const [k, v] of a.fields) {
        const bv = bEntity.fields.get(k);
        if (bv === undefined || !valuesEqual(v, bv)) return false;
      }
      return true;
    }
    default:
      return a === b;
  }
}

/**
 * Get the numeric value from an int or float, or throw.
 */
export function asNumber(v: AnimaValue): number {
  const u = unwrapConfident(v);
  if (u.kind === 'int' || u.kind === 'float') return u.value;
  throw new Error(`Expected number, got ${u.kind}`);
}
