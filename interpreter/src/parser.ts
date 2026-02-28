/**
 * Parser module — wraps tree-sitter to parse .anima source files.
 */

let Parser: any;
let AnimaLanguage: any;

let treeSitterLoaded = false;
let loadError: Error | null = null;

try {
  Parser = require('tree-sitter');
  // tree-sitter 0.25 expects the full module { language, nodeTypeInfo }
  AnimaLanguage = require('tree-sitter-anima');
  treeSitterLoaded = true;
} catch (e) {
  loadError = e as Error;
}

export interface ParseResult {
  tree: any;
  rootNode: any;
  hasErrors: boolean;
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  line: number;
  column: number;
}

/**
 * Check if tree-sitter native bindings are available.
 */
export function isTreeSitterAvailable(): boolean {
  return treeSitterLoaded;
}

/**
 * Get the error message if tree-sitter failed to load.
 */
export function getTreeSitterError(): string {
  if (treeSitterLoaded) return '';
  return loadError?.message ?? 'Unknown error loading tree-sitter';
}

/**
 * Parse Anima source code into a tree-sitter Tree.
 *
 * @param source - The Anima source code string
 * @returns ParseResult with the tree and any errors
 */
export function parse(source: string): ParseResult {
  if (!treeSitterLoaded) {
    throw new Error(
      `tree-sitter native bindings are not available.\n` +
      `Error: ${loadError?.message}\n\n` +
      `To fix this, run the following:\n` +
      `  cd tree-sitter-anima && npx tree-sitter generate && npm run build\n` +
      `  cd ../interpreter && npm install\n\n` +
      `Make sure you have a C compiler and node-gyp available.`
    );
  }

  const parser = new Parser();
  parser.setLanguage(AnimaLanguage);

  const tree = parser.parse(source);
  const rootNode = tree.rootNode;

  // Collect parse errors
  const errors: ParseError[] = [];
  collectErrors(rootNode, errors);

  return {
    tree,
    rootNode,
    hasErrors: errors.length > 0,
    errors,
  };
}

/**
 * Recursively collect ERROR and MISSING nodes from the parse tree.
 */
function collectErrors(node: any, errors: ParseError[]): void {
  if (node.type === 'ERROR' || node.isMissing) {
    errors.push({
      message: node.isMissing
        ? `Missing expected node: ${node.type}`
        : `Syntax error at: ${node.text.slice(0, 50)}`,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    });
  }
  for (let i = 0; i < node.childCount; i++) {
    collectErrors(node.child(i), errors);
  }
}
