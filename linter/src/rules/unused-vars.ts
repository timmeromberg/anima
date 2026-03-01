/**
 * Lint rule: unused-vars
 *
 * Detects variable declarations (val/var) that are never referenced
 * after being defined.
 */

import { LintRule, Diagnostic } from '../linter';

/**
 * Collect all identifiers used in an AST subtree (excluding declarations).
 */
function collectUsedIdentifiers(node: any, used: Set<string>): void {
  // Skip the declaration site itself
  if (node.type === 'val_declaration' || node.type === 'var_declaration') {
    // Only collect from the value expression, not the name
    const valueNode = node.childForFieldName('value');
    if (valueNode) collectUsedIdentifiers(valueNode, used);
    return;
  }

  if (node.type === 'identifier') {
    used.add(node.text);
  }

  for (let i = 0; i < node.childCount; i++) {
    collectUsedIdentifiers(node.child(i), used);
  }
}

/**
 * Collect variable declarations.
 */
interface VarDecl {
  name: string;
  line: number;
  column: number;
}

function collectDeclarations(node: any, decls: VarDecl[]): void {
  if (node.type === 'val_declaration' || node.type === 'var_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      decls.push({
        name: nameNode.text,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
      });
    }
  }

  // Also collect function parameters
  if (node.type === 'parameter') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      decls.push({
        name: nameNode.text,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
      });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    collectDeclarations(node.child(i), decls);
  }
}

/**
 * Collect ALL identifier usages across the program, including in
 * expressions, call targets, etc.
 */
function collectAllIdentifierUsages(node: any, usages: Set<string>): void {
  if (node.type === 'identifier') {
    // Check if this identifier is in a usage position (not a declaration name)
    const parent = node.parent;
    if (parent) {
      // Skip if this is the 'name' field of a declaration
      const nameField = parent.childForFieldName('name');
      if (nameField === node && (
        parent.type === 'val_declaration' ||
        parent.type === 'var_declaration' ||
        parent.type === 'function_declaration' ||
        parent.type === 'intent_declaration' ||
        parent.type === 'entity_declaration' ||
        parent.type === 'agent_declaration' ||
        parent.type === 'parameter'
      )) {
        // This is a declaration site, not a usage
      } else {
        usages.add(node.text);
      }
    } else {
      usages.add(node.text);
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    collectAllIdentifierUsages(node.child(i), usages);
  }
}

export const unusedVarsRule: LintRule = {
  name: 'unused-vars',
  description: 'Detect unused variable declarations',
  severity: 'warning',

  run(rootNode: any, _source: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const decls: VarDecl[] = [];
    const usages = new Set<string>();

    collectDeclarations(rootNode, decls);
    collectAllIdentifierUsages(rootNode, usages);

    for (const decl of decls) {
      // Skip special names like _ (conventional ignore)
      if (decl.name === '_' || decl.name.startsWith('_')) continue;

      if (!usages.has(decl.name)) {
        diagnostics.push({
          rule: 'unused-vars',
          severity: 'warning',
          message: `Variable '${decl.name}' is declared but never used`,
          line: decl.line,
          column: decl.column,
        });
      }
    }

    return diagnostics;
  },
};
