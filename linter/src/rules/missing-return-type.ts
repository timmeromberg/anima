/**
 * Lint rule: missing-return-type
 *
 * Warns on function declarations that lack an explicit return type annotation.
 * Intent functions and fuzzy functions are also checked.
 */

import { LintRule, Diagnostic } from '../linter';

function walkTree(node: any, visitor: (n: any) => void): void {
  visitor(node);
  for (let i = 0; i < node.childCount; i++) {
    walkTree(node.child(i), visitor);
  }
}

export const missingReturnTypeRule: LintRule = {
  name: 'missing-return-type',
  description: 'Warn on functions without explicit return type annotation',
  severity: 'warning',

  run(rootNode: any, _source: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    walkTree(rootNode, (node: any) => {
      if (node.type !== 'function_declaration' && node.type !== 'intent_declaration') {
        return;
      }

      const nameNode = node.childForFieldName('name');
      const returnTypeNode = node.childForFieldName('return_type');

      // Skip main() — it commonly has no return type
      if (nameNode && nameNode.text === 'main') return;

      if (!returnTypeNode) {
        diagnostics.push({
          rule: 'missing-return-type',
          severity: 'warning',
          message: `Function '${nameNode ? nameNode.text : '<anonymous>'}' is missing a return type annotation`,
          line: (nameNode || node).startPosition.row + 1,
          column: (nameNode || node).startPosition.column,
        });
      }
    });

    return diagnostics;
  },
};
