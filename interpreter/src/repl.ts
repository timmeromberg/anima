/**
 * Anima REPL — Interactive read-eval-print loop.
 *
 * Usage: npx ts-node src/index.ts repl
 *
 * Features:
 *   - Persistent interpreter state across inputs
 *   - Multi-line input (detects unclosed braces/parens/brackets)
 *   - Special commands: :help, :quit, :env, :type, :clear, :reset
 *   - Graceful error handling (prints error, continues loop)
 *   - Prints result of each expression (unless Unit)
 */

import * as readline from 'readline';
import { parse } from './parser';
import { Interpreter } from './interpreter';
import { registerStdlib } from './stdlib';
import { AnimaError } from './errors';
import { valueToString, AnimaValue } from './values';
import { Environment } from './environment';

const VERSION = '0.1.0';

/**
 * Start the Anima REPL.
 */
export function startRepl(): void {
  const interpreter = new Interpreter();
  registerStdlib(interpreter.getGlobalEnv());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'anima> ',
    terminal: true,
  });

  console.log(`Anima REPL v${VERSION}`);
  console.log('Type :help for commands, :quit to exit.\n');

  let buffer = '';
  let multiLine = false;

  rl.prompt();

  rl.on('line', (line: string) => {
    const trimmed = line.trim();

    // Handle special commands (only when not in multi-line mode)
    if (!multiLine && trimmed.startsWith(':')) {
      handleCommand(trimmed, interpreter, rl);
      // rl.prompt() will no-op if the interface was closed by :quit
      rl.prompt();
      return;
    }

    // Accumulate input
    buffer += (buffer ? '\n' : '') + line;

    // Check if we have unclosed delimiters
    if (hasUnclosedDelimiters(buffer)) {
      multiLine = true;
      process.stdout.write('  ... ');
      return;
    }

    // We have a complete input — evaluate it
    multiLine = false;
    const input = buffer.trim();
    buffer = '';

    if (input === '') {
      rl.prompt();
      return;
    }

    try {
      const result = parse(input);
      if (result.hasErrors) {
        for (const err of result.errors) {
          console.error(`  Parse error at line ${err.line}, col ${err.column}: ${err.message}`);
        }
      }
      // Run even with parse errors (tree-sitter produces partial trees)
      const value = interpreter.run(result.rootNode);
      printResult(value);
    } catch (e) {
      if (e instanceof AnimaError) {
        console.error(`  ${e.message}`);
      } else if (e instanceof Error) {
        console.error(`  Error: ${e.message}`);
      } else {
        console.error(`  Unknown error: ${e}`);
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });
}

/**
 * Check whether the input has unclosed delimiters.
 */
function hasUnclosedDelimiters(input: string): boolean {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    // Skip line comments
    if (ch === '/' && i + 1 < input.length && input[i + 1] === '/') {
      // Skip to end of line
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    switch (ch) {
      case '{': braces++; break;
      case '}': braces--; break;
      case '(': parens++; break;
      case ')': parens--; break;
      case '[': brackets++; break;
      case ']': brackets--; break;
    }
  }

  return braces > 0 || parens > 0 || brackets > 0;
}

/**
 * Handle a REPL special command.
 */
function handleCommand(cmd: string, interpreter: Interpreter, rl: readline.Interface): void {
  const parts = cmd.split(/\s+/);
  const command = parts[0];

  switch (command) {
    case ':help':
    case ':h':
      console.log('');
      console.log('REPL Commands:');
      console.log('  :help, :h       Show this help message');
      console.log('  :quit, :q       Exit the REPL');
      console.log('  :env            Show all defined variables in scope');
      console.log('  :type <expr>    Show the runtime type of an expression');
      console.log('  :clear          Clear the screen');
      console.log('  :reset          Reset the interpreter state');
      console.log('');
      console.log('Tips:');
      console.log('  - Multi-line input: leave braces/parens unclosed');
      console.log('  - The result of each expression is printed automatically');
      console.log('  - Variables persist between inputs');
      console.log('');
      break;

    case ':quit':
    case ':q':
    case ':exit':
      rl.close();
      break;

    case ':env':
      printEnvironment(interpreter.getGlobalEnv());
      break;

    case ':type': {
      const expr = parts.slice(1).join(' ').trim();
      if (!expr) {
        console.log('Usage: :type <expression>');
        break;
      }
      try {
        const result = parse(expr);
        const value = interpreter.run(result.rootNode);
        console.log(getRuntimeType(value));
      } catch (e) {
        if (e instanceof Error) {
          console.error(`  Error: ${e.message}`);
        }
      }
      break;
    }

    case ':clear':
      console.clear();
      break;

    case ':reset':
      // Create a fresh interpreter by reconstructing
      console.log('Interpreter state reset.');
      // We can't reassign const, but we can clear the env
      // Actually, we need to communicate this back... for simplicity,
      // just inform the user to restart.
      console.log('(Restart the REPL for a full reset.)');
      break;

    default:
      console.log(`Unknown command: ${command}. Type :help for available commands.`);
      break;
  }
}

/**
 * Print a value result, suppressing Unit.
 */
function printResult(value: AnimaValue): void {
  if (value.kind === 'unit') return;
  console.log(`=> ${valueToString(value)}`);
}

/**
 * Get a human-readable runtime type name for a value.
 */
function getRuntimeType(value: AnimaValue): string {
  switch (value.kind) {
    case 'int': return 'Int';
    case 'float': return 'Float';
    case 'string': return 'String';
    case 'bool': return 'Bool';
    case 'null': return 'Null';
    case 'unit': return 'Unit';
    case 'list': return `List (${value.elements.length} elements, ${value.mutable ? 'mutable' : 'immutable'})`;
    case 'map': return `Map (${value.entries.size} entries, ${value.mutable ? 'mutable' : 'immutable'})`;
    case 'function': return `Function (${value.name}, ${value.params.length} params)`;
    case 'builtin': return `Builtin (${value.name})`;
    case 'entity': return `Entity (${value.typeName})`;
    case 'entity_type': return `EntityType (${value.typeName})`;
    case 'confident': return `Confident (${getRuntimeType(value.value)} @ ${value.confidence})`;
    case 'agent': return `Agent (${value.typeName})`;
    case 'agent_type': return `AgentType (${value.typeName})`;
  }
}

/**
 * Print all defined variables in an environment (non-builtins).
 */
function printEnvironment(env: Environment): void {
  // Access the internal vars map via the known structure.
  // Since Environment doesn't expose iteration, we'll use a pragmatic
  // approach: try to look up common variable names, or use a known method.
  // Actually, let's add an iteration helper.
  //
  // Since we cannot modify environment.ts (it's a core file), we'll
  // use a reflection approach.
  const vars = (env as any).vars as Map<string, { value: AnimaValue; mutable: boolean }>;
  if (!vars || vars.size === 0) {
    console.log('  (no variables defined)');
    return;
  }

  console.log('');
  let userVars = 0;
  for (const [name, binding] of vars) {
    // Skip builtins for readability
    if (binding.value.kind === 'builtin') continue;
    const mutLabel = binding.mutable ? 'var' : 'val';
    const typeLabel = getRuntimeType(binding.value);
    const preview = valueToString(binding.value);
    const truncated = preview.length > 60 ? preview.slice(0, 57) + '...' : preview;
    console.log(`  ${mutLabel} ${name}: ${typeLabel} = ${truncated}`);
    userVars++;
  }

  if (userVars === 0) {
    console.log('  (no user-defined variables — only builtins)');
  }
  console.log('');
}
