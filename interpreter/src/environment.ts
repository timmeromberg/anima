/**
 * Lexical scoping environment for the Anima interpreter.
 *
 * Each environment holds a map of variable bindings and a reference
 * to its parent scope. Variables are either mutable (var) or
 * immutable (val).
 */

import { AnimaValue } from './values';
import { AnimaNameError, AnimaImmutableError, AnimaRuntimeError } from './errors';

interface Binding {
  value: AnimaValue;
  mutable: boolean;
}

export class Environment {
  private vars: Map<string, Binding>;
  private parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.vars = new Map();
    this.parent = parent;
  }

  /**
   * Look up a variable by name, traversing the parent chain.
   */
  get(name: string): AnimaValue {
    const binding = this.vars.get(name);
    if (binding !== undefined) {
      return binding.value;
    }
    if (this.parent !== null) {
      return this.parent.get(name);
    }
    throw new AnimaNameError(name);
  }

  /**
   * Check if a variable is defined in this environment or any parent.
   */
  has(name: string): boolean {
    if (this.vars.has(name)) return true;
    if (this.parent !== null) return this.parent.has(name);
    return false;
  }

  /**
   * Reassign a variable (must be mutable and already defined).
   */
  set(name: string, value: AnimaValue): void {
    const binding = this.vars.get(name);
    if (binding !== undefined) {
      if (!binding.mutable) {
        throw new AnimaImmutableError(name);
      }
      binding.value = value;
      return;
    }
    if (this.parent !== null) {
      this.parent.set(name, value);
      return;
    }
    throw new AnimaNameError(name);
  }

  /**
   * Define a new variable in the current scope.
   */
  define(name: string, value: AnimaValue, mutable: boolean): void {
    if (this.vars.has(name)) {
      throw new AnimaRuntimeError(`Variable '${name}' is already defined in this scope`);
    }
    this.vars.set(name, { value, mutable });
  }

  /**
   * Define or overwrite a variable (used for builtins and function re-definitions).
   */
  defineOrUpdate(name: string, value: AnimaValue, mutable: boolean): void {
    this.vars.set(name, { value, mutable });
  }

  /**
   * Create a child scope.
   */
  child(): Environment {
    return new Environment(this);
  }
}
