#!/usr/bin/env node
/**
 * Anima interpreter CLI entry point.
 *
 * Usage: npx ts-node src/index.ts <file.anima>
 *        npx ts-node src/index.ts run <file.anima>
 *        npx ts-node src/index.ts check <file.anima> [...]
 *        npx ts-node src/index.ts repl
 *        npx ts-node src/index.ts fmt <file.anima> [...]
 *        npx ts-node src/index.ts lint <file.anima> [...]
 *        npx ts-node src/index.ts init [directory]
 *        npx ts-node src/index.ts --eval "<code>"
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse, isTreeSitterAvailable, getTreeSitterError } from './parser';
import { Interpreter } from './interpreter';
import { AnimaError, AnimaRuntimeError } from './errors';
import { registerStdlib } from './stdlib';
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

  // Handle `repl` command
  if (args[0] === 'repl') {
    const { startRepl } = require('./repl');
    startRepl();
    return; // REPL runs its own event loop
  }

  // Handle `fmt` command
  if (args[0] === 'fmt') {
    runFormatter(args.slice(1));
    return;
  }

  // Handle `lint` command
  if (args[0] === 'lint') {
    runLinter(args.slice(1));
    return;
  }

  // Handle `init` command
  if (args[0] === 'init') {
    runInit(args.slice(1));
    return;
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
  registerStdlib(interpreter.getGlobalEnv());
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

/**
 * Run the formatter on given files, delegating to the formatter package.
 */
function runFormatter(args: string[]): void {
  try {
    const { format } = require('../../formatter/src/formatter');
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      console.log('Usage: anima fmt <file.anima> [--check] [--stdout] [--indent <n>]');
      process.exit(0);
    }

    let check = false;
    let toStdout = false;
    const options: Record<string, any> = {};
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--check': check = true; break;
        case '--stdout': toStdout = true; break;
        case '--indent': options.indentSize = parseInt(args[++i], 10); break;
        case '--trailing-commas': options.trailingCommas = true; break;
        case '--max-width': options.maxLineWidth = parseInt(args[++i], 10); break;
        default:
          if (args[i].startsWith('-')) {
            console.error(`Unknown option: ${args[i]}`);
            process.exit(1);
          }
          files.push(args[i]);
      }
    }

    let allFormatted = true;
    for (const file of files) {
      const resolved = path.resolve(file);
      if (!fs.existsSync(resolved)) {
        console.error(`Error: File not found: ${resolved}`);
        process.exit(1);
      }
      const source = fs.readFileSync(resolved, 'utf-8');
      const formatted = format(source, options);
      if (check) {
        if (source !== formatted) { console.log(`Would reformat: ${file}`); allFormatted = false; }
        else console.log(`Already formatted: ${file}`);
      } else if (toStdout) {
        process.stdout.write(formatted);
      } else {
        if (source !== formatted) { fs.writeFileSync(resolved, formatted, 'utf-8'); console.log(`Formatted: ${file}`); }
        else console.log(`Unchanged: ${file}`);
      }
    }
    if (check && !allFormatted) process.exit(1);
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.error('Error: formatter package not available. Run: cd ../formatter && npm install');
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  }
}

/**
 * Run the linter on given files, delegating to the linter package.
 */
function runLinter(args: string[]): void {
  try {
    const { createDefaultLinter, formatDiagnostic } = require('../../linter/src/linter');
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      console.log('Usage: anima lint <file.anima> [...] [--rule <name>] [--disable <name>]');
      process.exit(0);
    }

    const files: string[] = [];
    const enabledRules: string[] = [];
    const disabledRules: string[] = [];

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--rule': enabledRules.push(args[++i]); break;
        case '--disable': disabledRules.push(args[++i]); break;
        case '--list-rules': {
          const linter = createDefaultLinter();
          console.log('Available rules:');
          for (const name of linter.getRuleNames()) console.log(`  ${name}`);
          process.exit(0);
          break;
        }
        default:
          if (args[i].startsWith('-')) { console.error(`Unknown option: ${args[i]}`); process.exit(1); }
          files.push(args[i]);
      }
    }

    const lintOptions: Record<string, any> = {};
    if (enabledRules.length > 0) lintOptions.enabledRules = enabledRules;
    if (disabledRules.length > 0) lintOptions.disabledRules = disabledRules;

    const linter = createDefaultLinter();
    let totalDiags = 0;
    let totalErrors = 0;

    for (const file of files) {
      const resolved = path.resolve(file);
      if (!fs.existsSync(resolved)) { console.error(`Error: File not found: ${resolved}`); process.exit(1); }
      const source = fs.readFileSync(resolved, 'utf-8');
      const diagnostics = linter.lint(source, lintOptions);
      totalDiags += diagnostics.length;
      totalErrors += diagnostics.filter((d: any) => d.severity === 'error').length;
      if (diagnostics.length > 0) {
        console.log(`${file}:`);
        for (const d of diagnostics) console.log(formatDiagnostic(d, file));
        console.log('');
      }
    }

    if (totalDiags === 0) {
      console.log(`All clean! ${files.length} file${files.length === 1 ? '' : 's'} checked.`);
    } else {
      const warnings = totalDiags - totalErrors;
      const parts: string[] = [];
      if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors === 1 ? '' : 's'}`);
      if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
      console.log(`Found ${parts.join(' and ')} in ${files.length} file${files.length === 1 ? '' : 's'}.`);
    }
    process.exit(totalErrors > 0 ? 1 : 0);
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.error('Error: linter package not available. Run: cd ../linter && npm install');
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  }
}

/**
 * Run the project initializer.
 */
function runInit(args: string[]): void {
  try {
    const { initProject } = require('../../cli/src/init');
    const options: Record<string, string> = {};

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--name') {
        options.name = args[++i];
      } else if (!args[i].startsWith('-')) {
        options.directory = args[i];
      }
    }

    initProject(options);
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.error('Error: cli package not available.');
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  }
}

function printUsage(): void {
  console.log('Anima v0.1.0');
  console.log('');
  console.log('Usage:');
  console.log('  anima <file.anima>                         Run an Anima file');
  console.log('  anima run <file.anima>                     Run an Anima file');
  console.log('  anima check <file.anima> [...]             Check files for parse and type errors');
  console.log('  anima repl                                 Start interactive REPL');
  console.log('  anima fmt <file.anima> [--check] [--stdout] Format Anima files');
  console.log('  anima lint <file.anima> [...]               Lint Anima files');
  console.log('  anima init [directory]                      Initialize a new Anima project');
  console.log('  anima --eval "<code>"                       Evaluate inline code');
  console.log('  anima --help                                Show this help');
}

main();
