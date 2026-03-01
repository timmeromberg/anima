/**
 * Lint rule: agent-without-boundaries
 *
 * Warns on agent declarations that do not include a `boundaries` section.
 * In Anima, agents should define safety boundaries to constrain their behavior.
 */

import { LintRule, Diagnostic } from '../linter';

function walkTree(node: any, visitor: (n: any) => void): void {
  visitor(node);
  for (let i = 0; i < node.childCount; i++) {
    walkTree(node.child(i), visitor);
  }
}

export const agentWithoutBoundariesRule: LintRule = {
  name: 'agent-without-boundaries',
  description: 'Warn on agent declarations missing a boundaries section',
  severity: 'warning',

  run(rootNode: any, _source: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    walkTree(rootNode, (node: any) => {
      if (node.type !== 'agent_declaration') return;

      const nameNode = node.childForFieldName('name');
      const bodyNode = node.childForFieldName('body');

      if (!bodyNode) return;

      // Check if the agent body contains a boundaries_section
      let hasBoundaries = false;
      for (let i = 0; i < bodyNode.childCount; i++) {
        const child = bodyNode.child(i);
        if (child.type === 'boundaries_section') {
          hasBoundaries = true;
          break;
        }
      }

      if (!hasBoundaries) {
        diagnostics.push({
          rule: 'agent-without-boundaries',
          severity: 'warning',
          message: `Agent '${nameNode ? nameNode.text : '<anonymous>'}' does not define a boundaries section`,
          line: (nameNode || node).startPosition.row + 1,
          column: (nameNode || node).startPosition.column,
        });
      }
    });

    return diagnostics;
  },
};
