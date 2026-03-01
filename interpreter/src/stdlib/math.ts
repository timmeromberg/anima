/**
 * Standard library: Math functions for the Anima language.
 *
 * Provides mathematical builtins including trig, rounding, logarithmic,
 * and power functions, plus PI and E constants.
 *
 * Note: abs, min, max are already defined in core builtins (builtins.ts).
 * This module adds the extended math functions.
 */

import { Environment } from '../environment';
import {
  AnimaValue,
  mkBuiltin,
  mkInt,
  mkFloat,
  asNumber,
} from '../values';
import { AnimaRuntimeError, AnimaTypeError } from '../errors';

/**
 * Register all math builtins into the given environment.
 */
export function registerMathBuiltins(env: Environment): void {
  // ---- Constants ----

  env.define('PI', mkFloat(Math.PI), false);
  env.define('E', mkFloat(Math.E), false);

  // ---- Rounding ----

  env.define('floor', mkBuiltin('floor', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('floor() takes exactly 1 argument');
    return mkInt(Math.floor(asNumber(args[0])));
  }), false);

  env.define('ceil', mkBuiltin('ceil', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('ceil() takes exactly 1 argument');
    return mkInt(Math.ceil(asNumber(args[0])));
  }), false);

  env.define('round', mkBuiltin('round', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('round() takes exactly 1 argument');
    return mkInt(Math.round(asNumber(args[0])));
  }), false);

  // ---- Power / Roots / Logarithms ----

  env.define('sqrt', mkBuiltin('sqrt', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('sqrt() takes exactly 1 argument');
    const n = asNumber(args[0]);
    if (n < 0) throw new AnimaRuntimeError('sqrt() argument must be non-negative');
    return mkFloat(Math.sqrt(n));
  }), false);

  env.define('pow', mkBuiltin('pow', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('pow() takes exactly 2 arguments (base, exp)');
    const base = asNumber(args[0]);
    const exp = asNumber(args[1]);
    const result = Math.pow(base, exp);
    // If both args are ints and exp >= 0 and result is integer, return Int
    if (args[0].kind === 'int' && args[1].kind === 'int' && exp >= 0 && Number.isInteger(result)) {
      return mkInt(result);
    }
    return mkFloat(result);
  }), false);

  env.define('log', mkBuiltin('log', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('log() takes exactly 1 argument');
    const n = asNumber(args[0]);
    if (n <= 0) throw new AnimaRuntimeError('log() argument must be positive');
    return mkFloat(Math.log(n));
  }), false);

  env.define('log10', mkBuiltin('log10', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('log10() takes exactly 1 argument');
    const n = asNumber(args[0]);
    if (n <= 0) throw new AnimaRuntimeError('log10() argument must be positive');
    return mkFloat(Math.log10(n));
  }), false);

  env.define('log2', mkBuiltin('log2', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('log2() takes exactly 1 argument');
    const n = asNumber(args[0]);
    if (n <= 0) throw new AnimaRuntimeError('log2() argument must be positive');
    return mkFloat(Math.log2(n));
  }), false);

  // ---- Trigonometry ----

  env.define('sin', mkBuiltin('sin', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('sin() takes exactly 1 argument');
    return mkFloat(Math.sin(asNumber(args[0])));
  }), false);

  env.define('cos', mkBuiltin('cos', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('cos() takes exactly 1 argument');
    return mkFloat(Math.cos(asNumber(args[0])));
  }), false);

  env.define('tan', mkBuiltin('tan', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('tan() takes exactly 1 argument');
    return mkFloat(Math.tan(asNumber(args[0])));
  }), false);

  env.define('asin', mkBuiltin('asin', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('asin() takes exactly 1 argument');
    const n = asNumber(args[0]);
    if (n < -1 || n > 1) throw new AnimaRuntimeError('asin() argument must be in [-1, 1]');
    return mkFloat(Math.asin(n));
  }), false);

  env.define('acos', mkBuiltin('acos', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('acos() takes exactly 1 argument');
    const n = asNumber(args[0]);
    if (n < -1 || n > 1) throw new AnimaRuntimeError('acos() argument must be in [-1, 1]');
    return mkFloat(Math.acos(n));
  }), false);

  env.define('atan', mkBuiltin('atan', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('atan() takes exactly 1 argument');
    return mkFloat(Math.atan(asNumber(args[0])));
  }), false);

  env.define('atan2', mkBuiltin('atan2', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('atan2() takes exactly 2 arguments (y, x)');
    return mkFloat(Math.atan2(asNumber(args[0]), asNumber(args[1])));
  }), false);

  // ---- Misc ----

  env.define('random', mkBuiltin('random', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 0) throw new AnimaRuntimeError('random() takes no arguments');
    return mkFloat(Math.random());
  }), false);

  env.define('randomInt', mkBuiltin('randomInt', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('randomInt() takes exactly 2 arguments (min, max)');
    const lo = asNumber(args[0]);
    const hi = asNumber(args[1]);
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new AnimaTypeError('randomInt() arguments must be integers');
    }
    return mkInt(Math.floor(Math.random() * (hi - lo + 1)) + lo);
  }), false);
}
