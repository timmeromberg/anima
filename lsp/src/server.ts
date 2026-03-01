/**
 * Anima Language Server
 *
 * LSP server providing diagnostics, hover, go-to-definition, and completion
 * for the Anima programming language. Uses tree-sitter for parsing and the
 * Anima type checker for type diagnostics.
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic as LspDiagnostic,
  DiagnosticSeverity,
  Hover,
  MarkupKind,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  DefinitionParams,
  Location,
  Range,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

// -- tree-sitter setup --------------------------------------------------------

let Parser: any;
let AnimaLanguage: any;
let treeSitterAvailable = false;

try {
  Parser = require("tree-sitter");
  AnimaLanguage = require("tree-sitter-anima");
  treeSitterAvailable = true;
} catch {
  // tree-sitter not available — server will report this on startup
}

// -- type checker setup -------------------------------------------------------

let TypeCheckerModule: {
  TypeChecker: any;
  inferType: (node: any, env: any) => any;
  typeToString: (t: any) => string;
} | null = null;

try {
  const checker = require("../../typechecker/src/checker");
  const infer = require("../../typechecker/src/infer");
  const types = require("../../typechecker/src/types");
  TypeCheckerModule = {
    TypeChecker: checker.TypeChecker,
    inferType: infer.inferType,
    typeToString: types.typeToString,
  };
} catch {
  // Type checker not available
}

// -- Interfaces ---------------------------------------------------------------

interface ParsedDocument {
  tree: any;
  rootNode: any;
  version: number;
}

interface DeclarationInfo {
  name: string;
  kind: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  type?: string;
}

// -- Connection setup ---------------------------------------------------------

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

/** Cache of parsed trees keyed by document URI */
const parsedDocuments = new Map<string, ParsedDocument>();

/** Cache of declarations keyed by document URI */
const declarationCache = new Map<string, DeclarationInfo[]>();

// -- Initialization -----------------------------------------------------------

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
      definitionProvider: true,
      completionProvider: {
        triggerCharacters: [".", "@", "(", "{"],
        resolveProvider: false,
      },
    },
    serverInfo: {
      name: "anima-lsp",
      version: "0.1.0",
    },
  };
});

connection.onInitialized(() => {
  if (!treeSitterAvailable) {
    connection.window.showWarningMessage(
      "Anima LSP: tree-sitter native bindings are not available. " +
        "Parsing and diagnostics will be limited. " +
        "Run: cd tree-sitter-anima && npx tree-sitter generate && npm run build",
    );
  }
});

// -- Document management ------------------------------------------------------

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

documents.onDidClose((event) => {
  parsedDocuments.delete(event.document.uri);
  declarationCache.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// -- Validation ---------------------------------------------------------------

function createParser(): any | null {
  if (!treeSitterAvailable) return null;
  const parser = new Parser();
  parser.setLanguage(AnimaLanguage);
  return parser;
}

function validateDocument(document: TextDocument): void {
  const diagnostics: LspDiagnostic[] = [];
  const text = document.getText();

  const parser = createParser();
  if (!parser) {
    // No parser available — send empty diagnostics
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }

  // Parse with tree-sitter
  const tree = parser.parse(text);
  const rootNode = tree.rootNode;

  // Cache the parsed tree
  parsedDocuments.set(document.uri, {
    tree,
    rootNode,
    version: document.version,
  });

  // Collect parse errors
  collectParseErrors(rootNode, diagnostics);

  // Collect declarations for go-to-definition
  const declarations: DeclarationInfo[] = [];
  collectDeclarations(rootNode, declarations);
  declarationCache.set(document.uri, declarations);

  // Run type checker
  if (TypeCheckerModule) {
    try {
      const checker = new TypeCheckerModule.TypeChecker();
      const typeDiagnostics: Array<{
        severity: string;
        message: string;
        line: number;
        column: number;
        endLine?: number;
        endColumn?: number;
      }> = checker.check(rootNode);

      for (const d of typeDiagnostics) {
        const severity =
          d.severity === "error"
            ? DiagnosticSeverity.Error
            : d.severity === "warning"
              ? DiagnosticSeverity.Warning
              : DiagnosticSeverity.Information;

        diagnostics.push({
          severity,
          range: {
            start: { line: d.line - 1, character: d.column },
            end: { line: (d.endLine ?? d.line) - 1, character: d.endColumn ?? d.column + 1 },
          },
          message: d.message,
          source: "anima-typechecker",
        });
      }
    } catch {
      // Type checker failed — only report parse errors
    }
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

/**
 * Recursively collect parse ERROR and MISSING nodes as LSP diagnostics.
 */
function collectParseErrors(node: any, diagnostics: LspDiagnostic[]): void {
  if (node.type === "ERROR" || node.isMissing) {
    const message = node.isMissing
      ? `Missing expected node: ${node.type}`
      : `Syntax error at: ${node.text.slice(0, 80)}`;

    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: node.startPosition.row, character: node.startPosition.column },
        end: { line: node.endPosition.row, character: node.endPosition.column },
      },
      message,
      source: "anima-parser",
    });
  }

  for (let i = 0; i < node.childCount; i++) {
    collectParseErrors(node.child(i), diagnostics);
  }
}

