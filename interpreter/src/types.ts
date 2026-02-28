/**
 * Runtime type representations for the Anima interpreter.
 *
 * These represent Anima's type system at runtime, used for
 * type checking and display purposes.
 */

export type AnimaType =
  | { kind: 'int' }
  | { kind: 'float' }
  | { kind: 'string' }
  | { kind: 'bool' }
  | { kind: 'unit' }
  | { kind: 'null' }
  | { kind: 'any' }
  | { kind: 'nothing' }
  | { kind: 'list'; elementType?: AnimaType }
  | { kind: 'map'; keyType?: AnimaType; valueType?: AnimaType }
  | { kind: 'function'; paramTypes: AnimaType[]; returnType: AnimaType }
  | { kind: 'nullable'; inner: AnimaType };

export function typeToString(t: AnimaType): string {
  switch (t.kind) {
    case 'int': return 'Int';
    case 'float': return 'Float';
    case 'string': return 'String';
    case 'bool': return 'Bool';
    case 'unit': return 'Unit';
    case 'null': return 'Null';
    case 'any': return 'Any';
    case 'nothing': return 'Nothing';
    case 'list': return t.elementType ? `List<${typeToString(t.elementType)}>` : 'List';
    case 'map': return t.keyType && t.valueType
      ? `Map<${typeToString(t.keyType)}, ${typeToString(t.valueType)}>`
      : 'Map';
    case 'function': return `(${t.paramTypes.map(typeToString).join(', ')}) -> ${typeToString(t.returnType)}`;
    case 'nullable': return `${typeToString(t.inner)}?`;
  }
}
