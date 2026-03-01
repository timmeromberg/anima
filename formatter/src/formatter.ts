/**
 * Anima code formatter.
 *
 * Parses source code with tree-sitter and emits consistently formatted output.
 * Walks the concrete syntax tree (CST), preserving comments and rewriting
 * whitespace according to configurable style rules.
 */

let Parser: any;
let AnimaLanguage: any;

try {
  Parser = require('tree-sitter');
  AnimaLanguage = require('tree-sitter-anima');
} catch {
  // Will throw at format time if not available
}

export interface FormatOptions {
  /** Number of spaces per indentation level (default: 4) */
  indentSize: number;
  /** Max line width before wrapping (advisory, not enforced on all constructs) */
  maxLineWidth: number;
  /** Add trailing commas in parameter lists / collections */
  trailingCommas: boolean;
  /** Blank lines between top-level declarations */
  blankLinesBetweenDeclarations: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
  indentSize: 4,
  maxLineWidth: 100,
  trailingCommas: false,
  blankLinesBetweenDeclarations: 1,
};

/**
 * Format Anima source code.
 */
export function format(source: string, options?: Partial<FormatOptions>): string {
  if (!Parser || !AnimaLanguage) {
    throw new Error('tree-sitter or tree-sitter-anima not available. Run npm install.');
  }

  const opts: FormatOptions = { ...DEFAULT_OPTIONS, ...options };
  const parser = new Parser();
  parser.setLanguage(AnimaLanguage);
  const tree = parser.parse(source);

  const formatter = new AnimaFormatter(source, opts);
  const result = formatter.formatNode(tree.rootNode, 0);
  return result.trimEnd() + '\n';
}

class AnimaFormatter {
  private source: string;
  private opts: FormatOptions;

  constructor(source: string, opts: FormatOptions) {
    this.source = source;
    this.opts = opts;
  }

  /**
   * Format a node and its children at the given indentation level.
   */
  formatNode(node: any, indent: number): string {
    const type = node.type;

    switch (type) {
      case 'program':
        return this.formatProgram(node, indent);

      // Declarations
      case 'function_declaration':
        return this.formatFunctionDecl(node, indent);
      case 'intent_declaration':
        return this.formatIntentDecl(node, indent);
      case 'entity_declaration':
        return this.formatEntityDecl(node, indent);
      case 'agent_declaration':
        return this.formatAgentDecl(node, indent);
      case 'sealed_declaration':
        return this.formatSealedDecl(node, indent);
      case 'interface_declaration':
        return this.formatInterfaceDecl(node, indent);
      case 'val_declaration':
      case 'var_declaration':
        return this.formatVarDecl(node, indent);
      case 'import_declaration':
        return this.formatImportDecl(node, indent);
      case 'module_declaration':
        return this.formatModuleDecl(node, indent);
      case 'type_alias':
        return this.formatTypeAlias(node, indent);

      // Statements
      case 'assignment_statement':
        return this.formatAssignment(node, indent);
      case 'return_statement':
        return this.formatReturn(node, indent);
      case 'for_statement':
        return this.formatForStatement(node, indent);
      case 'while_statement':
        return this.formatWhileStatement(node, indent);
      case 'expression_statement':
        return this.formatExpressionStatement(node, indent);

      // Expressions (in statement context, just format inline)
      case 'if_expression':
        return this.formatIfExpression(node, indent);
      case 'when_expression':
        return this.formatWhenExpression(node, indent);
      case 'block':
        return this.formatBlock(node, indent);

      // Default: reproduce source text (leaf nodes, comments, etc.)
      default:
        return this.nodeText(node);
    }
  }

  // ================================================================
  // Top level
  // ================================================================

  private formatProgram(node: any, indent: number): string {
    const parts: string[] = [];
    let prevType: string | null = null;

    for (const child of node.namedChildren) {
      // Add blank lines between top-level declarations
      if (prevType !== null && this.isDeclaration(child.type)) {
        const blankLines = this.opts.blankLinesBetweenDeclarations;
        for (let i = 0; i < blankLines; i++) {
          parts.push('');
        }
      }

      // Include leading comments
      const comments = this.getLeadingComments(child);
      if (comments) parts.push(comments);

      parts.push(this.formatNode(child, indent));
      prevType = child.type;
    }

    return parts.join('\n');
  }

  // ================================================================
  // Declarations
  // ================================================================

  private formatFunctionDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    const parts: string[] = [];

    // Modifiers
    const modifiers = this.getModifiers(node);
    if (modifiers) parts.push(modifiers);

    parts.push('fun');

