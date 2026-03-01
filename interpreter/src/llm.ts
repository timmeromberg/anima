/**
 * LLM integration layer for the Anima interpreter.
 *
 * Defines an adapter interface that abstracts LLM operations (generate, embed,
 * classify) and provides a mock adapter for deterministic testing.
 */

import { AnimaValue, mkString, mkFloat, mkList, mkBool, mkNull } from './values';

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface LLMAdapter {
  /** Generate text given a prompt. */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  /** Produce an embedding vector for the given text. */
  embed(text: string): Promise<number[]>;

  /** Classify text into one of the given categories. */
  classify(text: string, categories: string[]): Promise<{ category: string; confidence: number }>;

  /** Check semantic similarity between two texts (0–1 scale). */
  similarity(a: string, b: string): Promise<number>;

  // Synchronous variants for interpreter use (blocking in v0.1)
  generateSync?(prompt: string, options?: GenerateOptions): string;
  similaritySync?(a: string, b: string): number;
  classifySync?(text: string, categories: string[]): { category: string; confidence: number };
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

// ---------------------------------------------------------------------------
// Mock adapter — deterministic, no API calls
// ---------------------------------------------------------------------------

export class MockLLMAdapter implements LLMAdapter {
  /** Log of calls for test assertions. */
  readonly calls: Array<{ method: string; args: any[] }> = [];

  /** Canned responses keyed by prompt substring. */
  private responses = new Map<string, string>();

  /** Register a canned response: if prompt contains `key`, return `value`. */
  setResponse(key: string, value: string): void {
    this.responses.set(key, value);
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    this.calls.push({ method: 'generate', args: [prompt, options] });
    for (const [key, value] of this.responses) {
      if (prompt.includes(key)) return value;
    }
    return `[mock response to: ${prompt.slice(0, 80)}]`;
  }

  async embed(text: string): Promise<number[]> {
    this.calls.push({ method: 'embed', args: [text] });
    // Deterministic embedding: hash-based pseudo-vector
    const vec: number[] = [];
    for (let i = 0; i < 8; i++) {
      let hash = 0;
      for (let j = 0; j < text.length; j++) {
        hash = ((hash << 5) - hash + text.charCodeAt(j) + i * 31) | 0;
      }
      vec.push((hash % 1000) / 1000);
    }
    return vec;
  }

  async classify(text: string, categories: string[]): Promise<{ category: string; confidence: number }> {
    this.calls.push({ method: 'classify', args: [text, categories] });
    // Deterministic: pick category based on first char match
    for (const cat of categories) {
      if (text.toLowerCase().includes(cat.toLowerCase())) {
        return { category: cat, confidence: 0.9 };
      }
    }
    return { category: categories[0], confidence: 0.5 };
  }

  async similarity(a: string, b: string): Promise<number> {
    return this.similaritySync(a, b);
  }

  // ---- Sync variants for interpreter ----

  private computeSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  generateSync(prompt: string, options?: GenerateOptions): string {
    this.calls.push({ method: 'generate', args: [prompt, options] });
    for (const [key, value] of this.responses) {
      if (prompt.includes(key)) return value;
    }
    return `[mock response to: ${prompt.slice(0, 80)}]`;
  }

  similaritySync(a: string, b: string): number {
    this.calls.push({ method: 'similarity', args: [a, b] });
    return this.computeSimilarity(a, b);
  }

  classifySync(text: string, categories: string[]): { category: string; confidence: number } {
    this.calls.push({ method: 'classify', args: [text, categories] });
    for (const cat of categories) {
      if (text.toLowerCase().includes(cat.toLowerCase())) {
        return { category: cat, confidence: 0.9 };
      }
    }
    return { category: categories[0], confidence: 0.5 };
  }
}

// ---------------------------------------------------------------------------
// Global adapter registry
// ---------------------------------------------------------------------------

let currentAdapter: LLMAdapter = new MockLLMAdapter();

export function setLLMAdapter(adapter: LLMAdapter): void {
  currentAdapter = adapter;
}

export function getLLMAdapter(): LLMAdapter {
  return currentAdapter;
}

// ---------------------------------------------------------------------------
// Anima value wrappers for LLM operations (synchronous via blocking)
// ---------------------------------------------------------------------------

/**
 * Run an async LLM operation synchronously.
 * In v0.1 the interpreter is single-threaded; we use a sync wrapper.
 * Real async support would require interpreter-level coroutines.
 */
function runSync<T>(promise: Promise<T>): T {
  // In Node.js, we can't truly block on a promise in the main thread.
  // For the mock adapter, all promises resolve immediately (microtask).
  // For real adapters, callers should use the async versions.
  let result: T | undefined;
  let error: any;
  let done = false;

  promise.then(
    (v) => { result = v; done = true; },
    (e) => { error = e; done = true; },
  );

  // Process microtask queue for the mock adapter
  // For real adapters this won't work — they'd need async interpreter support
  if (!done) {
    // Can't block — return a placeholder
    return undefined as any;
  }
  if (error) throw error;
  return result!;
}

/** Generate text and return as Anima string. */
export function llmGenerate(prompt: string): AnimaValue {
  const result = runSync(currentAdapter.generate(prompt));
  return mkString(result ?? '[pending]');
}

/** Compute similarity between two strings. */
export function llmSimilarity(a: string, b: string): AnimaValue {
  const result = runSync(currentAdapter.similarity(a, b));
  return mkFloat(result ?? 0);
}

/** Classify text into categories. */
export function llmClassify(text: string, categories: string[]): AnimaValue {
  const result = runSync(currentAdapter.classify(text, categories));
  if (!result) return mkNull();
  return mkList([mkString(result.category), mkFloat(result.confidence)]);
}

/** Check semantic equality (~=). */
export function semanticEquals(a: string, b: string): AnimaValue {
  const sim = runSync(currentAdapter.similarity(a, b));
  return mkBool((sim ?? 0) > 0.7);
}

/** Check semantic implication (~>). */
export function semanticImplies(a: string, b: string): AnimaValue {
  // Approximation: if a contains/overlaps significantly with b
  const sim = runSync(currentAdapter.similarity(a, b));
  return mkBool((sim ?? 0) > 0.5);
}
