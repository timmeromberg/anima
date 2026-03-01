/**
 * Standard library: Testing framework for the Anima language.
 *
 * Provides assert, assertEqual, assertNotEqual, assertThrows, and
 * test-runner utilities for writing Anima test programs.
 */

import { Environment } from '../environment';
import {
  AnimaValue,
  mkBuiltin,
  mkUnit,
  mkBool,
  mkString,
  valueToString,
  valuesEqual,
} from '../values';
import { AnimaRuntimeError } from '../errors';

/**
 * Register all test builtins into the given environment.
 */
export function registerTestBuiltins(env: Environment): void {
  // ---- assert(condition, message?) ----
  // Note: a basic `assert` already exists in core builtins.
  // This version is intentionally NOT re-registered (to avoid conflicts).
  // The core assert suffices. We add the more specific variants below.

  // ---- assertEqual(actual, expected, message?) ----

  env.define('assertEqual', mkBuiltin('assertEqual', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 2 || args.length > 3) {
      throw new AnimaRuntimeError('assertEqual() takes 2 or 3 arguments (actual, expected, message?)');
    }
    const actual = args[0];
    const expected = args[1];
    if (!valuesEqual(actual, expected)) {
      const msg = args.length === 3 && args[2].kind === 'string'
        ? args[2].value
        : `Assertion failed: expected ${valueToString(expected)}, got ${valueToString(actual)}`;
      throw new AnimaRuntimeError(msg);
    }
    return mkUnit();
  }), false);

  // ---- assertNotEqual(actual, expected, message?) ----

  env.define('assertNotEqual', mkBuiltin('assertNotEqual', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 2 || args.length > 3) {
      throw new AnimaRuntimeError('assertNotEqual() takes 2 or 3 arguments (actual, expected, message?)');
    }
    const actual = args[0];
    const expected = args[1];
    if (valuesEqual(actual, expected)) {
      const msg = args.length === 3 && args[2].kind === 'string'
        ? args[2].value
        : `Assertion failed: values should not be equal, but both are ${valueToString(actual)}`;
      throw new AnimaRuntimeError(msg);
    }
    return mkUnit();
  }), false);

  // ---- assertTrue(condition, message?) ----

  env.define('assertTrue', mkBuiltin('assertTrue', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 1 || args.length > 2) {
      throw new AnimaRuntimeError('assertTrue() takes 1 or 2 arguments (condition, message?)');
    }
    const cond = args[0];
    if (cond.kind !== 'bool' || !cond.value) {
      const msg = args.length === 2 && args[1].kind === 'string'
        ? args[1].value
        : `Assertion failed: expected true, got ${valueToString(cond)}`;
      throw new AnimaRuntimeError(msg);
    }
    return mkUnit();
  }), false);

  // ---- assertFalse(condition, message?) ----

  env.define('assertFalse', mkBuiltin('assertFalse', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 1 || args.length > 2) {
      throw new AnimaRuntimeError('assertFalse() takes 1 or 2 arguments (condition, message?)');
    }
    const cond = args[0];
    if (cond.kind !== 'bool' || cond.value) {
      const msg = args.length === 2 && args[1].kind === 'string'
        ? args[1].value
        : `Assertion failed: expected false, got ${valueToString(cond)}`;
      throw new AnimaRuntimeError(msg);
    }
    return mkUnit();
  }), false);

  // ---- assertNull(value, message?) ----

  env.define('assertNull', mkBuiltin('assertNull', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 1 || args.length > 2) {
      throw new AnimaRuntimeError('assertNull() takes 1 or 2 arguments (value, message?)');
    }
    if (args[0].kind !== 'null') {
      const msg = args.length === 2 && args[1].kind === 'string'
        ? args[1].value
        : `Assertion failed: expected null, got ${valueToString(args[0])}`;
      throw new AnimaRuntimeError(msg);
    }
    return mkUnit();
  }), false);

  // ---- assertNotNull(value, message?) ----

  env.define('assertNotNull', mkBuiltin('assertNotNull', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 1 || args.length > 2) {
      throw new AnimaRuntimeError('assertNotNull() takes 1 or 2 arguments (value, message?)');
    }
    if (args[0].kind === 'null') {
      const msg = args.length === 2 && args[1].kind === 'string'
        ? args[1].value
        : 'Assertion failed: expected non-null value';
      throw new AnimaRuntimeError(msg);
    }
    return mkUnit();
  }), false);

  // ---- assertThrows(fn) ----
  // Since Anima functions are values, the user passes a lambda.
  // We call it and expect it to throw.

  env.define('assertThrows', mkBuiltin('assertThrows', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 1 || args.length > 2) {
      throw new AnimaRuntimeError('assertThrows() takes 1 or 2 arguments (fn, message?)');
    }
    const fn = args[0];
    if (fn.kind !== 'function' && fn.kind !== 'builtin') {
      throw new AnimaRuntimeError('assertThrows() first argument must be a function');
    }
    // We cannot directly call the Anima function from here without
    // the interpreter context. Instead, we check if fn is callable
    // and handle the semantics: the function should be a zero-arg lambda.
    // For builtin functions, we can call them directly.
    if (fn.kind === 'builtin') {
      try {
        fn.fn([], new Map());
        // If no error thrown, the assertion fails
        const msg = args.length === 2 && args[1].kind === 'string'
          ? args[1].value
          : 'Assertion failed: expected function to throw, but it did not';
        throw new AnimaRuntimeError(msg);
      } catch (e) {
        if (e instanceof AnimaRuntimeError && e.message.includes('Assertion failed')) {
          throw e; // Re-throw our own assertion failure
        }
        // Any other error means the assertion passes
        return mkUnit();
      }
    }
    // For Anima function values, we store a sentinel. The interpreter
    // needs to handle this specially, but we provide the builtin wrapper.
    // As a practical approach, we'll return a string indicating the function
    // needs to be called by the interpreter. In practice, this gets wired
    // up by the interpreter when it encounters assertThrows calls.
    //
    // For now, throw with a descriptive message that the user passed a
    // non-builtin function, which the interpreter's call-site can handle.
    throw new AnimaRuntimeError(
      'assertThrows() with Anima function values requires interpreter support. ' +
      'Wrap the throwing code in a builtin or use try/catch directly.'
    );
  }), false);
}
