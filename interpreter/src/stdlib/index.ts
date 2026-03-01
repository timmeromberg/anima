/**
 * Anima Standard Library — barrel module.
 *
 * Registers all stdlib modules into the interpreter environment.
 * Individual register functions are also exported for selective use.
 */

import { Environment } from '../environment';
import { registerMathBuiltins } from './math';
import { registerIOBuiltins } from './io';
import { registerCollectionBuiltins } from './collections';
import { registerTestBuiltins } from './test';
import { registerStringBuiltins } from './string';

export { registerMathBuiltins } from './math';
export { registerIOBuiltins } from './io';
export { registerCollectionBuiltins } from './collections';
export { registerTestBuiltins } from './test';
export { registerStringBuiltins } from './string';

/**
 * Register the entire standard library into the given environment.
 */
export function registerStdlib(env: Environment): void {
  registerMathBuiltins(env);
  registerIOBuiltins(env);
  registerCollectionBuiltins(env);
  registerTestBuiltins(env);
  registerStringBuiltins(env);
}