// -- Declaration collection ---------------------------------------------------

/**
 * Collect top-level and nested declarations for go-to-definition support.
 */
function collectDeclarations(node: any, declarations: DeclarationInfo[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    const nameNode = child.childForFieldName("name");
    if (!nameNode) {
      // For val declarations, the pattern field holds the name
      if (child.type === "val_declaration") {
        const patternNode = child.childForFieldName("pattern");
        if (patternNode && patternNode.type === "identifier") {
          declarations.push({
            name: patternNode.text,
            kind: "val",
            line: patternNode.startPosition.row,
            column: patternNode.startPosition.column,
            endLine: patternNode.endPosition.row,
            endColumn: patternNode.endPosition.column,
          });
        }
      }
      continue;
    }

    const kindMap: Record<string, string> = {
      function_declaration: "function",
      val_declaration: "val",
      var_declaration: "var",
      entity_declaration: "entity",
      sealed_declaration: "sealed",
      interface_declaration: "interface",
      type_alias: "type",
      intent_declaration: "intent",
      fuzzy_declaration: "fuzzy",
      agent_declaration: "agent",
      feature_declaration: "feature",
      context_declaration: "context",
      resource_declaration: "resource",
      protocol_declaration: "protocol",
      evolving_declaration: "evolving",
      diagnosable_declaration: "diagnosable",
      module_declaration: "module",
    };

    const kind = kindMap[child.type];
    if (kind) {
      declarations.push({
        name: nameNode.text,
        kind,
        line: nameNode.startPosition.row,
        column: nameNode.startPosition.column,
        endLine: nameNode.endPosition.row,
        endColumn: nameNode.endPosition.column,
      });
    }

    // Recurse into agent/entity bodies for nested declarations
    if (child.type === "agent_declaration" || child.type === "entity_declaration") {
      const bodyNode = child.childForFieldName("body");
      if (bodyNode) {
        collectDeclarations(bodyNode, declarations);
      }
    }
  }
}

// -- Hover --------------------------------------------------------------------

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const parsed = parsedDocuments.get(params.textDocument.uri);
  if (!parsed) return null;

  const { rootNode } = parsed;
  const pos = params.position;

  // Find the node at the cursor position
  const node = findNodeAtPosition(rootNode, pos.line, pos.character);
  if (!node) return null;

  // Try to provide type information for identifiers
  if (node.type === "identifier") {
    const name = node.text;

    // Look up in declarations
    const declarations = declarationCache.get(params.textDocument.uri) ?? [];
    const decl = declarations.find((d) => d.name === name);

    if (decl) {
      const hoverText = `**${decl.kind}** \`${decl.name}\``;
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: hoverText,
        },
      };
    }

    // Try type inference if the type checker is available
    if (TypeCheckerModule) {
      try {
        const checker = new TypeCheckerModule.TypeChecker();
        checker.check(rootNode);
        // The type checker populates its internal environment; we can try inferType
        // on the node directly
        const inferredType = TypeCheckerModule.inferType(node, checker["env"]);
        if (inferredType && inferredType.tag !== "unknown") {
          const typeStr = TypeCheckerModule.typeToString(inferredType);
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: `\`${name}\`: **${typeStr}**`,
            },
          };
        }
      } catch {
        // inference failed — fall through
      }
    }

    // Fall back to keyword hover
    const keywordInfo = getKeywordHover(name);
    if (keywordInfo) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: keywordInfo,
        },
      };
    }
  }

  // Hover on declaration node types
  const declTypeHover = getNodeTypeHover(node);
  if (declTypeHover) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: declTypeHover,
      },
    };
  }

  return null;
});

