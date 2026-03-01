#!/usr/bin/env node
/**
 * Anima linter CLI entry point.
 *
 * Usage:
 *   npx ts-node src/index.ts <file.anima> [...]
 *   npx ts-node src/index.ts --rule unused-vars <file.anima>
 *   npx ts-node src/index.ts --disable missing-return-type <file.anima>
 */

import * as fs from 'fs';
import * as path from 'path';
import { createDefaultLinter, formatDiagnostic, LintOptions } from './linter';

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const options: LintOptions = {};
  const files: string[] = [];
  const enabledRules: string[] = [];
  const disabledRules: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--rule':
        enabledRules.push(args[++i]);
        break;
      case '--disable':
        disabledRules.push(args[++i]);
        break;
      case '--list-rules': {
        const linter = createDefaultLinter();
        console.log('Available rules:');
        for (const name of linter.getRuleNames()) {
          console.log(`  ${name}`);
        }
        process.exit(0);
        break;
      }
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
        files.push(args[i]);
        break;
    }
  }

  if (enabledRules.length > 0) options.enabledRules = enabledRules;
  if (disabledRules.length > 0) options.disabledRules = disabledRules;

  if (files.length === 0) {
    console.error('Error: no files specified');
    process.exit(1);
  }

  const linter = createDefaultLinter();
  let totalDiagnostics = 0;
  let totalErrors = 0;

  for (const file of files) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: File not found: ${resolved}`);
      process.exit(1);
    }

    const source = fs.readFileSync(resolved, 'utf-8');

    try {
      const diagnostics = linter.lint(source, options);
      totalDiagnostics += diagnostics.length;
      totalErrors += diagnostics.filter(d => d.severity === 'error').length;

      if (diagnostics.length > 0) {
        console.log(`${file}:`);
        for (const d of diagnostics) {
          console.log(formatDiagnostic(d, file));
        }
        console.log('');
      }
    } catch (e: any) {
      console.error(`Error linting ${file}: ${e.message}`);
      process.exit(1);
    }
  }

  // Summary
  if (totalDiagnostics === 0) {
    console.log(`All clean! ${files.length} file${files.length === 1 ? '' : 's'} checked.`);
  } else {
    const warnings = totalDiagnostics - totalErrors;
    const parts: string[] = [];
    if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors === 1 ? '' : 's'}`);
    if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
    console.log(`Found ${parts.join(' and ')} in ${files.length} file${files.length === 1 ? '' : 's'}.`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

function printUsage(): void {
  console.log('Anima Linter v0.1.0');
  console.log('');
  console.log('Usage:');
  console.log('  anima lint <file.anima> [...]              Lint files');
  console.log('  anima lint --rule <name> <file.anima>       Run only specific rule(s)');
  console.log('  anima lint --disable <name> <file.anima>    Disable specific rule(s)');
  console.log('  anima lint --list-rules                     List available rules');
  console.log('');
  console.log('Rules:');
  console.log('  unused-vars              Detect unused variable declarations');
  console.log('  missing-return-type      Warn on functions without return type');
  console.log('  agent-without-boundaries Warn on agents missing boundaries section');
  console.log('  intent-without-fallback  Warn on intent functions missing fallback');
}

main();
