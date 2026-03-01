/**
 * Standard library: I/O functions for the Anima language.
 *
 * Provides file I/O builtins and readline support.
 * Core I/O (println, print) is already in builtins.ts — this extends
 * with file system operations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Environment } from '../environment';
import {
  AnimaValue,
  mkBuiltin,
  mkString,
  mkUnit,
  mkBool,
  mkNull,
  valueToString,
} from '../values';
import { AnimaRuntimeError } from '../errors';

/**
 * Register all I/O builtins into the given environment.
 */
export function registerIOBuiltins(env: Environment): void {
  // ---- File I/O ----

  env.define('readFile', mkBuiltin('readFile', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('readFile() takes exactly 1 argument (path)');
    if (args[0].kind !== 'string') throw new AnimaRuntimeError('readFile() argument must be a String');
    const filePath = args[0].value;
    try {
      const resolved = path.resolve(filePath);
      const content = fs.readFileSync(resolved, 'utf-8');
      return mkString(content);
    } catch (e: any) {
      throw new AnimaRuntimeError(`readFile failed: ${e.message}`);
    }
  }), false);

  env.define('writeFile', mkBuiltin('writeFile', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('writeFile() takes exactly 2 arguments (path, content)');
    if (args[0].kind !== 'string') throw new AnimaRuntimeError('writeFile() first argument must be a String');
    const filePath = args[0].value;
    const content = valueToString(args[1]);
    try {
      const resolved = path.resolve(filePath);
      fs.writeFileSync(resolved, content, 'utf-8');
      return mkUnit();
    } catch (e: any) {
      throw new AnimaRuntimeError(`writeFile failed: ${e.message}`);
    }
  }), false);

  env.define('appendFile', mkBuiltin('appendFile', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 2) throw new AnimaRuntimeError('appendFile() takes exactly 2 arguments (path, content)');
    if (args[0].kind !== 'string') throw new AnimaRuntimeError('appendFile() first argument must be a String');
    const filePath = args[0].value;
    const content = valueToString(args[1]);
    try {
      const resolved = path.resolve(filePath);
      fs.appendFileSync(resolved, content, 'utf-8');
      return mkUnit();
    } catch (e: any) {
      throw new AnimaRuntimeError(`appendFile failed: ${e.message}`);
    }
  }), false);

  env.define('fileExists', mkBuiltin('fileExists', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('fileExists() takes exactly 1 argument (path)');
    if (args[0].kind !== 'string') throw new AnimaRuntimeError('fileExists() argument must be a String');
    return mkBool(fs.existsSync(path.resolve(args[0].value)));
  }), false);

  env.define('deleteFile', mkBuiltin('deleteFile', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('deleteFile() takes exactly 1 argument (path)');
    if (args[0].kind !== 'string') throw new AnimaRuntimeError('deleteFile() argument must be a String');
    try {
      fs.unlinkSync(path.resolve(args[0].value));
      return mkUnit();
    } catch (e: any) {
      throw new AnimaRuntimeError(`deleteFile failed: ${e.message}`);
    }
  }), false);

  // ---- Readline (synchronous) ----

  env.define('readLine', mkBuiltin('readLine', (args: AnimaValue[]): AnimaValue => {
    // Prompt is optional
    if (args.length > 1) throw new AnimaRuntimeError('readLine() takes 0 or 1 argument (prompt?)');
    if (args.length === 1) {
      process.stdout.write(valueToString(args[0]));
    }
    // Synchronous stdin read
    const buf = Buffer.alloc(1024);
    try {
      const fd = fs.openSync('/dev/stdin', 'rs');
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
      fs.closeSync(fd);
      const line = buf.slice(0, bytesRead).toString('utf-8').replace(/\n$/, '');
      return mkString(line);
    } catch {
      return mkNull();
    }
  }), false);

  // ---- Environment ----

  env.define('getEnv', mkBuiltin('getEnv', (args: AnimaValue[]): AnimaValue => {
    if (args.length !== 1) throw new AnimaRuntimeError('getEnv() takes exactly 1 argument (name)');
    if (args[0].kind !== 'string') throw new AnimaRuntimeError('getEnv() argument must be a String');
    const val = process.env[args[0].value];
    return val !== undefined ? mkString(val) : mkNull();
  }), false);
}