/**
 * Find the most specific named node at the given position.
 */
function findNodeAtPosition(rootNode: any, line: number, column: number): any | null {
  const point = { row: line, column };
  let current = rootNode.descendantForPosition(point, point);
  // Walk up to find the first named node
  while (current && !current.isNamed) {
    current = current.parent;
  }
  return current ?? null;
}

function getKeywordHover(keyword: string): string | null {
  const keywords: Record<string, string> = {
    fun: "**fun** — Function declaration\n\nDeclares a regular function.",
    val: "**val** — Immutable value binding\n\nDeclares an immutable variable.",
    var: "**var** — Mutable variable binding\n\nDeclares a mutable variable.",
    entity: "**entity** — Data entity declaration\n\nDeclares a data class with fields and invariants.",
    sealed: "**sealed** — Sealed type declaration\n\nDeclares a sealed hierarchy of variants.",
    agent: "**agent** — Agent declaration\n\nDeclares an AI agent with context, tools, and boundaries.",
    intent:
      "**intent** — Intent function declaration\n\nDeclares a goal-oriented function with constraints (ensure/prefer/avoid).",
    fuzzy:
      "**fuzzy** — Fuzzy predicate declaration\n\nDeclares a fuzzy predicate that returns `Boolean @ Confidence`.",
    evolve: "**evolve** — Evolution block\n\nDeclares an evolution strategy for adaptive behavior.",
    ensure: "**ensure** — Hard constraint\n\nThe output must satisfy this condition.",
    prefer: "**prefer** — Soft constraint\n\nThe output should satisfy this condition if possible.",
    avoid: "**avoid** — Negative soft constraint\n\nThe output should not satisfy this condition.",
    context: "**context** — Agent context block\n\nDeclares the agent's mutable state.",
    tools: "**tools** — Agent tools block\n\nDeclares external functions the agent can call.",
    boundaries: "**boundaries** — Agent boundaries block\n\nDeclares cost, time, and capability constraints.",
    when: "**when** — Pattern matching expression\n\nBranch on conditions or type patterns.",
    data: "**data** — Data modifier\n\nUsed with `entity` to declare a data class.",
    delegate: "**delegate** — Agent delegation\n\nDelegate work to a sub-agent.",
    spawn: "**spawn** — Agent creation\n\nCreate a new agent instance.",
    recall: "**recall** — Memory recall\n\nRecall information from agent memory.",
    emit: "**emit** — Event emission\n\nEmit an event for reactive handlers.",
    adapt: "**adapt** — Adaptation clause\n\nHandle specific failure modes with alternative strategies.",
    fallback: "**fallback** — Fallback clause\n\nProvide a default value when all else fails.",
    diagnose: "**diagnose** — Diagnostic block\n\nUsed in diagnosable classes for structured error diagnosis.",
  };
  return keywords[keyword] ?? null;
}

