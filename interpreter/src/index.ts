#!/usr/bin/env node
/**
 * Anima interpreter CLI entry point.
 *
 * Usage: npx ts-node src/index.ts <file.anima>
 *        npx ts-node src/index.ts --eval "<code>"
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse, isTreeSitterAvailable, getTreeSitterError } from './parser';
import { Interpreter } from './interpreter';
import { AnimaError, AnimaRuntimeError } from './errors';

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  // Check tree-sitter availability
  if (!isTreeSitterAvailable()) {
    console.error('Error: tree-sitter native bindings are not available.');
    console.error(`Reason: ${getTreeSitterError()}`);
    console.error('');
    console.error('To fix this:');
    console.error('  1. cd ../tree-sitter-anima && npx tree-sitter generate');
    console.error('  2. Ensure binding.gyp and bindings/node/ exist (run tree-sitter init if needed)');
    console.error('  3. cd ../interpreter && npm install');
    console.error('');
    console.error('You need a C compiler (gcc/clang) and node-gyp installed.');
    process.exit(1);
  }

  let source: string;
  let filename: string;

  if (args[0] === '--eval' || args[0] === '-e') {
    if (args.length < 2) {
      console.error('Error: --eval requires a code argument');
      process.exit(1);
    }
    source = args[1];
    filename = '<eval>';
  } else if (args[0] === 'run' && args.length >= 2) {
    // `anima run <file.anima>`
    filename = args[1];
    source = readFile(filename);
  } else {
    // `anima <file.anima>` (shorthand)
    filename = args[0];
    source = readFile(filename);
  }

  // Parse
  const result = parse(source);
  if (result.hasErrors) {
    console.error(`Parse errors in ${filename}:`);
    for (const err of result.errors) {
      console.error(`  Line ${err.line}, Col ${err.column}: ${err.message}`);
    }
    // Continue anyway -- tree-sitter produces partial trees
  }

  // Interpret
  const interpreter = new Interpreter();
  try {
    interpreter.run(result.rootNode);
  } catch (e) {
    if (e instanceof AnimaError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

function readFile(filepath: string): string {
  const resolved = path.resolve(filepath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: File not found: ${resolved}`);
    process.exit(1);
  }
  return fs.readFileSync(resolved, 'utf-8');
}

function printUsage(): void {
  console.log('Anima Interpreter v0.1.0');
  console.log('');
  console.log('Usage:');
  console.log('  npx ts-node src/index.ts <file.anima>       Run an Anima file');
  console.log('  npx ts-node src/index.ts run <file.anima>   Run an Anima file');
  console.log('  npx ts-node src/index.ts --eval "<code>"    Evaluate inline code');
  console.log('  npx ts-node src/index.ts --help             Show this help');
}

main();
