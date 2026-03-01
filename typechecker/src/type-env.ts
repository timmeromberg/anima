/**
 * Type environment for tracking type bindings during type checking.
 *
 * Environments form a chain via the `parent` pointer, enabling lexical scoping.
 * `lookup` walks up the chain; `define` only writes to the current scope.
 */

import { AnimaType } from './types';

export class TypeEnvironment {
  private bindings = new Map<string, AnimaType>();
  private typeAliases = new Map<string, AnimaType>();
  private parent: TypeEnvironment | null;

  constructor(parent?: TypeEnvironment) {
    this.parent = parent ?? null;
  }

  /** Bind a value-level name to a type in the current scope. */
  define(name: string, type: AnimaType): void {
    this.bindings.set(name, type);
  }

  /** Look up a value-level name, walking the parent chain. */
  lookup(name: string): AnimaType | null {
    const local = this.bindings.get(name);
    if (local !== undefined) return local;
    if (this.parent) return this.parent.lookup(name);
    return null;
  }

  /** Register a type alias (e.g. `type Alias = Int`) in the current scope. */
  defineTypeAlias(name: string, target: AnimaType): void {
    this.typeAliases.set(name, target);
  }

  /** Resolve a type alias by name, walking the parent chain. */
  resolveType(name: string): AnimaType | null {
    const local = this.typeAliases.get(name);
    if (local !== undefined) return local;
    if (this.parent) return this.parent.resolveType(name);
    return null;
  }

  /** Create a child scope whose parent is this environment. */
  child(): TypeEnvironment {
    return new TypeEnvironment(this);
  }
}
