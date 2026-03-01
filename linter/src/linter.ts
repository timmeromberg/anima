/**
 * Anima linter engine.
 *
 * Runs a set of lint rules against a tree-sitter parse tree and
 * collects diagnostics (warnings and errors).
 */

let Parser: any;
let AnimaLanguage: any;

try {
  Parser = require('tree-sitter');
  AnimaLanguage = require('tree-sitter-anima');
} catch {
  // Will throw at lint time if not available
}

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  rule: string;
  severity: Severity;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * A lint rule receives the root AST node and reports diagnostics.
 */
export interface LintRule {
  /** Unique rule identifier (e.g., "unused-vars") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Default severity */
  severity: Severity;
  /** Run the rule and return diagnostics */
  run(rootNode: any, source: string): Diagnostic[];
}

export interface LintOptions {
  /** Rules to enable (by name). If empty/undefined, all rules run. */
  enabledRules?: string[];
  /** Rules to disable (by name). */
  disabledRules?: string[];
}

/**
 * The main linter class. Register rules, then lint source code.
 */
export class Linter {
  private rules: LintRule[] = [];

  /**
   * Register a lint rule.
   */
  addRule(rule: LintRule): void {
    this.rules.push(rule);
  }

  /**
   * Lint Anima source code. Returns diagnostics sorted by line.
   */
  lint(source: string, options?: LintOptions): Diagnostic[] {
    if (!Parser || !AnimaLanguage) {
      throw new Error('tree-sitter or tree-sitter-anima not available. Run npm install.');
    }

    const parser = new Parser();
    parser.setLanguage(AnimaLanguage);
    const tree = parser.parse(source);
    const rootNode = tree.rootNode;

    const enabledRules = options?.enabledRules;
    const disabledRules = new Set(options?.disabledRules ?? []);

    const diagnostics: Diagnostic[] = [];

    for (const rule of this.rules) {
      // Skip disabled rules
      if (disabledRules.has(rule.name)) continue;
      // If enabledRules is specified, only run those
      if (enabledRules && !enabledRules.includes(rule.name)) continue;

      try {
        const ruleDiags = rule.run(rootNode, source);
        diagnostics.push(...ruleDiags);
      } catch (e: any) {
        diagnostics.push({
          rule: rule.name,
          severity: 'error',
          message: `Rule failed internally: ${e.message}`,
          line: 0,
          column: 0,
        });
      }
    }

    // Sort by line, then column
    diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);

    return diagnostics;
  }

  /**
   * Get all registered rule names.
   */
  getRuleNames(): string[] {
    return this.rules.map(r => r.name);
  }
}

/**
 * Format a diagnostic for terminal output.
 */
export function formatDiagnostic(d: Diagnostic, filename?: string): string {
  const loc = filename
    ? `${filename}:${d.line}:${d.column}`
    : `${d.line}:${d.column}`;
  const tag = d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warn' : 'info';
  return `  ${loc}  ${tag}  ${d.message}  (${d.rule})`;
}

/**
 * Create a linter with all built-in rules registered.
 */
export function createDefaultLinter(): Linter {
  const linter = new Linter();

  // Import rules lazily to keep the module boundary clean
  const { unusedVarsRule } = require('./rules/unused-vars');
  const { missingReturnTypeRule } = require('./rules/missing-return-type');
  const { agentWithoutBoundariesRule } = require('./rules/agent-without-boundaries');
  const { intentWithoutFallbackRule } = require('./rules/intent-without-fallback');

  linter.addRule(unusedVarsRule);
  linter.addRule(missingReturnTypeRule);
  linter.addRule(agentWithoutBoundariesRule);
  linter.addRule(intentWithoutFallbackRule);

  return linter;
}
