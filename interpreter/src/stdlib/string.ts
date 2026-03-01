/**
 * Standard library: String utilities for the Anima language.
 *
 * Provides string manipulation builtins beyond the basic toString.
 */

import { Environment } from '../environment';
import {
  AnimaValue,
  mkBuiltin,
  mkString,
  mkInt,
  mkBool,
  mkList,
} from '../values';
import { AnimaRuntimeError, AnimaTypeError } from '../errors';

function expectString(name: string, v: AnimaValue): string {
  if (v.kind !== 'string') throw new AnimaTypeError(`${name} expects a String argument`);
  return v.value;
}

/**
 * Register all string builtins into the given environment.
 */
export function registerStringBuiltins(env: Environment): void {
  env.define('trim', mkBuiltin('trim', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('trim() takes exactly 1 argument');
    return mkString(expectString('trim()', args[0]).trim());
  }), false);

  env.define('uppercase', mkBuiltin('uppercase', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('uppercase() takes exactly 1 argument');
    return mkString(expectString('uppercase()', args[0]).toUpperCase());
  }), false);

  env.define('lowercase', mkBuiltin('lowercase', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('lowercase() takes exactly 1 argument');
    return mkString(expectString('lowercase()', args[0]).toLowerCase());
  }), false);

  env.define('startsWith', mkBuiltin('startsWith', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('startsWith() takes exactly 2 arguments (str, prefix)');
    const s = expectString('startsWith()', args[0]);
    const prefix = expectString('startsWith()', args[1]);
    return mkBool(s.startsWith(prefix));
  }), false);

  env.define('endsWith', mkBuiltin('endsWith', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('endsWith() takes exactly 2 arguments (str, suffix)');
    const s = expectString('endsWith()', args[0]);
    const suffix = expectString('endsWith()', args[1]);
    return mkBool(s.endsWith(suffix));
  }), false);

  env.define('split', mkBuiltin('split', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('split() takes exactly 2 arguments (str, delimiter)');
    const s = expectString('split()', args[0]);
    const delim = expectString('split()', args[1]);
    const parts = s.split(delim).map(p => mkString(p));
    return mkList(parts, false);
  }), false);

  env.define('join', mkBuiltin('join', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('join() takes exactly 2 arguments (list, separator)');
    if (args[0].kind !== 'list') throw new AnimaTypeError('join() first argument must be a list');
    const sep = expectString('join()', args[1]);
    const result = args[0].elements.map(el => {
      if (el.kind !== 'string') throw new AnimaTypeError('join() list elements must be strings');
      return el.value;
    }).join(sep);
    return mkString(result);
  }), false);

  env.define('replace', mkBuiltin('replace', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 3) throw new AnimaRuntimeError('replace() takes exactly 3 arguments (str, from, to)');
    const s = expectString('replace()', args[0]);
    const from = expectString('replace()', args[1]);
    const to = expectString('replace()', args[2]);
    return mkString(s.split(from).join(to));
  }), false);

  env.define('substring', mkBuiltin('substring', (args: AnimaValue[]): AnimaValue => {
    if (args.length < 2 || args.length > 3) {
      throw new AnimaRuntimeError('substring() takes 2 or 3 arguments (str, start, end?)');
    }
    const s = expectString('substring()', args[0]);
    if (args[1].kind !== 'int') throw new AnimaTypeError('substring() start must be an Int');
    const start = args[1].value;
    let end = s.length;
    if (args.length === 3) {
      if (args[2].kind !== 'int') throw new AnimaTypeError('substring() end must be an Int');
      end = args[2].value;
    }
    return mkString(s.substring(start, end));
  }), false);

  env.define('charAt', mkBuiltin('charAt', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('charAt() takes exactly 2 arguments (str, index)');
    const s = expectString('charAt()', args[0]);
    if (args[1].kind !== 'int') throw new AnimaTypeError('charAt() index must be an Int');
    const idx = args[1].value;
    if (idx < 0 || idx >= s.length) {
      throw new AnimaRuntimeError(`charAt() index ${idx} out of bounds for string of length ${s.length}`);
    }
    return mkString(s[idx]);
  }), false);

  env.define('strContains', mkBuiltin('strContains', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('strContains() takes exactly 2 arguments (str, substr)');
    const s = expectString('strContains()', args[0]);
    const sub = expectString('strContains()', args[1]);
    return mkBool(s.includes(sub));
  }), false);

  env.define('strLength', mkBuiltin('strLength', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('strLength() takes exactly 1 argument');
    return mkInt(expectString('strLength()', args[0]).length);
  }), false);
}
