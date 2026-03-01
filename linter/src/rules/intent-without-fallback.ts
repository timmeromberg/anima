/**
 * Lint rule: intent-without-fallback
 *
 * Warns on intent function declarations that do not include a `fallback` clause.
 * Intent functions should gracefully degrade when their constraints cannot be met.
 */

import { LintRule, Diagnostic } from '../linter';

function walkTree(node: any, visitor: (n: any) => void): void {
  visitor(node);
  for (let i = 0; i < node.childCount; i++) {
    walkTree(node.child(i), visitor);
  }
}

export const intentWithoutFallbackRule: LintRule = {
  name: 'intent-without-fallback',
  description: 'Warn on intent functions missing a fallback clause',
  severity: 'warning',

  run(rootNode: any, _source: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    walkTree(rootNode, (node: any) => {
      if (node.type !== 'intent_declaration') return;

      const nameNode = node.childForFieldName('name');
      const bodyNode = node.childForFieldName('body');

      if (!bodyNode) return;

      // Check if the intent body contains a fallback_clause
      let hasFallback = false;
      for (let i = 0; i < bodyNode.childCount; i++) {
        const child = bodyNode.child(i);
        if (child.type === 'fallback_clause') {
          hasFallback = true;
          break;
        }
      }

      if (!hasFallback) {
        diagnostics.push({
          rule: 'intent-without-fallback',
          severity: 'warning',
          message: `Intent function '${nameNode ? nameNode.text : '<anonymous>'}' does not define a fallback clause`,
          line: (nameNode || node).startPosition.row + 1,
          column: (nameNode || node).startPosition.column,
        });
      }
    });

    return diagnostics;
  },
};
