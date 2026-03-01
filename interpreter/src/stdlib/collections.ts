/**
 * Standard library: Collection utilities for the Anima language.
 *
 * Provides range, repeat, zip, flatten, and other functional
 * collection operations.
 */

import { Environment } from '../environment';
import {
  AnimaValue,
  mkBuiltin,
  mkInt,
  mkList,
  mkBool,
  asNumber,
  valuesEqual,
  valueToString,
} from '../values';
import { AnimaRuntimeError, AnimaTypeError } from '../errors';

/**
 * Register all collection builtins into the given environment.
 */
export function registerCollectionBuiltins(env: Environment): void {
  // ---- range(start, end, step?) ----

  env.define('range', mkBuiltin('range', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 1 || args.length > 3) {
      throw new AnimaRuntimeError('range() takes 1 to 3 arguments (end) or (start, end) or (start, end, step)');
    }

    let start: number, end: number, step: number;

    if (args.length === 1) {
      // range(end) -> 0 until end
      start = 0;
      end = asNumber(args[0]);
      step = 1;
    } else if (args.length === 2) {
      // range(start, end)
      start = asNumber(args[0]);
      end = asNumber(args[1]);
      step = start <= end ? 1 : -1;
    } else {
      // range(start, end, step)
      start = asNumber(args[0]);
      end = asNumber(args[1]);
      step = asNumber(args[2]);
    }

    if (step === 0) throw new AnimaRuntimeError('range() step cannot be 0');

    const elements: AnimaValue[] = [];
    if (step > 0) {
      for (let i = start; i < end; i += step) {
        elements.push(mkInt(i));
      }
    } else {
      for (let i = start; i > end; i += step) {
        elements.push(mkInt(i));
      }
    }

    return mkList(elements, false);
  }), false);

  // ---- repeat(value, count) ----

  env.define('repeat', mkBuiltin('repeat', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('repeat() takes exactly 2 arguments (value, count)');
    const count = asNumber(args[1]);
    if (!Number.isInteger(count) || count < 0) {
      throw new AnimaRuntimeError('repeat() count must be a non-negative integer');
    }
    const elements: AnimaValue[] = [];
    for (let i = 0; i < count; i++) {
      elements.push(args[0]);
    }
    return mkList(elements, false);
  }), false);

  // ---- zip(list1, list2) ----

  env.define('zip', mkBuiltin('zip', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('zip() takes exactly 2 arguments (list1, list2)');
    if (args[0].kind !== 'list' || args[1].kind !== 'list') {
      throw new AnimaTypeError('zip() arguments must be lists');
    }
    const a = args[0].elements;
    const b = args[1].elements;
    const len = Math.min(a.length, b.length);
    const pairs: AnimaValue[] = [];
    for (let i = 0; i < len; i++) {
      pairs.push(mkList([a[i], b[i]], false));
    }
    return mkList(pairs, false);
  }), false);

  // ---- flatten(listOfLists) ----

  env.define('flatten', mkBuiltin('flatten', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('flatten() takes exactly 1 argument');
    if (args[0].kind !== 'list') throw new AnimaTypeError('flatten() argument must be a list');
    const elements: AnimaValue[] = [];
    for (const item of args[0].elements) {
      if (item.kind === 'list') {
        elements.push(...item.elements);
      } else {
        elements.push(item);
      }
    }
    return mkList(elements, false);
  }), false);

  // ---- sorted(list, comparator?) ----

  env.define('sorted', mkBuiltin('sorted', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('sorted() takes exactly 1 argument');
    if (args[0].kind !== 'list') throw new AnimaTypeError('sorted() argument must be a list');
    const copy = [...args[0].elements];
    copy.sort((a, b) => {
      try {
        const na = asNumber(a);
        const nb = asNumber(b);
        return na - nb;
      } catch {
        // Fall back to string comparison
        return valueToString(a).localeCompare(valueToString(b));
      }
    });
    return mkList(copy, false);
  }), false);

  // ---- reversed(list) ----

  env.define('reversed', mkBuiltin('reversed', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('reversed() takes exactly 1 argument');
    if (args[0].kind !== 'list') throw new AnimaTypeError('reversed() argument must be a list');
    return mkList([...args[0].elements].reverse(), false);
  }), false);

  // ---- contains(list, element) ----

  env.define('contains', mkBuiltin('contains', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('contains() takes exactly 2 arguments (list, element)');
    if (args[0].kind !== 'list') throw new AnimaTypeError('contains() first argument must be a list');
    const found = args[0].elements.some(el => valuesEqual(el, args[1]));
    return mkBool(found);
  }), false);

  // ---- indexOf(list, element) ----

  env.define('indexOf', mkBuiltin('indexOf', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('indexOf() takes exactly 2 arguments (list, element)');
    if (args[0].kind !== 'list') throw new AnimaTypeError('indexOf() first argument must be a list');
    const idx = args[0].elements.findIndex(el => valuesEqual(el, args[1]));
    return mkInt(idx);
  }), false);

  // ---- sum(list) ----

  env.define('sum', mkBuiltin('sum', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('sum() takes exactly 1 argument');
    if (args[0].kind !== 'list') throw new AnimaTypeError('sum() argument must be a list');
    let total = 0;
    let isFloat = false;
    for (const el of args[0].elements) {
      total += asNumber(el);
      if (el.kind === 'float') isFloat = true;
    }
    return isFloat ? { kind: 'float', value: total } : mkInt(total);
  }), false);

  // ---- distinct(list) ----

  env.define('distinct', mkBuiltin('distinct', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('distinct() takes exactly 1 argument');
    if (args[0].kind !== 'list') throw new AnimaTypeError('distinct() argument must be a list');
    const unique: AnimaValue[] = [];
    for (const el of args[0].elements) {
      if (!unique.some(existing => valuesEqual(existing, el))) {
        unique.push(el);
      }
    }
    return mkList(unique, false);
  }), false);

  // ---- first(list) / last(list) ----

  env.define('first', mkBuiltin('first', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('first() takes exactly 1 argument');
    if (args[0].kind !== 'list') throw new AnimaTypeError('first() argument must be a list');
    if (args[0].elements.length === 0) throw new AnimaRuntimeError('first() called on empty list');
    return args[0].elements[0];
  }), false);

  env.define('last', mkBuiltin('last', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('last() takes exactly 1 argument');
    if (args[0].kind !== 'list') throw new AnimaTypeError('last() argument must be a list');
    if (args[0].elements.length === 0) throw new AnimaRuntimeError('last() called on empty list');
    return args[0].elements[args[0].elements.length - 1];
  }), false);

  // ---- take(list, n) / drop(list, n) ----

  env.define('take', mkBuiltin('take', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('take() takes exactly 2 arguments (list, count)');
    if (args[0].kind !== 'list') throw new AnimaTypeError('take() first argument must be a list');
    const n = asNumber(args[1]);
    return mkList(args[0].elements.slice(0, Math.max(0, n)), false);
  }), false);

  env.define('drop', mkBuiltin('drop', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('drop() takes exactly 2 arguments (list, count)');
    if (args[0].kind !== 'list') throw new AnimaTypeError('drop() first argument must be a list');
    const n = asNumber(args[1]);
    return mkList(args[0].elements.slice(Math.max(0, n)), false);
  }), false);
}
