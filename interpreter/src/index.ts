#!/usr/bin/env node
/**
 * Anima interpreter CLI entry point.
 *
 * Usage: npx ts-node src/index.ts <file.anima>
 *        npx ts-node src/index.ts --eval "<code>"
 *        npx ts-node src/index.ts check <file.anima> [...]
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse, isTreeSitterAvailable, getTreeSitterError } from './parser';
import { Interpreter } from './interpreter';
import { AnimaError, AnimaRuntimeError } from './errors';
// Type checker is loaded dynamically to avoid rootDir constraints across packages.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let TypeCheckerModule: { TypeChecker: any; formatDiagnostic: (d: any) => string } | null = null;
try {
  const checker = require('../../typechecker/src/checker');
  const diagnostics = require('../../typechecker/src/diagnostics');
  TypeCheckerModule = { TypeChecker: checker.TypeChecker, formatDiagnostic: diagnostics.formatDiagnostic };
} catch {
  // Type checker not available — check command will do parse-only validation
}

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

  // Handle `check` command
  if (args[0] === 'check') {
    const files = args.slice(1);
    if (files.length === 0) {
      console.error('Error: check requires at least one file argument');
      process.exit(1);
    }
    const exitCode = runCheck(files);
    process.exit(exitCode);
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
    interpreter.run(result.rootNode, filename !== '<eval>' ? filename : undefined);
  } catch (e) {
    if (e instanceof AnimaError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

/**
 * Run parse and type-check validation on one or more files.
 * Returns 0 if all files are clean, 1 if any have errors.
 */
function runCheck(files: string[]): number {
  let hasAnyErrors = false;

  for (const filepath of files) {
    const resolved = path.resolve(filepath);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: File not found: ${resolved}`);
      hasAnyErrors = true;
      continue;
    }

    const source = fs.readFileSync(resolved, 'utf-8');
    const result = parse(source);

    // Use the original filepath for display (not the resolved absolute path)
    const displayName = filepath;

    if (result.hasErrors) {
      hasAnyErrors = true;
      const count = result.errors.length;
      console.log(`\u2717 ${displayName} \u2014 ${count} parse error${count === 1 ? '' : 's'}`);
      for (const err of result.errors) {
        console.log(`  Line ${err.line}, Col ${err.column}: ${err.message}`);
      }
      // Still try type checking even with parse errors (tree-sitter produces partial trees)
    }

    // Run type checker if available
    if (TypeCheckerModule) {
      const checker = new TypeCheckerModule.TypeChecker();
      const diagnostics: Array<{ severity: string; message: string; line: number; column: number }> = checker.check(result.rootNode);
      const errors = diagnostics.filter(d => d.severity === 'error');
      const warnings = diagnostics.filter(d => d.severity === 'warning');

      if (errors.length > 0) {
        hasAnyErrors = true;
      }

      if (diagnostics.length > 0) {
        if (!result.hasErrors) {
          // Print header only if we didn't already print parse errors
          const parts: string[] = [];
          if (errors.length > 0) parts.push(`${errors.length} error${errors.length === 1 ? '' : 's'}`);
          if (warnings.length > 0) parts.push(`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
          console.log(`\u2717 ${displayName} \u2014 ${parts.join(', ')}`);
        }
        for (const d of diagnostics) {
          console.log(`  ${TypeCheckerModule.formatDiagnostic(d)}`);
        }
      } else if (!result.hasErrors) {
        console.log(`\u2713 ${displayName} \u2014 no errors`);
      }
    } else if (!result.hasErrors) {
      console.log(`\u2713 ${displayName} \u2014 no errors`);
    }
  }

  return hasAnyErrors ? 1 : 0;
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
  console.log('  npx ts-node src/index.ts <file.anima>            Run an Anima file');
  console.log('  npx ts-node src/index.ts run <file.anima>        Run an Anima file');
  console.log('  npx ts-node src/index.ts check <file.anima> ...  Check files for parse and type errors');
  console.log('  npx ts-node src/index.ts --eval "<code>"         Evaluate inline code');
  console.log('  npx ts-node src/index.ts --help                  Show this help');
}

main();
