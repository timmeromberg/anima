/**
 * Built-in functions for the Anima interpreter.
 */

import { Environment } from './environment';
import {
  AnimaValue,
  mkBuiltin,
  mkInt,
  mkFloat,
  mkString,
  mkBool,
  mkNull,
  mkUnit,
  mkList,
  mkMap,
  valueToString,
  asNumber,
} from './values';
import { AnimaRuntimeError, AnimaTypeError } from './errors';

/**
 * Register all built-in functions into the given environment.
 */
export function registerBuiltins(env: Environment): void {
  // ---- I/O ----

  env.define('println', mkBuiltin('println', (args: AnimaValue[]): AnimaValue => {
    const output = args.map(valueToString).join(' ');
    process.stdout.write(output + '\n');
    return mkUnit();
  }), false);

  env.define('print', mkBuiltin('print', (args: AnimaValue[]): AnimaValue => {
    const output = args.map(valueToString).join(' ');
    process.stdout.write(output);
    return mkUnit();
  }), false);

  // ---- Collection constructors ----

  env.define('listOf', mkBuiltin('listOf', (args: AnimaValue[]): AnimaValue => {
    return mkList([...args], false);
  }), false);

  env.define('mutableListOf', mkBuiltin('mutableListOf', (args: AnimaValue[]): AnimaValue => {
    return mkList([...args], true);
  }), false);

  env.define('mapOf', mkBuiltin('mapOf', (args: AnimaValue[]): AnimaValue => {
    // mapOf expects pairs created with 'to' operator (stored as 2-element lists)
    // or named arguments handled at the call site
    const entries = new Map<string, AnimaValue>();
    for (const arg of args) {
      if (arg.kind === 'list' && arg.elements.length === 2) {
        const key = valueToString(arg.elements[0]);
        entries.set(key, arg.elements[1]);
      } else {
        throw new AnimaTypeError('mapOf expects pairs (key to value)');
      }
    }
    return mkMap(entries, false);
  }), false);

  env.define('mutableMapOf', mkBuiltin('mutableMapOf', (args: AnimaValue[]): AnimaValue => {
    const entries = new Map<string, AnimaValue>();
    for (const arg of args) {
      if (arg.kind === 'list' && arg.elements.length === 2) {
        const key = valueToString(arg.elements[0]);
        entries.set(key, arg.elements[1]);
      } else {
        throw new AnimaTypeError('mutableMapOf expects pairs (key to value)');
      }
    }
    return mkMap(entries, true);
  }), false);

  // ---- Type conversion ----

  env.define('toString', mkBuiltin('toString', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('toString() takes exactly 1 argument');
    return mkString(valueToString(args[0]));
  }), false);

  env.define('toInt', mkBuiltin('toInt', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('toInt() takes exactly 1 argument');
    const v = args[0];
    switch (v.kind) {
      case 'int': return v;
      case 'float': return mkInt(Math.trunc(v.value));
      case 'string': {
        const n = parseInt(v.value, 10);
        if (isNaN(n)) throw new AnimaRuntimeError(`Cannot convert '${v.value}' to Int`);
        return mkInt(n);
      }
      case 'bool': return mkInt(v.value ? 1 : 0);
      default: throw new AnimaTypeError(`Cannot convert ${v.kind} to Int`);
    }
  }), false);

  env.define('toFloat', mkBuiltin('toFloat', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('toFloat() takes exactly 1 argument');
    const v = args[0];
    switch (v.kind) {
      case 'float': return v;
      case 'int': return mkFloat(v.value);
      case 'string': {
        const n = parseFloat(v.value);
        if (isNaN(n)) throw new AnimaRuntimeError(`Cannot convert '${v.value}' to Float`);
        return mkFloat(n);
      }
      default: throw new AnimaTypeError(`Cannot convert ${v.kind} to Float`);
    }
  }), false);

  // ---- Collection operations ----

  env.define('size', mkBuiltin('size', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('size() takes exactly 1 argument');
    const v = args[0];
    switch (v.kind) {
      case 'list': return mkInt(v.elements.length);
      case 'map': return mkInt(v.entries.size);
      case 'string': return mkInt(v.value.length);
      default: throw new AnimaTypeError(`Cannot get size of ${v.kind}`);
    }
  }), false);

  env.define('isEmpty', mkBuiltin('isEmpty', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('isEmpty() takes exactly 1 argument');
    const v = args[0];
    switch (v.kind) {
      case 'list': return mkBool(v.elements.length === 0);
      case 'map': return mkBool(v.entries.size === 0);
      case 'string': return mkBool(v.value.length === 0);
      default: throw new AnimaTypeError(`Cannot check isEmpty on ${v.kind}`);
    }
  }), false);

  // ---- Math ----

  env.define('abs', mkBuiltin('abs', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('abs() takes exactly 1 argument');
    const v = args[0];
    if (v.kind === 'int') return mkInt(Math.abs(v.value));
    if (v.kind === 'float') return mkFloat(Math.abs(v.value));
    throw new AnimaTypeError(`abs() expects a number, got ${v.kind}`);
  }), false);

  env.define('min', mkBuiltin('min', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 2) throw new AnimaRuntimeError('min() takes at least 2 arguments');
    let result = asNumber(args[0]);
    let isFloat = args[0].kind === 'float';
    for (let i = 1; i < args.length; i++) {
      const n = asNumber(args[i]);
      if (args[i].kind === 'float') isFloat = true;
      if (n < result) result = n;
    }
    return isFloat ? mkFloat(result) : mkInt(result);
  }), false);

  env.define('max', mkBuiltin('max', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 2) throw new AnimaRuntimeError('max() takes at least 2 arguments');
    let result = asNumber(args[0]);
    let isFloat = args[0].kind === 'float';
    for (let i = 1; i < args.length; i++) {
      const n = asNumber(args[i]);
      if (args[i].kind === 'float') isFloat = true;
      if (n > result) result = n;
    }
    return isFloat ? mkFloat(result) : mkInt(result);
  }), false);

  // ---- Utility ----

  env.define('typeof', mkBuiltin('typeof', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('typeof() takes exactly 1 argument');
    return mkString(args[0].kind.charAt(0).toUpperCase() + args[0].kind.slice(1));
  }), false);

  env.define('assert', mkBuiltin('assert', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 1) throw new AnimaRuntimeError('assert() takes at least 1 argument');
    const condition = args[0];
    if (condition.kind !== 'bool' || !condition.value) {
      const msg = args.length > 1 && args[1].kind === 'string'
        ? args[1].value
        : 'Assertion failed';
      throw new AnimaRuntimeError(msg);
    }
    return mkUnit();
  }), false);

  env.define('error', mkBuiltin('error', (args: AnimaValue[]): AnimaValue => {
    const msg = args.length > 0 ? valueToString(args[0]) : 'error';
    throw new AnimaRuntimeError(msg);
  }), false);
}
