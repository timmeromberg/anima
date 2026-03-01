/**
 * Diagnostic types and formatting for the Anima type checker.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** 1-based line number */
  line: number;
  /** 0-based column */
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * Format a single diagnostic as a human-readable string.
 */
export function formatDiagnostic(d: Diagnostic): string {
  const tag = d.severity === 'error' ? 'ERROR' : d.severity === 'warning' ? 'WARN' : 'INFO';
  return `${tag} [${d.line}:${d.column}] ${d.message}`;
}

/**
 * Format an array of diagnostics, sorted by line then column.
 */
export function formatDiagnostics(ds: Diagnostic[]): string {
  if (ds.length === 0) return '';
  const sorted = [...ds].sort((a, b) => a.line - b.line || a.column - b.column);
  return sorted.map(formatDiagnostic).join('\n');
}
