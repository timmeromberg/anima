#!/usr/bin/env node
/**
 * Anima formatter CLI entry point.
 *
 * Usage:
 *   npx ts-node src/index.ts <file.anima>            Format a file in-place
 *   npx ts-node src/index.ts <file.anima> --check     Check if file is formatted (exit 1 if not)
 *   npx ts-node src/index.ts <file.anima> --stdout     Print formatted output to stdout
 *   npx ts-node src/index.ts --indent 2 <file.anima>  Use 2-space indentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { format, FormatOptions } from './formatter';

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Parse options
  let check = false;
  let toStdout = false;
  const options: Partial<FormatOptions> = {};
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--check':
        check = true;
        break;
      case '--stdout':
        toStdout = true;
        break;
      case '--indent': {
        const n = parseInt(args[++i], 10);
        if (isNaN(n) || n < 1 || n > 8) {
          console.error('Error: --indent must be a number between 1 and 8');
          process.exit(1);
        }
        options.indentSize = n;
        break;
      }
      case '--trailing-commas':
        options.trailingCommas = true;
        break;
      case '--max-width': {
        const n = parseInt(args[++i], 10);
        if (isNaN(n) || n < 40) {
          console.error('Error: --max-width must be at least 40');
          process.exit(1);
        }
        options.maxLineWidth = n;
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

  if (files.length === 0) {
    console.error('Error: no files specified');
    process.exit(1);
  }

  let allFormatted = true;

  for (const file of files) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: File not found: ${resolved}`);
      process.exit(1);
    }

    const source = fs.readFileSync(resolved, 'utf-8');

    try {
      const formatted = format(source, options);

      if (check) {
        if (source !== formatted) {
          console.log(`Would reformat: ${file}`);
          allFormatted = false;
        } else {
          console.log(`Already formatted: ${file}`);
        }
      } else if (toStdout) {
        process.stdout.write(formatted);
      } else {
        if (source !== formatted) {
          fs.writeFileSync(resolved, formatted, 'utf-8');
          console.log(`Formatted: ${file}`);
        } else {
          console.log(`Unchanged: ${file}`);
        }
      }
    } catch (e: any) {
      console.error(`Error formatting ${file}: ${e.message}`);
      process.exit(1);
    }
  }

  if (check && !allFormatted) {
    process.exit(1);
  }
}

function printUsage(): void {
  console.log('Anima Formatter v0.1.0');
  console.log('');
  console.log('Usage:');
  console.log('  anima fmt <file.anima> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --check              Check if files are formatted (exit 1 if not)');
  console.log('  --stdout             Print formatted output to stdout');
  console.log('  --indent <n>         Indentation size (default: 4)');
  console.log('  --trailing-commas    Add trailing commas');
  console.log('  --max-width <n>      Max line width (default: 100)');
  console.log('  --help, -h           Show this help');
}

main();