    // Type parameters
    const typeParams = this.getNamedChild(node, 'type_parameters');
    if (typeParams) parts.push(this.nodeText(typeParams));

    // Receiver
    const receiver = node.childForFieldName('receiver');
    if (receiver) {
      parts.push(this.nodeText(receiver) + '.');
    }

    // Name
    const name = node.childForFieldName('name');
    parts.push(name ? this.nodeText(name) : '');

    // Parameters
    const params = node.childForFieldName('parameters');
    if (params) {
      // Replace the last part by appending params directly to name
      const last = parts.pop()!;
      parts.push(last + this.formatParameterList(params));
    }

    // Return type
    const returnType = node.childForFieldName('return_type');
    if (returnType) {
      const last = parts.pop()!;
      parts.push(last + ': ' + this.nodeText(returnType));
    }

    // Context clause
    const ctx = node.childForFieldName('context_clause');
    if (ctx) parts.push(this.nodeText(ctx));

    // Body
    const body = node.childForFieldName('body');
    if (body) {
      if (body.type === 'block') {
        parts.push(this.formatBlock(body, indent));
      } else {
        // Expression body: fun name() = expr
        parts.push('= ' + this.formatExpression(body, indent));
      }
    }

    return pad + parts.join(' ');
  }

  private formatIntentDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    const parts: string[] = [];

    const modifiers = this.getModifiers(node);
    if (modifiers) parts.push(modifiers);
    parts.push('intent fun');

    const name = node.childForFieldName('name');
    parts.push(name ? this.nodeText(name) : '');

    const params = node.childForFieldName('parameters');
    if (params) {
      const last = parts.pop()!;
      parts.push(last + this.formatParameterList(params));
    }

    const returnType = node.childForFieldName('return_type');
    if (returnType) {
      const last = parts.pop()!;
      parts.push(last + ': ' + this.nodeText(returnType));
    }

    const body = node.childForFieldName('body');
    if (body) {
      parts.push(this.formatIntentBody(body, indent));
    }

    return pad + parts.join(' ');
  }

  private formatEntityDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    let result = pad + 'data entity';

    const name = node.childForFieldName('name');
    if (name) result += ' ' + this.nodeText(name);

    const typeParams = this.getNamedChild(node, 'type_parameters');
    if (typeParams) result += this.nodeText(typeParams);

    // Field parameters
    const fieldParams = this.getNamedChildren(node, 'field_parameter');
    if (fieldParams.length > 0) {
      result += '(\n';
      const fields = fieldParams.map((fp: any, i: number) => {
        const comma = i < fieldParams.length - 1 || this.opts.trailingCommas ? ',' : '';
        return this.indent(indent + 1) + this.formatFieldParam(fp) + comma;
      });
      result += fields.join('\n') + '\n' + pad + ')';
    } else {
      result += '()';
    }

    // Supertypes
    const supertypes = this.getSupertypes(node);
    if (supertypes) result += ' : ' + supertypes;

    // Body
    const body = node.childForFieldName('body');
    if (body) {
      result += ' ' + this.formatEntityBody(body, indent);
    }

    return result;
  }

  private formatAgentDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    let result = pad + 'agent';

    const name = node.childForFieldName('name');
    if (name) result += ' ' + this.nodeText(name);

    // Parameters (if any)
    const params = this.getAgentParams(node);
    if (params) result += params;

    const body = node.childForFieldName('body');
    if (body) {
      result += ' ' + this.formatAgentBody(body, indent);
    }

    return result;
  }

  private formatSealedDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    let result = pad + 'sealed class';

    const name = node.childForFieldName('name');
    if (name) result += ' ' + this.nodeText(name);

    const typeParams = this.getNamedChild(node, 'type_parameters');
    if (typeParams) result += this.nodeText(typeParams);

    const supertype = node.childForFieldName('supertype');
    if (supertype) result += ' : ' + this.nodeText(supertype);

    result += ' {\n';
    for (const member of this.getNamedChildren(node, 'sealed_member')) {
      result += this.indent(indent + 1) + this.nodeText(member).trim() + '\n';
    }
    // Also look for sealed_data_class and sealed_object directly
    for (const child of node.namedChildren) {
      if (child.type === 'sealed_data_class' || child.type === 'sealed_object') {
        result += this.indent(indent + 1) + this.nodeText(child).trim() + '\n';
      }
    }
    result += pad + '}';

    return result;
  }

  private formatInterfaceDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    let result = pad + 'interface';

    const name = node.childForFieldName('name');
    if (name) result += ' ' + this.nodeText(name);

    const typeParams = this.getNamedChild(node, 'type_parameters');
    if (typeParams) result += this.nodeText(typeParams);

    result += ' {\n';
    for (const child of node.namedChildren) {
      if (child.type === 'abstract_field' || child.type === 'function_signature' ||
          child.type === 'function_declaration') {
        result += this.indent(indent + 1) + this.nodeText(child).trim() + '\n';
      }
    }
    result += pad + '}';

    return result;
  }

  private formatVarDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    const keyword = node.type === 'val_declaration' ? 'val' : 'var';

    const name = node.childForFieldName('name');
    const typeAnnotation = node.childForFieldName('type');
    const value = node.childForFieldName('value');

    let result = pad + keyword + ' ' + (name ? this.nodeText(name) : '');
    if (typeAnnotation) result += ': ' + this.nodeText(typeAnnotation);
    if (value) result += ' = ' + this.formatExpression(value, indent);

    return result;
  }

  private formatImportDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    // Reconstruct: import { name1, name2 } from "path"
    const identifiers: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') identifiers.push(child.text);
    }
    const pathNode = this.getNamedChild(node, 'string_literal');
    const path = pathNode ? this.nodeText(pathNode) : '';
    const alias = node.childForFieldName('alias');

    let result = pad + `import { ${identifiers.join(', ')} } from ${path}`;
    if (alias) result += ' as ' + this.nodeText(alias);

    return result;
  }

  private formatModuleDecl(node: any, indent: number): string {
    const pad = this.indent(indent);
    const name = node.childForFieldName('name');
    return pad + 'module ' + (name ? this.nodeText(name) : '');
  }

  private formatTypeAlias(node: any, indent: number): string {
    return this.indent(indent) + this.nodeText(node).trim();
  }

  // ================================================================
  // Statements
  // ================================================================

  private formatAssignment(node: any, indent: number): string {
    const pad = this.indent(indent);
    return pad + this.nodeText(node).trim();
  }

  private formatReturn(node: any, indent: number): string {
    const pad = this.indent(indent);
    const valueNode = node.namedChildren.find((c: any) => c.type !== 'return');
    if (valueNode) {
      return pad + 'return ' + this.formatExpression(valueNode, indent);
    }
    return pad + 'return';
  }

  private formatForStatement(node: any, indent: number): string {
    const pad = this.indent(indent);
    // for (var in iterable) { body }
    const varNode = node.childForFieldName('variable');
    const iterNode = node.childForFieldName('iterable');
    const bodyNode = node.childForFieldName('body');

    let result = pad + 'for (';
    if (varNode) result += this.nodeText(varNode);
    result += ' in ';
    if (iterNode) result += this.formatExpression(iterNode, indent);
    result += ')';

    if (bodyNode) {
      result += ' ' + this.formatBlock(bodyNode, indent);
    }

    return result;
  }

  private formatWhileStatement(node: any, indent: number): string {
    const pad = this.indent(indent);
    const condNode = node.childForFieldName('condition');
    const bodyNode = node.childForFieldName('body');

    let result = pad + 'while (';
    if (condNode) result += this.formatExpression(condNode, indent);
    result += ')';

    if (bodyNode) {
      result += ' ' + this.formatBlock(bodyNode, indent);
    }

    return result;
  }

  private formatExpressionStatement(node: any, indent: number): string {
    const pad = this.indent(indent);
    if (node.namedChildren.length > 0) {
      return pad + this.formatExpression(node.namedChildren[0], indent);
    }
    return pad + this.nodeText(node).trim();
  }

  // ================================================================
  // Expressions
  // ================================================================

  private formatExpression(node: any, indent: number): string {
    if (!node) return '';

    switch (node.type) {
      case 'if_expression':
        return this.formatIfExpression(node, indent);
      case 'when_expression':
        return this.formatWhenExpression(node, indent);
      case 'block':
        return this.formatBlock(node, indent);
      case 'lambda_expression':
        return this.formatLambda(node, indent);
      default:
        // For most expressions, use the source text cleaned up
        return this.nodeText(node).trim();
    }
  }

  private formatIfExpression(node: any, indent: number): string {
    const pad = this.indent(indent);
    const condNode = node.childForFieldName('condition');
    const thenNode = node.childForFieldName('consequence');
    const elseNode = node.childForFieldName('alternative');

    let result = 'if (' + (condNode ? this.formatExpression(condNode, indent) : '') + ')';

    if (thenNode) {
      if (thenNode.type === 'block') {
        result += ' ' + this.formatBlock(thenNode, indent);
      } else {
        result += ' ' + this.formatExpression(thenNode, indent);
      }
    }

    if (elseNode) {
      result += ' else';
      if (elseNode.type === 'block') {
        result += ' ' + this.formatBlock(elseNode, indent);
      } else if (elseNode.type === 'if_expression') {
        result += ' ' + this.formatIfExpression(elseNode, indent);
      } else {
        result += ' ' + this.formatExpression(elseNode, indent);
      }
    }

    return result;
  }

  private formatWhenExpression(node: any, indent: number): string {
    const pad = this.indent(indent);
    let result = 'when';

    // Subject expression
    const subject = node.childForFieldName('subject');
    if (subject) result += ' (' + this.formatExpression(subject, indent) + ')';

    result += ' {\n';

    for (const child of node.namedChildren) {
      if (child.type === 'when_branch') {
        const condition = child.childForFieldName('condition');
        const body = child.childForFieldName('body');
        result += this.indent(indent + 1);
        if (condition) {
          result += this.formatExpression(condition, indent + 1);
        }
        result += ' -> ';
        if (body) {
          if (body.type === 'block') {
            result += this.formatBlock(body, indent + 1);
          } else {
            result += this.formatExpression(body, indent + 1);
          }
        }
        result += '\n';
      } else if (child.type === 'when_else') {
        const body = child.namedChildren[0];
        result += this.indent(indent + 1) + 'else -> ';
        if (body) {
          if (body.type === 'block') {
            result += this.formatBlock(body, indent + 1);
          } else {
            result += this.formatExpression(body, indent + 1);
          }
        }
        result += '\n';
      }
    }

    result += this.indent(indent) + '}';
    return result;
  }

  private formatLambda(node: any, indent: number): string {
    // { params -> body }
    return this.nodeText(node).trim();
  }

  // ================================================================
  // Blocks
  // ================================================================

  private formatBlock(node: any, indent: number): string {
    const children = node.namedChildren;
    if (children.length === 0) return '{ }';

    // Single-expression blocks on one line if short
    if (children.length === 1 && !this.isMultilineNode(children[0])) {
      const inner = this.formatNode(children[0], 0).trim();
      if (inner.length < this.opts.maxLineWidth - indent * this.opts.indentSize - 4) {
        return '{ ' + inner + ' }';
      }
    }

    let result = '{\n';
    for (const child of children) {
      const formatted = this.formatNode(child, indent + 1);
      result += formatted + '\n';
    }
    result += this.indent(indent) + '}';
    return result;
  }

  private formatIntentBody(node: any, indent: number): string {
    let result = '{\n';
    for (const child of node.namedChildren) {
      result += this.indent(indent + 1) + this.nodeText(child).trim() + '\n';
    }
    result += this.indent(indent) + '}';
    return result;
  }

  private formatEntityBody(node: any, indent: number): string {
    let result = '{\n';
    for (const child of node.namedChildren) {
      if (child.type === 'invariant_clause') {
        const block = child.namedChildren[0];
        result += this.indent(indent + 1) + 'invariant ' + this.formatBlock(block, indent + 1) + '\n';
      } else if (child.type === 'function_declaration') {
        result += this.formatFunctionDecl(child, indent + 1) + '\n';
      } else {
        result += this.indent(indent + 1) + this.nodeText(child).trim() + '\n';
      }
    }
    result += this.indent(indent) + '}';
    return result;
  }

  private formatAgentBody(node: any, indent: number): string {
    let result = '{\n';
    for (const child of node.namedChildren) {
      switch (child.type) {
        case 'agent_context_section':
          result += this.indent(indent + 1) + 'context {\n';
          for (const field of child.namedChildren) {
            result += this.indent(indent + 2) + this.nodeText(field).trim() + '\n';
          }
          result += this.indent(indent + 1) + '}\n';
          break;
        case 'tools_section':
          result += this.indent(indent + 1) + 'tools {\n';
          for (const tool of child.namedChildren) {
            result += this.indent(indent + 2) + this.nodeText(tool).trim() + '\n';
          }
          result += this.indent(indent + 1) + '}\n';
          break;
        case 'boundaries_section':
          result += this.indent(indent + 1) + 'boundaries {\n';
          for (const rule of child.namedChildren) {
            result += this.indent(indent + 2) + this.nodeText(rule).trim() + '\n';
          }
          result += this.indent(indent + 1) + '}\n';
          break;
        case 'function_declaration':
          result += this.formatFunctionDecl(child, indent + 1) + '\n';
          break;
        case 'intent_declaration':
          result += this.formatIntentDecl(child, indent + 1) + '\n';
          break;
        default:
          result += this.indent(indent + 1) + this.nodeText(child).trim() + '\n';
          break;
      }
    }
    result += this.indent(indent) + '}';
    return result;
  }

  // ================================================================
  // Helpers
  // ================================================================

  private formatParameterList(node: any): string {
    const params = node.namedChildren.filter((c: any) => c.type === 'parameter');
    if (params.length === 0) return '()';

    const formatted = params.map((p: any) => {
      const name = p.childForFieldName('name');
      const type = p.childForFieldName('type');
      const def = p.childForFieldName('default');
      let s = (name ? this.nodeText(name) : '') + ': ' + (type ? this.nodeText(type) : '');
      if (def) s += ' = ' + this.nodeText(def);
      return s;
    });

    const single = '(' + formatted.join(', ') + ')';
    return single;
  }

  private formatFieldParam(node: any): string {
    const modifiers = this.getModifiers(node);
    const keyword = node.children.find((c: any) => c.text === 'val' || c.text === 'var')?.text || 'val';
    const name = node.childForFieldName('name');
    const type = node.childForFieldName('type');
    const def = node.childForFieldName('default');

    let result = '';
    if (modifiers) result += modifiers + ' ';
    result += keyword + ' ' + (name ? this.nodeText(name) : '') + ': ' + (type ? this.nodeText(type) : '');
    if (def) result += ' = ' + this.nodeText(def);
    return result;
  }

  private getModifiers(node: any): string {
    const mods = node.namedChildren.filter((c: any) => c.type === 'modifier');
    return mods.map((m: any) => m.text).join(' ');
  }

  private getNamedChild(node: any, type: string): any | null {
    return node.namedChildren.find((c: any) => c.type === type) ?? null;
  }

  private getNamedChildren(node: any, type: string): any[] {
    return node.namedChildren.filter((c: any) => c.type === type);
  }

  private getSupertypes(node: any): string | null {
    // Look for types after ':' that aren't part of field parameters
    // This is grammar-dependent; for now just check if there's a colon after ')'
    const text = this.nodeText(node);
    const closeParenIdx = text.lastIndexOf(')');
    const bodyStart = text.indexOf('{', closeParenIdx);
    if (closeParenIdx >= 0) {
      const between = text.substring(closeParenIdx + 1, bodyStart >= 0 ? bodyStart : text.length).trim();
      if (between.startsWith(':')) {
        return between.substring(1).trim();
      }
    }
    return null;
  }

  private getAgentParams(node: any): string | null {
    // Look for parameter list or field_parameter children
    const text = this.nodeText(node);
    const nameEnd = node.childForFieldName('name')?.endPosition;
    const bodyStart = node.childForFieldName('body')?.startPosition;
    if (nameEnd && bodyStart) {
      const between = this.source.substring(
        this.posToOffset(nameEnd),
        this.posToOffset(bodyStart)
      ).trim();
      if (between.startsWith('(')) {
        const closeParen = between.indexOf(')');
        if (closeParen >= 0) {
          return between.substring(0, closeParen + 1);
        }
      }
    }
    return null;
  }

  private getLeadingComments(node: any): string | null {
    // Look for comment nodes before this node in the parent's children
    const parent = node.parent;
    if (!parent) return null;

    const comments: string[] = [];
    for (const child of parent.children) {
      if (child.startPosition.row >= node.startPosition.row) break;
      if (child.type === 'line_comment' || child.type === 'block_comment') {
        // Only include comments immediately preceding the node (within 1 line)
        if (node.startPosition.row - child.endPosition.row <= 1) {
          comments.push(child.text);
        }
      }
    }

    return comments.length > 0 ? comments.join('\n') : null;
  }

  private isDeclaration(type: string): boolean {
    return [
      'function_declaration', 'intent_declaration', 'entity_declaration',
      'agent_declaration', 'sealed_declaration', 'interface_declaration',
      'val_declaration', 'var_declaration', 'import_declaration',
      'module_declaration', 'type_alias', 'evolving_declaration',
      'fuzzy_declaration', 'feature_declaration', 'context_declaration',
      'resource_declaration', 'protocol_declaration', 'diagnosable_declaration',
    ].includes(type);
  }

  private isMultilineNode(node: any): boolean {
    return node.startPosition.row !== node.endPosition.row;
  }

  private indent(level: number): string {
    return ' '.repeat(level * this.opts.indentSize);
  }

  private nodeText(node: any): string {
    return node.text;
  }

  private posToOffset(pos: { row: number; column: number }): number {
    const lines = this.source.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.row && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    offset += pos.column;
    return offset;
  }
}