function getNodeTypeHover(node: any): string | null {
  const typeHovers: Record<string, string> = {
    entity_declaration: "**Entity Declaration** — Defines a data type with typed fields and optional invariants.",
    agent_declaration: "**Agent Declaration** — Defines an AI agent with context, tools, boundaries, and intent functions.",
    intent_declaration: "**Intent Function** — A goal-oriented function with `ensure`/`prefer`/`avoid` constraints.",
    fuzzy_declaration: "**Fuzzy Predicate** — Returns `Boolean @ Confidence` based on weighted factors.",
    sealed_declaration: "**Sealed Type** — A closed hierarchy of variant types.",
    function_declaration: "**Function Declaration** — A regular function.",
    feature_declaration: "**Feature Spec** — Behavior-driven test specification.",
    evolving_declaration: "**Evolving Declaration** — An adaptable construct that evolves over time.",
    protocol_declaration: "**Protocol** — Defines the messages agents can exchange.",
    diagnosable_declaration: "**Diagnosable Class** — An error type with structured diagnostic capabilities.",
  };
  return typeHovers[node.type] ?? null;
}

// -- Go to Definition ---------------------------------------------------------

connection.onDefinition((params: DefinitionParams): Location | null => {
  const parsed = parsedDocuments.get(params.textDocument.uri);
  if (!parsed) return null;

  const { rootNode } = parsed;
  const pos = params.position;

  const node = findNodeAtPosition(rootNode, pos.line, pos.character);
  if (!node || node.type !== "identifier") return null;

  const name = node.text;
  const declarations = declarationCache.get(params.textDocument.uri) ?? [];
  const decl = declarations.find((d) => d.name === name);

  if (!decl) return null;

  // Don't navigate to self
  if (decl.line === node.startPosition.row && decl.column === node.startPosition.column) {
    return null;
  }

  return {
    uri: params.textDocument.uri,
    range: {
      start: { line: decl.line, character: decl.column },
      end: { line: decl.endLine, character: decl.endColumn },
    },
  };
});

// -- Completion ---------------------------------------------------------------

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const completions: CompletionItem[] = [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return completions;

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Get the text before the cursor to determine context
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineText = text.slice(lineStart, offset);
  const trimmedLine = lineText.trimStart();

  // Determine context for completions
  const afterDot = lineText.endsWith(".");
  const afterAt = lineText.endsWith("@");

  if (afterDot) {
    // Member access — suggest common methods/properties
    return getMemberCompletions();
  }

  if (afterAt) {
    // Confidence annotation context
    return [
      {
        label: "Confidence",
        kind: CompletionItemKind.TypeParameter,
        detail: "Confidence annotation",
        documentation: "Annotate a type with confidence tracking: `T @ Confidence`",
      },
    ];
  }

  // Top-level declaration keywords
  if (trimmedLine.length === 0 || isStartOfDeclaration(trimmedLine)) {
    completions.push(...getDeclarationKeywordCompletions());
  }

  // Statement-level keywords
  completions.push(...getStatementKeywordCompletions());

  // Identifiers from declarations in this document
  const declarations = declarationCache.get(params.textDocument.uri) ?? [];
  for (const decl of declarations) {
    const kindMap: Record<string, CompletionItemKind> = {
      function: CompletionItemKind.Function,
      val: CompletionItemKind.Variable,
      var: CompletionItemKind.Variable,
      entity: CompletionItemKind.Class,
      sealed: CompletionItemKind.Enum,
      interface: CompletionItemKind.Interface,
      type: CompletionItemKind.TypeParameter,
      intent: CompletionItemKind.Function,
      fuzzy: CompletionItemKind.Function,
      agent: CompletionItemKind.Class,
      module: CompletionItemKind.Module,
    };

    completions.push({
      label: decl.name,
      kind: kindMap[decl.kind] ?? CompletionItemKind.Text,
      detail: `${decl.kind} ${decl.name}`,
    });
  }

  // Built-in functions
  completions.push(...getBuiltinCompletions());

  // Type completions
  completions.push(...getTypeCompletions());

  return completions;
});

function isStartOfDeclaration(line: string): boolean {
  const starters = [
    "fun ",
    "val ",
    "var ",
    "data ",
    "entity ",
    "sealed ",
    "agent ",
    "intent ",
    "fuzzy ",
    "evolve ",
    "feature ",
    "context ",
    "resource ",
    "protocol ",
    "import ",
    "module ",
    "interface ",
    "type ",
  ];
  return starters.some((s) => line.startsWith(s));
}

