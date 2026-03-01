/**
 * Core type representations for the Anima type system.
 */

// ---------------------------------------------------------------------------
// Type ADT
// ---------------------------------------------------------------------------

export type AnimaType =
  | { tag: 'int' }
  | { tag: 'float' }
  | { tag: 'string' }
  | { tag: 'bool' }
  | { tag: 'null' }
  | { tag: 'unit' }
  | { tag: 'any' }
  | { tag: 'nothing' }
  | { tag: 'nullable'; inner: AnimaType }
  | { tag: 'list'; element: AnimaType; mutable: boolean }
  | { tag: 'map'; key: AnimaType; value: AnimaType; mutable: boolean }
  | { tag: 'set'; element: AnimaType; mutable: boolean }
  | { tag: 'entity'; name: string; fields: FieldType[]; sealed?: string }
  | { tag: 'sealed'; name: string; variants: string[] }
  | { tag: 'interface'; name: string; members: MemberType[] }
  | { tag: 'function'; params: ParamType[]; returnType: AnimaType }
  | { tag: 'tuple'; elements: AnimaType[] }
  | { tag: 'union'; types: AnimaType[] }
  | { tag: 'intersection'; types: AnimaType[] }
  | { tag: 'generic'; name: string; bound?: AnimaType }
  | { tag: 'applied'; base: AnimaType; args: AnimaType[] }
  | { tag: 'confident'; inner: AnimaType }
  | { tag: 'nl' }
  | { tag: 'type_alias'; name: string; target: AnimaType }
  | { tag: 'unknown' };

// ---------------------------------------------------------------------------
// Supporting structures
// ---------------------------------------------------------------------------

export interface FieldType {
  name: string;
  type: AnimaType;
  mutable: boolean;
  hasDefault: boolean;
}

export interface ParamType {
  name: string;
  type: AnimaType;
  hasDefault: boolean;
}

export interface MemberType {
  name: string;
  type: AnimaType;
}

// ---------------------------------------------------------------------------
// Constructor helpers
// ---------------------------------------------------------------------------

export function mkIntType(): AnimaType {
  return { tag: 'int' };
}

export function mkFloatType(): AnimaType {
  return { tag: 'float' };
}

export function mkStringType(): AnimaType {
  return { tag: 'string' };
}

export function mkBoolType(): AnimaType {
  return { tag: 'bool' };
}

export function mkNullType(): AnimaType {
  return { tag: 'null' };
}

export function mkUnitType(): AnimaType {
  return { tag: 'unit' };
}

export function mkAnyType(): AnimaType {
  return { tag: 'any' };
}

export function mkNothingType(): AnimaType {
  return { tag: 'nothing' };
}

export function mkNullableType(inner: AnimaType): AnimaType {
  // Avoid double-nullable: T?? === T?
  if (inner.tag === 'nullable') return inner;
  // null? === null (null is already nullable)
  if (inner.tag === 'null') return inner;
  return { tag: 'nullable', inner };
}

export function mkListType(element: AnimaType, mutable = false): AnimaType {
  return { tag: 'list', element, mutable };
}

export function mkMapType(key: AnimaType, value: AnimaType, mutable = false): AnimaType {
  return { tag: 'map', key, value, mutable };
}

export function mkSetType(element: AnimaType, mutable = false): AnimaType {
  return { tag: 'set', element, mutable };
}

export function mkEntityType(name: string, fields: FieldType[], sealed?: string): AnimaType {
  return { tag: 'entity', name, fields, sealed };
}

export function mkSealedType(name: string, variants: string[]): AnimaType {
  return { tag: 'sealed', name, variants };
}

export function mkInterfaceType(name: string, members: MemberType[]): AnimaType {
  return { tag: 'interface', name, members };
}

export function mkFunctionType(params: ParamType[], returnType: AnimaType): AnimaType {
  return { tag: 'function', params, returnType };
}

export function mkTupleType(elements: AnimaType[]): AnimaType {
  return { tag: 'tuple', elements };
}

export function mkUnionType(types: AnimaType[]): AnimaType {
  return { tag: 'union', types };
}

export function mkIntersectionType(types: AnimaType[]): AnimaType {
  return { tag: 'intersection', types };
}

export function mkGenericType(name: string, bound?: AnimaType): AnimaType {
  return { tag: 'generic', name, bound };
}

export function mkAppliedType(base: AnimaType, args: AnimaType[]): AnimaType {
  return { tag: 'applied', base, args };
}

export function mkConfidentType(inner: AnimaType): AnimaType {
  return { tag: 'confident', inner };
}

export function mkNLType(): AnimaType {
  return { tag: 'nl' };
}

export function mkTypeAlias(name: string, target: AnimaType): AnimaType {
  return { tag: 'type_alias', name, target };
}

export function mkUnknownType(): AnimaType {
  return { tag: 'unknown' };
}

// ---------------------------------------------------------------------------
// Pretty-printing
// ---------------------------------------------------------------------------

export function typeToString(t: AnimaType): string {
  switch (t.tag) {
    case 'int':
      return 'Int';
    case 'float':
      return 'Float';
    case 'string':
      return 'String';
    case 'bool':
      return 'Bool';
    case 'null':
      return 'Null';
    case 'unit':
      return 'Unit';
    case 'any':
      return 'Any';
    case 'nothing':
      return 'Nothing';
    case 'nullable':
      return `${typeToString(t.inner)}?`;
    case 'list':
      return `${t.mutable ? 'MutableList' : 'List'}<${typeToString(t.element)}>`;
    case 'map':
      return `${t.mutable ? 'MutableMap' : 'Map'}<${typeToString(t.key)}, ${typeToString(t.value)}>`;
    case 'set':
      return `${t.mutable ? 'MutableSet' : 'Set'}<${typeToString(t.element)}>`;
    case 'entity':
      return t.name;
    case 'sealed':
      return t.name;
    case 'interface':
      return t.name;
    case 'function': {
      const params = t.params.map(p => `${p.name}: ${typeToString(p.type)}`).join(', ');
      return `(${params}) -> ${typeToString(t.returnType)}`;
    }
    case 'tuple': {
      const elems = t.elements.map(typeToString).join(', ');
      return `(${elems})`;
    }
    case 'union':
      return t.types.map(typeToString).join(' | ');
    case 'intersection':
      return t.types.map(typeToString).join(' & ');
    case 'generic':
      return t.bound ? `${t.name} : ${typeToString(t.bound)}` : t.name;
    case 'applied': {
      const args = t.args.map(typeToString).join(', ');
      return `${typeToString(t.base)}<${args}>`;
    }
    case 'confident':
      return `${typeToString(t.inner)} @ Confidence`;
    case 'nl':
      return 'NL';
    case 'type_alias':
      return t.name;
    case 'unknown':
      return '?';
  }
}
