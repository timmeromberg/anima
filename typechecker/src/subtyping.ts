/**
 * Subtype relation for the Anima type system.
 *
 * `isSubtype(sub, sup)` returns true when `sub` is a subtype of `sup`,
 * meaning a value of type `sub` can be used wherever `sup` is expected.
 */

import { AnimaType } from './types';

/**
 * Check whether `sub <: sup`.
 *
 * The relation is reflexive and transitive. Key rules:
 *
 *  - Everything <: Any
 *  - Nothing <: Everything
 *  - Int <: Float  (numeric widening)
 *  - T <: T?  (nullable promotion)
 *  - Null <: T?  (null inhabits every nullable type)
 *  - Entity <: its sealed parent
 *  - Covariance for immutable collections
 *  - Contravariance in function parameters, covariance in return type
 *  - Union / intersection membership
 *  - Confident wrapper is covariant
 *  - Type aliases are resolved before comparison
 */
export function isSubtype(sub: AnimaType, sup: AnimaType): boolean {
  // ---- Resolve type aliases first ----
  const s = resolveAlias(sub);
  const t = resolveAlias(sup);

  // ---- Reflexivity (structural) ----
  if (structurallyEqual(s, t)) return true;

  // ---- Top / bottom ----
  if (t.tag === 'any') return true;
  if (s.tag === 'nothing') return true;

  // ---- Numeric widening ----
  if (s.tag === 'int' && t.tag === 'float') return true;

  // ---- Nullable ----
  if (t.tag === 'nullable') {
    // T <: T?
    if (isSubtype(s, t.inner)) return true;
    // null <: T?
    if (s.tag === 'null') return true;
    // T? <: U?  if T <: U
    if (s.tag === 'nullable') return isSubtype(s.inner, t.inner);
    return false;
  }

  // ---- Entity <: sealed parent ----
  if (s.tag === 'entity' && s.sealed !== undefined && t.tag === 'sealed') {
    if (s.sealed === t.name) return true;
  }

  // ---- List covariance (immutable only) ----
  if (s.tag === 'list' && t.tag === 'list') {
    if (s.mutable || t.mutable) {
      // Mutable collections are invariant
      return !s.mutable === !t.mutable && isSubtype(s.element, t.element) && isSubtype(t.element, s.element);
    }
    return isSubtype(s.element, t.element);
  }

  // ---- Map covariance (immutable only) ----
  if (s.tag === 'map' && t.tag === 'map') {
    if (s.mutable || t.mutable) {
      return (
        !s.mutable === !t.mutable &&
        isSubtype(s.key, t.key) && isSubtype(t.key, s.key) &&
        isSubtype(s.value, t.value) && isSubtype(t.value, s.value)
      );
    }
    return isSubtype(s.key, t.key) && isSubtype(s.value, t.value);
  }

  // ---- Set covariance (immutable only) ----
  if (s.tag === 'set' && t.tag === 'set') {
    if (s.mutable || t.mutable) {
      return !s.mutable === !t.mutable && isSubtype(s.element, t.element) && isSubtype(t.element, s.element);
    }
    return isSubtype(s.element, t.element);
  }

  // ---- Function: contravariant params, covariant return ----
  if (s.tag === 'function' && t.tag === 'function') {
    if (s.params.length !== t.params.length) return false;
    // Contravariant in parameter types
    for (let i = 0; i < s.params.length; i++) {
      if (!isSubtype(t.params[i].type, s.params[i].type)) return false;
    }
    // Covariant in return type
    return isSubtype(s.returnType, t.returnType);
  }

  // ---- Tuple: element-wise covariance ----
  if (s.tag === 'tuple' && t.tag === 'tuple') {
    if (s.elements.length !== t.elements.length) return false;
    return s.elements.every((el, i) => isSubtype(el, t.elements[i]));
  }

  // ---- Union supertype: sub <: Union if sub <: some member ----
  if (t.tag === 'union') {
    return t.types.some(member => isSubtype(s, member));
  }

  // ---- Union subtype: Union <: T if every member <: T ----
  if (s.tag === 'union') {
    return s.types.every(member => isSubtype(member, t));
  }

  // ---- Intersection supertype: sub <: Intersection if sub <: every member ----
  if (t.tag === 'intersection') {
    return t.types.every(member => isSubtype(s, member));
  }

  // ---- Intersection subtype: Intersection <: T if some member <: T ----
  if (s.tag === 'intersection') {
    return s.types.some(member => isSubtype(member, t));
  }

  // ---- Confident: covariant in inner ----
  if (s.tag === 'confident' && t.tag === 'confident') {
    return isSubtype(s.inner, t.inner);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively resolve type aliases to their target types. */
function resolveAlias(t: AnimaType): AnimaType {
  if (t.tag === 'type_alias') return resolveAlias(t.target);
  return t;
}

/** Shallow structural equality (no subtyping, just shape match). */
function structurallyEqual(a: AnimaType, b: AnimaType): boolean {
  if (a.tag !== b.tag) return false;

  switch (a.tag) {
    // Primitive / singleton tags
    case 'int':
    case 'float':
    case 'string':
    case 'bool':
    case 'null':
    case 'unit':
    case 'any':
    case 'nothing':
    case 'nl':
    case 'unknown':
      return true;

    case 'nullable': {
      const bn = b as typeof a;
      return structurallyEqual(a.inner, bn.inner);
    }
    case 'list': {
      const bl = b as typeof a;
      return a.mutable === bl.mutable && structurallyEqual(a.element, bl.element);
    }
    case 'map': {
      const bm = b as typeof a;
      return (
        a.mutable === bm.mutable &&
        structurallyEqual(a.key, bm.key) &&
        structurallyEqual(a.value, bm.value)
      );
    }
    case 'set': {
      const bs = b as typeof a;
      return a.mutable === bs.mutable && structurallyEqual(a.element, bs.element);
    }
    case 'entity': {
      const be = b as typeof a;
      return a.name === be.name;
    }
    case 'sealed': {
      const bse = b as typeof a;
      return a.name === bse.name;
    }
    case 'interface': {
      const bi = b as typeof a;
      return a.name === bi.name;
    }
    case 'function': {
      const bf = b as typeof a;
      if (a.params.length !== bf.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!structurallyEqual(a.params[i].type, bf.params[i].type)) return false;
      }
      return structurallyEqual(a.returnType, bf.returnType);
    }
    case 'tuple': {
      const bt = b as typeof a;
      if (a.elements.length !== bt.elements.length) return false;
      return a.elements.every((el, i) => structurallyEqual(el, bt.elements[i]));
    }
    case 'union': {
      const bu = b as typeof a;
      if (a.types.length !== bu.types.length) return false;
      return a.types.every((t, i) => structurallyEqual(t, bu.types[i]));
    }
    case 'intersection': {
      const bx = b as typeof a;
      if (a.types.length !== bx.types.length) return false;
      return a.types.every((t, i) => structurallyEqual(t, bx.types[i]));
    }
    case 'generic': {
      const bg = b as typeof a;
      if (a.name !== bg.name) return false;
      if (a.bound && bg.bound) return structurallyEqual(a.bound, bg.bound);
      return !a.bound && !bg.bound;
    }
    case 'applied': {
      const ba = b as typeof a;
      if (a.args.length !== ba.args.length) return false;
      if (!structurallyEqual(a.base, ba.base)) return false;
      return a.args.every((arg, i) => structurallyEqual(arg, ba.args[i]));
    }
    case 'confident': {
      const bc = b as typeof a;
      return structurallyEqual(a.inner, bc.inner);
    }
    case 'type_alias': {
      const bta = b as typeof a;
      return a.name === bta.name && structurallyEqual(a.target, bta.target);
    }
  }
}