function getDeclarationKeywordCompletions(): CompletionItem[] {
  return [
    {
      label: "fun",
      kind: CompletionItemKind.Keyword,
      detail: "Function declaration",
      insertText: "fun ${1:name}(${2:params}): ${3:ReturnType} {\n\t$0\n}",
      // Note: insertTextFormat would be Snippet (2) but we keep it simple
    },
    {
      label: "val",
      kind: CompletionItemKind.Keyword,
      detail: "Immutable value",
      insertText: "val ${1:name} = ",
    },
    {
      label: "var",
      kind: CompletionItemKind.Keyword,
      detail: "Mutable variable",
      insertText: "var ${1:name} = ",
    },
    {
      label: "data entity",
      kind: CompletionItemKind.Keyword,
      detail: "Data entity declaration",
      insertText: "data entity ${1:Name}(\n\tval ${2:field}: ${3:Type}\n)",
    },
    {
      label: "sealed",
      kind: CompletionItemKind.Keyword,
      detail: "Sealed type declaration",
      insertText: "sealed ${1:Name} {\n\tdata class ${2:Variant}(val ${3:field}: ${4:Type})\n}",
    },
    {
      label: "agent",
      kind: CompletionItemKind.Keyword,
      detail: "Agent declaration",
      insertText: "agent ${1:Name} {\n\tcontext {\n\t\t$0\n\t}\n\n\ttools {\n\t}\n\n\tboundaries {\n\t}\n}",
    },
    {
      label: "intent fun",
      kind: CompletionItemKind.Keyword,
      detail: "Intent function declaration",
      insertText:
        "intent fun ${1:name}(${2:input}: ${3:String}): ${4:String} {\n\tensure { $0 }\n\tprefer { }\n}",
    },
    {
      label: "fuzzy fun",
      kind: CompletionItemKind.Keyword,
      detail: "Fuzzy predicate declaration",
      insertText:
        "fuzzy fun ${1:name}(${2:input}: ${3:String}): Boolean @ Confidence {\n\tfactors {\n\t\t$0\n\t}\n}",
    },
    {
      label: "module",
      kind: CompletionItemKind.Keyword,
      detail: "Module declaration",
      insertText: "module ${1:Name}",
    },
    {
      label: "import",
      kind: CompletionItemKind.Keyword,
      detail: "Import declaration",
      insertText: 'import { ${1:name} } from "${2:module}"',
    },
    {
      label: "feature",
      kind: CompletionItemKind.Keyword,
      detail: "Feature specification",
      insertText: 'feature("${1:description}") {\n\tspec("${2:scenario}") {\n\t\t$0\n\t}\n}',
    },
    {
      label: "protocol",
      kind: CompletionItemKind.Keyword,
      detail: "Protocol declaration",
      insertText: "protocol ${1:Name} {\n\tmessage ${2:MessageName}(\n\t\tval ${3:field}: ${4:Type}\n\t)\n}",
    },
  ];
}

function getStatementKeywordCompletions(): CompletionItem[] {
  return [
    {
      label: "if",
      kind: CompletionItemKind.Keyword,
      detail: "Conditional expression",
    },
    {
      label: "when",
      kind: CompletionItemKind.Keyword,
      detail: "Pattern matching expression",
    },
    {
      label: "for",
      kind: CompletionItemKind.Keyword,
      detail: "For loop",
    },
    {
      label: "while",
      kind: CompletionItemKind.Keyword,
      detail: "While loop",
    },
    {
      label: "return",
      kind: CompletionItemKind.Keyword,
      detail: "Return statement",
    },
    {
      label: "try",
      kind: CompletionItemKind.Keyword,
      detail: "Try/catch block",
    },
    {
      label: "ensure",
      kind: CompletionItemKind.Keyword,
      detail: "Hard constraint (in intent functions)",
    },
    {
      label: "prefer",
      kind: CompletionItemKind.Keyword,
      detail: "Soft constraint (in intent functions)",
    },
    {
      label: "avoid",
      kind: CompletionItemKind.Keyword,
      detail: "Negative constraint (in intent functions)",
    },
    {
      label: "delegate",
      kind: CompletionItemKind.Keyword,
      detail: "Delegate work to a sub-agent",
    },
    {
      label: "spawn",
      kind: CompletionItemKind.Keyword,
      detail: "Create a new agent instance",
    },
    {
      label: "adapt",
      kind: CompletionItemKind.Keyword,
      detail: "Adaptation clause for failure handling",
    },
    {
      label: "fallback",
      kind: CompletionItemKind.Keyword,
      detail: "Fallback value when all else fails",
    },
    {
      label: "hint",
      kind: CompletionItemKind.Keyword,
      detail: "Hint for the intent resolver",
    },
  ];
}

