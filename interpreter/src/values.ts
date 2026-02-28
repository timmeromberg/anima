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
  | { kind: 'function'; name: string; params: ParamDef[]; body: SyntaxNodeRef; closure: Environment }
  | { kind: 'builtin'; name: string; fn: BuiltinFn }
  | { kind: 'unit' };

export interface ParamDef {
  name: string;
  defaultValue?: SyntaxNodeRef;
}

export type BuiltinFn = (args: AnimaValue[]) => AnimaValue;

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
  }
}

export function valuesEqual(a: AnimaValue, b: AnimaValue): boolean {
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
    default:
      return a === b;
  }
}

/**
 * Get the numeric value from an int or float, or throw.
 */
export function asNumber(v: AnimaValue): number {
  if (v.kind === 'int' || v.kind === 'float') return v.value;
  throw new Error(`Expected number, got ${v.kind}`);
}
