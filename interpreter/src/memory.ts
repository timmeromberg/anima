/**
 * Memory and context system for the Anima interpreter.
 *
 * Three-tier memory:
 *   - Ephemeral: lives only during current function execution
 *   - Session: persists across the interpreter session (default)
 *   - Persistent: survives across sessions (backed by file storage)
 *
 * Memory entries support decay: entries that aren't accessed lose relevance
 * over time and are eventually garbage-collected.
 */

import {
  AnimaValue,
  mkString,
  mkFloat,
  mkNull,
  mkList,
  mkBool,
  mkUnit,
  mkInt,
  mkMap,
  valueToString,
} from './values';
import { getLLMAdapter } from './llm';
import { Environment } from './environment';

// ---------------------------------------------------------------------------
// Memory entry
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  key: string;
  value: AnimaValue;
  tier: 'ephemeral' | 'session' | 'persistent';
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  relevance: number; // 0–1, decays over time
  tags: string[];
}

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export class MemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private decayRate: number;
  private persistPath: string | null;

  constructor(options?: { decayRate?: number; persistPath?: string }) {
    this.decayRate = options?.decayRate ?? 0.01;
    this.persistPath = options?.persistPath ?? null;
    if (this.persistPath) {
      this.loadFromDisk();
    }
  }

  /** Store a value in memory. */
  store(key: string, value: AnimaValue, tier: 'ephemeral' | 'session' | 'persistent' = 'session', tags: string[] = []): void {
    const now = Date.now();
    this.entries.set(key, {
      key,
      value,
      tier,
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      relevance: 1.0,
      tags,
    });
    if (tier === 'persistent' && this.persistPath) {
      this.saveToDisk();
    }
  }

  /** Retrieve a value by exact key. */
  get(key: string): AnimaValue | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    entry.relevance = Math.min(1.0, entry.relevance + 0.1);
    return entry.value;
  }

  /** Recall memories matching a query (keyword-based). */
  recall(query: string, limit = 5): MemoryEntry[] {
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      let score = 0;
      const keyWords = entry.key.toLowerCase().split(/[\s_-]+/);
      const valueStr = valueToString(entry.value).toLowerCase();
      const tagStr = entry.tags.join(' ').toLowerCase();

      for (const qw of queryWords) {
        if (keyWords.some(kw => kw.includes(qw))) score += 2;
        if (valueStr.includes(qw)) score += 1;
        if (tagStr.includes(qw)) score += 1.5;
      }

      // Weight by relevance
      score *= entry.relevance;

      if (score > 0) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    // Touch accessed entries
    for (const { entry } of scored.slice(0, limit)) {
      entry.lastAccessed = Date.now();
      entry.accessCount++;
    }

    return scored.slice(0, limit).map(s => s.entry);
  }

  /** Remove a specific memory. */
  forget(key: string): boolean {
    const deleted = this.entries.delete(key);
    if (deleted && this.persistPath) {
      this.saveToDisk();
    }
    return deleted;
  }

  /** Apply decay to all memories, removing entries that fall below threshold. */
  decay(threshold = 0.05): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.tier === 'persistent') continue; // persistent entries don't decay

      const ageMs = now - entry.lastAccessed;
      const ageMinutes = ageMs / 60000;
      entry.relevance = Math.max(0, entry.relevance - (this.decayRate * ageMinutes));

      if (entry.relevance < threshold) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Clear ephemeral memories (called at function exit). */
  clearEphemeral(): void {
    for (const [key, entry] of this.entries) {
      if (entry.tier === 'ephemeral') {
        this.entries.delete(key);
      }
    }
  }

  /** Get all memory entries. */
  all(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get entry count. */
  get size(): number {
    return this.entries.size;
  }

  // ---------------------------------------------------------------------------
  // Persistence (simple JSON file)
  // ---------------------------------------------------------------------------

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const fs = require('fs');
      const persistEntries = this.all().filter(e => e.tier === 'persistent');
      const serializable = persistEntries.map(e => ({
        key: e.key,
        value: valueToString(e.value),
        tier: e.tier,
        createdAt: e.createdAt,
        lastAccessed: e.lastAccessed,
        accessCount: e.accessCount,
        relevance: e.relevance,
        tags: e.tags,
      }));
      fs.writeFileSync(this.persistPath, JSON.stringify(serializable, null, 2));
    } catch (_) { /* ignore write errors */ }
  }

  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.persistPath)) return;
      const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
      for (const entry of data) {
        this.entries.set(entry.key, {
          key: entry.key,
          value: mkString(entry.value),
          tier: entry.tier,
          createdAt: entry.createdAt,
          lastAccessed: entry.lastAccessed,
          accessCount: entry.accessCount,
          relevance: entry.relevance,
          tags: entry.tags || [],
        });
      }
    } catch (_) { /* ignore read errors */ }
  }
}

// ---------------------------------------------------------------------------
// Global memory store
// ---------------------------------------------------------------------------

let globalMemory = new MemoryStore();

export function getMemoryStore(): MemoryStore {
  return globalMemory;
}

export function setMemoryStore(store: MemoryStore): void {
  globalMemory = store;
}

// ---------------------------------------------------------------------------
// Builtin registrations for the interpreter
// ---------------------------------------------------------------------------

export function registerMemoryBuiltins(env: Environment): void {
  const { mkBuiltin } = require('./values');

  // remember(key, value) — store in session memory
  env.define('remember', mkBuiltin('remember', (args: AnimaValue[]) => {
    if (args.length < 2 || args[0].kind !== 'string') {
      throw new Error('remember(key: String, value) expected');
    }
    globalMemory.store(args[0].value, args[1], 'session');
    return mkUnit();
  }), false);

  // recall(query) — search memory by keyword
  env.define('recall', mkBuiltin('recall', (args: AnimaValue[]) => {
    if (args.length < 1 || args[0].kind !== 'string') {
      throw new Error('recall(query: String) expected');
    }
    const limit = args.length > 1 && args[1].kind === 'int' ? args[1].value : 5;
    const results = globalMemory.recall(args[0].value, limit);
    return mkList(results.map(e => {
      const entries = new Map<string, AnimaValue>();
      entries.set('key', mkString(e.key));
      entries.set('value', e.value);
      entries.set('relevance', mkFloat(e.relevance));
      entries.set('tier', mkString(e.tier));
      entries.set('accessCount', mkInt(e.accessCount));
      return mkMap(entries);
    }));
  }), false);

  // forget(key) — remove a memory
  env.define('forget', mkBuiltin('forget', (args: AnimaValue[]) => {
    if (args.length < 1 || args[0].kind !== 'string') {
      throw new Error('forget(key: String) expected');
    }
    return mkBool(globalMemory.forget(args[0].value));
  }), false);

  // persist(key, value) — store in persistent memory
  env.define('persist', mkBuiltin('persist', (args: AnimaValue[]) => {
    if (args.length < 2 || args[0].kind !== 'string') {
      throw new Error('persist(key: String, value) expected');
    }
    globalMemory.store(args[0].value, args[1], 'persistent');
    return mkUnit();
  }), false);
}