function getMemberCompletions(): CompletionItem[] {
  // Common method completions after a dot
  return [
    { label: "map", kind: CompletionItemKind.Method, detail: "Transform each element" },
    { label: "filter", kind: CompletionItemKind.Method, detail: "Filter elements by predicate" },
    { label: "forEach", kind: CompletionItemKind.Method, detail: "Iterate over elements" },
    { label: "size", kind: CompletionItemKind.Property, detail: "Collection size" },
    { label: "isEmpty", kind: CompletionItemKind.Method, detail: "Check if empty" },
    { label: "isNotEmpty", kind: CompletionItemKind.Method, detail: "Check if not empty" },
    { label: "first", kind: CompletionItemKind.Method, detail: "Get first element" },
    { label: "last", kind: CompletionItemKind.Method, detail: "Get last element" },
    { label: "contains", kind: CompletionItemKind.Method, detail: "Check if element exists" },
    { label: "toList", kind: CompletionItemKind.Method, detail: "Convert to List" },
    { label: "toSet", kind: CompletionItemKind.Method, detail: "Convert to Set" },
    { label: "toString", kind: CompletionItemKind.Method, detail: "Convert to String" },
    { label: "copy", kind: CompletionItemKind.Method, detail: "Create a copy (entities)" },
    { label: "confidence", kind: CompletionItemKind.Property, detail: "Confidence value (@ types)" },
    { label: "value", kind: CompletionItemKind.Property, detail: "Unwrapped value (@ types)" },
    { label: "unwrap", kind: CompletionItemKind.Method, detail: "Unwrap confident value" },
    { label: "decompose", kind: CompletionItemKind.Method, detail: "Decompose into (value, confidence)" },
    { label: "add", kind: CompletionItemKind.Method, detail: "Add element (mutable collections)" },
    { label: "remove", kind: CompletionItemKind.Method, detail: "Remove element (mutable collections)" },
    { label: "sum", kind: CompletionItemKind.Method, detail: "Sum of numeric elements" },
    { label: "average", kind: CompletionItemKind.Method, detail: "Average of numeric elements" },
    { label: "maxBy", kind: CompletionItemKind.Method, detail: "Max element by selector" },
    { label: "minBy", kind: CompletionItemKind.Method, detail: "Min element by selector" },
    { label: "sortedBy", kind: CompletionItemKind.Method, detail: "Sort by selector" },
    { label: "joinToString", kind: CompletionItemKind.Method, detail: "Join elements as string" },
    { label: "flatMap", kind: CompletionItemKind.Method, detail: "Map and flatten" },
    { label: "any", kind: CompletionItemKind.Method, detail: "Check if any element matches" },
    { label: "all", kind: CompletionItemKind.Method, detail: "Check if all elements match" },
    { label: "none", kind: CompletionItemKind.Method, detail: "Check if no elements match" },
    { label: "length", kind: CompletionItemKind.Property, detail: "String length" },
    { label: "trim", kind: CompletionItemKind.Method, detail: "Trim whitespace" },
    { label: "uppercase", kind: CompletionItemKind.Method, detail: "Convert to uppercase" },
    { label: "lowercase", kind: CompletionItemKind.Method, detail: "Convert to lowercase" },
    { label: "split", kind: CompletionItemKind.Method, detail: "Split string by delimiter" },
    { label: "startsWith", kind: CompletionItemKind.Method, detail: "Check string prefix" },
    { label: "endsWith", kind: CompletionItemKind.Method, detail: "Check string suffix" },
    { label: "isNotBlank", kind: CompletionItemKind.Method, detail: "Check if string is not blank" },
  ];
}

