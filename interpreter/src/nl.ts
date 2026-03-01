/**
 * Natural Language (NL) types for the Anima interpreter.
 *
 * NL values wrap strings with semantic operations:
 *   - ~= (semantic equality): checks if two NL values mean the same thing
 *   - ~> (semantic implication): checks if one implies the other
 *   - <~ (semantic containment): checks if one is contained in the other
 *   - .entities: extracts named entities from the text
 *   - .clarify(): asks the LLM to clarify/rephrase the text
 *   - .summarize(): asks the LLM to summarize the text
 *   - .classify(categories): classifies the text into categories
 *   - .operations: lists available NL operations
 *
 * In v0.1, NL is backed by a string. All semantic operations delegate
 * to the LLM adapter (mock by default for deterministic tests).
 */

import {
  AnimaValue,
  mkString,
  mkFloat,
  mkBool,
  mkList,
  mkNull,
} from './values';
import { getLLMAdapter } from './llm';
import { Environment } from './environment';

// ---------------------------------------------------------------------------
// NL semantic operations (synchronous wrappers for v0.1)
// ---------------------------------------------------------------------------

/**
 * Semantic equality: do two texts mean approximately the same thing?
 * Uses the LLM adapter's similarity function.
 */
export function nlSemanticEquals(a: string, b: string): boolean {
  const adapter = getLLMAdapter();
  if (adapter.similaritySync) {
    return adapter.similaritySync(a, b) > 0.7;
  }
  // Fallback for adapters without sync support
  let result = false;
  adapter.similarity(a, b).then(sim => { result = sim > 0.7; });
  return result;
}

/**
 * Semantic implication: does text a imply text b?
 */
export function nlSemanticImplies(a: string, b: string): boolean {
  const adapter = getLLMAdapter();
  if (adapter.similaritySync) {
    return adapter.similaritySync(a, b) > 0.5;
  }
  let result = false;
  adapter.similarity(a, b).then(sim => { result = sim > 0.5; });
  return result;
}

/**
 * Extract entities from text (simplified: keyword extraction).
 */
export function nlExtractEntities(text: string): string[] {
  // Simple heuristic: extract capitalized words that aren't at start of sentence
  const words = text.split(/\s+/);
  const entities: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[^a-zA-Z]/g, '');
    if (word.length > 1 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
      if (!entities.includes(word)) {
        entities.push(word);
      }
    }
  }
  return entities;
}

/**
 * Clarify/rephrase text using LLM.
 */
export function nlClarify(text: string): string {
  const adapter = getLLMAdapter();
  const prompt = `Clarify and rephrase the following text concisely: "${text}"`;
  if (adapter.generateSync) {
    return adapter.generateSync(prompt);
  }
  let result = text;
  adapter.generate(prompt).then(r => { result = r; });
  return result;
}

/**
 * Summarize text using LLM.
 */
export function nlSummarize(text: string): string {
  const adapter = getLLMAdapter();
  const prompt = `Summarize the following text in one sentence: "${text}"`;
  if (adapter.generateSync) {
    return adapter.generateSync(prompt);
  }
  let result = text;
  adapter.generate(prompt).then(r => { result = r; });
  return result;
}

// ---------------------------------------------------------------------------
// Builtin registrations for the interpreter
// ---------------------------------------------------------------------------

export function registerNLBuiltins(env: Environment): void {
  const { mkBuiltin } = require('./values');

  // NL(text) — create an NL value (in v0.1, just returns the string)
  env.define('NL', mkBuiltin('NL', (args: AnimaValue[]) => {
    if (args.length < 1) {
      throw new Error('NL(text: String) expected');
    }
    if (args[0].kind === 'string') return args[0];
    return mkString(String((args[0] as any).value ?? ''));
  }), false);

  // semanticEquals(a, b) — ~= operator builtin
  env.define('semanticEquals', mkBuiltin('semanticEquals', (args: AnimaValue[]) => {
    if (args.length < 2 || args[0].kind !== 'string' || args[1].kind !== 'string') {
      throw new Error('semanticEquals(a: String, b: String) expected');
    }
    return mkBool(nlSemanticEquals(args[0].value, args[1].value));
  }), false);

  // semanticImplies(a, b) — ~> operator builtin
  env.define('semanticImplies', mkBuiltin('semanticImplies', (args: AnimaValue[]) => {
    if (args.length < 2 || args[0].kind !== 'string' || args[1].kind !== 'string') {
      throw new Error('semanticImplies(a: String, b: String) expected');
    }
    return mkBool(nlSemanticImplies(args[0].value, args[1].value));
  }), false);

  // extractEntities(text) — .entities accessor
  env.define('extractEntities', mkBuiltin('extractEntities', (args: AnimaValue[]) => {
    if (args.length < 1 || args[0].kind !== 'string') {
      throw new Error('extractEntities(text: String) expected');
    }
    return mkList(nlExtractEntities(args[0].value).map(e => mkString(e)));
  }), false);

  // clarify(text) — .clarify() method
  env.define('clarify', mkBuiltin('clarify', (args: AnimaValue[]) => {
    if (args.length < 1 || args[0].kind !== 'string') {
      throw new Error('clarify(text: String) expected');
    }
    return mkString(nlClarify(args[0].value));
  }), false);

  // summarize(text) — .summarize() method
  env.define('summarize', mkBuiltin('summarize', (args: AnimaValue[]) => {
    if (args.length < 1 || args[0].kind !== 'string') {
      throw new Error('summarize(text: String) expected');
    }
    return mkString(nlSummarize(args[0].value));
  }), false);

  // similarity(a, b) — compute semantic similarity score
  env.define('similarity', mkBuiltin('similarity', (args: AnimaValue[]) => {
    if (args.length < 2 || args[0].kind !== 'string' || args[1].kind !== 'string') {
      throw new Error('similarity(a: String, b: String) expected');
    }
    const adapter = getLLMAdapter();
    let result = 0;
    adapter.similarity(args[0].value, args[1].value).then(s => { result = s; });
    return mkFloat(result);
  }), false);
}
