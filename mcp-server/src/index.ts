/**
 * Anima MCP Server
 *
 * Provides validation, parsing, and reference resources for the Anima language
 * via the Model Context Protocol. Coding agents connect to this server to get
 * fast feedback on Anima code they generate.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// -- tree-sitter setup --------------------------------------------------------

const Parser = require("tree-sitter");
const AnimaLanguage = require("tree-sitter-anima");

interface ParseError {
  line: number;
  column: number;
  message: string;
}

function createParser(): any {
  const parser = new Parser();
  parser.setLanguage(AnimaLanguage);
  return parser;
}

/**
 * Recursively collect ERROR and MISSING nodes from a tree-sitter parse tree.
 */
function collectErrors(node: any, errors: ParseError[]): void {
  if (node.type === "ERROR" || node.isMissing) {
    errors.push({
      message: node.isMissing
        ? `Missing expected node: ${node.type}`
        : `Syntax error at: ${node.text.slice(0, 80)}`,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    });
  }
  for (let i = 0; i < node.childCount; i++) {
    collectErrors(node.child(i), errors);
  }
}

/**
 * Build a compact S-expression summary of the AST, truncated to a
 * reasonable depth/length so it stays useful as context.
 */
function astSummary(node: any, depth: number = 0, maxDepth: number = 8): string {
  if (depth >= maxDepth) {
    return node.childCount > 0 ? `(${node.type} ...)` : node.type;
  }

  if (node.childCount === 0) {
    // Leaf node -- include text for named nodes
    if (node.isNamed) {
      const text = node.text.length > 40 ? node.text.slice(0, 40) + "..." : node.text;
      return `(${node.type} "${text}")`;
    }
    return "";
  }

  const children: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child.isNamed) continue; // skip anonymous tokens like ( ) { } ,
    const s = astSummary(child, depth + 1, maxDepth);
    if (s) children.push(s);
  }

  if (children.length === 0) {
    return `(${node.type})`;
  }

  return `(${node.type} ${children.join(" ")})`;
}

// -- MCP server ---------------------------------------------------------------

const server = new McpServer({
  name: "anima",
  version: "0.2.0",
});

// Tool handlers defined separately to avoid TS2589 (excessively deep type
// instantiation) caused by the MCP SDK's zod v3/v4 compat layer.

async function handleValidate(args: { code: string }) {
  const parser = createParser();
  const tree = parser.parse(args.code);
  const errors: ParseError[] = [];
  collectErrors(tree.rootNode, errors);

  const result = {
    valid: errors.length === 0,
    errors,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

async function handleParse(args: { code: string }) {
  const parser = createParser();
  const tree = parser.parse(args.code);
  const errors: ParseError[] = [];
  collectErrors(tree.rootNode, errors);
  const summary = astSummary(tree.rootNode);

  const result = {
    ast: summary,
    valid: errors.length === 0,
    errors,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

// Tool: anima_validate
(server.registerTool as Function)(
  "anima_validate",
  {
    description: "Validate Anima source code for syntax errors. Returns a list of errors with line/column locations, or an empty list if the code is valid.",
    inputSchema: { code: z.string() },
  },
  handleValidate
);

// Tool: anima_parse
(server.registerTool as Function)(
  "anima_parse",
  {
    description: "Parse Anima source code and return a compact S-expression summary of the AST.",
    inputSchema: { code: z.string() },
  },
  handleParse
);

// Resource: anima://coding-guide
server.registerResource(
  "coding-guide",
  "anima://coding-guide",
  {
    description: "Comprehensive coding guide for writing Anima code. Covers all syntax, AI-first constructs (intents, agents, confidence types, fuzzy predicates, evolving functions), and common patterns.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const guidePath = path.resolve(__dirname, "../../docs/coding-guide.md");
    let text: string;
    try {
      text = fs.readFileSync(guidePath, "utf-8");
    } catch {
      text = "# Coding Guide\n\nCoding guide not found. Expected at: docs/coding-guide.md";
    }
    return {
      contents: [{ uri: uri.href, text, mimeType: "text/markdown" }],
    };
  }
);

// Resource: anima://grammar-reference
server.registerResource(
  "grammar-reference",
  "anima://grammar-reference",
  {
    description: "Formal EBNF grammar reference for the Anima language. Defines every syntactic construct: declarations, expressions, types, statements, and literals.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const grammarPath = path.resolve(__dirname, "../../grammar/anima.ebnf");
    let text: string;
    try {
      text = fs.readFileSync(grammarPath, "utf-8");
    } catch {
      text = "(grammar reference not found -- expected at grammar/anima.ebnf)";
    }
    return {
      contents: [{ uri: uri.href, text, mimeType: "text/plain" }],
    };
  }
);

// -- start --------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting Anima MCP server:", err);
  process.exit(1);
});