function getBuiltinCompletions(): CompletionItem[] {
  return [
    {
      label: "println",
      kind: CompletionItemKind.Function,
      detail: "fun println(value: Any): Unit",
      documentation: "Print a value followed by a newline.",
    },
    {
      label: "print",
      kind: CompletionItemKind.Function,
      detail: "fun print(value: Any): Unit",
      documentation: "Print a value without a newline.",
    },
    {
      label: "readLine",
      kind: CompletionItemKind.Function,
      detail: "fun readLine(): String",
      documentation: "Read a line of text from stdin.",
    },
    {
      label: "listOf",
      kind: CompletionItemKind.Function,
      detail: "fun listOf(vararg elements: T): List<T>",
      documentation: "Create an immutable list.",
    },
    {
      label: "mutableListOf",
      kind: CompletionItemKind.Function,
      detail: "fun mutableListOf(vararg elements: T): MutableList<T>",
      documentation: "Create a mutable list.",
    },
    {
      label: "mapOf",
      kind: CompletionItemKind.Function,
      detail: "fun mapOf(vararg pairs: Pair<K, V>): Map<K, V>",
      documentation: "Create an immutable map.",
    },
    {
      label: "mutableMapOf",
      kind: CompletionItemKind.Function,
      detail: "fun mutableMapOf(vararg pairs: Pair<K, V>): MutableMap<K, V>",
      documentation: "Create a mutable map.",
    },
    {
      label: "require",
      kind: CompletionItemKind.Function,
      detail: "fun require(condition: Boolean): Unit",
      documentation: "Assert a condition at runtime.",
    },
    {
      label: "toString",
      kind: CompletionItemKind.Function,
      detail: "fun toString(value: Any): String",
      documentation: "Convert a value to a string.",
    },
  ];
}

function getTypeCompletions(): CompletionItem[] {
  return [
    { label: "Int", kind: CompletionItemKind.TypeParameter, detail: "Integer type" },
    { label: "Float", kind: CompletionItemKind.TypeParameter, detail: "Floating-point type" },
    { label: "String", kind: CompletionItemKind.TypeParameter, detail: "String type" },
    { label: "Boolean", kind: CompletionItemKind.TypeParameter, detail: "Boolean type" },
    { label: "Bool", kind: CompletionItemKind.TypeParameter, detail: "Boolean type (alias)" },
    { label: "Unit", kind: CompletionItemKind.TypeParameter, detail: "Unit type (void)" },
    { label: "Any", kind: CompletionItemKind.TypeParameter, detail: "Top type" },
    { label: "Null", kind: CompletionItemKind.TypeParameter, detail: "Null type" },
    { label: "NL", kind: CompletionItemKind.TypeParameter, detail: "Natural Language type" },
    { label: "ID", kind: CompletionItemKind.TypeParameter, detail: "Identifier type" },
    { label: "DateTime", kind: CompletionItemKind.TypeParameter, detail: "Date/time type" },
    { label: "List", kind: CompletionItemKind.TypeParameter, detail: "Immutable list type" },
    { label: "MutableList", kind: CompletionItemKind.TypeParameter, detail: "Mutable list type" },
    { label: "Map", kind: CompletionItemKind.TypeParameter, detail: "Immutable map type" },
    { label: "MutableMap", kind: CompletionItemKind.TypeParameter, detail: "Mutable map type" },
    { label: "Set", kind: CompletionItemKind.TypeParameter, detail: "Immutable set type" },
    { label: "Result", kind: CompletionItemKind.TypeParameter, detail: "Result type" },
    { label: "Confidence", kind: CompletionItemKind.TypeParameter, detail: "Confidence annotation type" },
  ];
}

// -- Start --------------------------------------------------------------------

documents.listen(connection);
connection.listen();
