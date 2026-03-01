/**
 * Anima MCP Server
 *
 * Provides validation, parsing, execution, scaffolding, and reference resources
 * for the Anima language via the Model Context Protocol. Coding agents connect
 * to this server to get fast feedback on Anima code they generate.
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

interface TypeDiagnostic {
  severity: string;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
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

// -- Type checker integration -------------------------------------------------

// Load the type checker dynamically (same approach as interpreter/src/index.ts)
let TypeCheckerModule: { TypeChecker: any; formatDiagnostic: (d: any) => string } | null = null;
try {
  const checker = require("../../typechecker/src/checker");
  const diagnostics = require("../../typechecker/src/diagnostics");
  TypeCheckerModule = {
    TypeChecker: checker.TypeChecker,
    formatDiagnostic: diagnostics.formatDiagnostic,
  };
} catch {
  // Type checker not available — validate will do parse-only checking
}

/**
 * Run the type checker on a parsed AST root node.
 * Returns an array of diagnostics, or an empty array if the checker is unavailable.
 */
function runTypeChecker(rootNode: any): TypeDiagnostic[] {
  if (!TypeCheckerModule) return [];
  try {
    const checker = new TypeCheckerModule.TypeChecker();
    return checker.check(rootNode) as TypeDiagnostic[];
  } catch {
    return [];
  }
}

// -- Interpreter integration --------------------------------------------------

// Load the interpreter dynamically
let InterpreterModule: { Interpreter: any; parse: (source: string) => any } | null = null;
try {
  const interpreter = require("../../interpreter/src/interpreter");
  const parser = require("../../interpreter/src/parser");
  InterpreterModule = {
    Interpreter: interpreter.Interpreter,
    parse: parser.parse,
  };
} catch {
  // Interpreter not available
}

// -- Scaffold templates -------------------------------------------------------

const SCAFFOLD_TEMPLATES: Record<string, { description: string; code: string }> = {
  entity: {
    description: "Data entity with fields, invariants, and computed properties",
    code: `// Data Entity Template
// Replace "MyEntity" and fields with your domain model.

data entity MyEntity(
    val id: ID,
    val name: String,
    val value: Float,
    val active: Boolean = true
) {
    invariant { name.isNotBlank() }
    invariant { value >= 0.0 }

    fun summary(): String = "\${name}: \${value}"
}
`,
  },
  agent: {
    description: "Agent with context, tools, boundaries, and an intent function",
    code: `// Agent Template
// Replace "MyAgent" and customize context, tools, and boundaries.

agent MyAgent(
    private val config: String = "default"
) {
    context {
        var requestCount: Int = 0
        val history: MutableList<String> = mutableListOf()
    }

    tools {
        fun fetchData(query: String): String
        fun processResult(data: String): Result<String>
    }

    boundaries {
        maxCost = 1.0.dollars per request
        maxTime = 30.seconds per decision

        can { readData; processData; generateReports }
        cannot { deleteData; modifyConfig; accessCredentials }
    }

    intent fun handleRequest(input: NL): String {
        ensure { output.isNotBlank() }
        prefer { output.isRelevantTo(input) }
        avoid  { output.containsSensitiveData() }

        val data = fetchData(input)
        val result = processResult(data)

        context.requestCount++
        context.history.add(input)

        return result.getOrDefault("No result available")

        adapt<DataUnavailable> {
            hint("primary data source unavailable, use cached data")
            fallback { "Service temporarily unavailable" }
        }
    }
}
`,
  },
  intent: {
    description: "Intent function with constraints, hints, and adaptation",
    code: `// Intent Function Template
// Replace "myIntent" and customize constraints.

intent fun myIntent(input: String, context: NL): String {
    given { val relevantData = fetchContext(context) }

    ensure { output.isNotBlank() }
    ensure { output.length <= 1000 }

    prefer { output.isRelevantTo(input) }
    prefer { output.isConcise() }

    avoid { output.containsBias() }
    avoid { output.isRedundant(relevantData) }

    hint("focus on actionable insights")

    cost {
        maxTokens = 500
    }

    adapt<InsufficientContext> {
        hint("not enough context, ask for clarification")
        ask(input, "Could you provide more details?")
    }

    fallback {
        "Unable to process request with available information"
    }
}
`,
  },
  fuzzy: {
    description: "Fuzzy predicate with weighted factors and confidence output",
    code: `// Fuzzy Predicate Template
// Replace "isRelevant" and customize factors.

fuzzy fun isRelevant(item: String, query: String): Boolean @ Confidence {
    factors {
        // Each factor contributes a weighted score
        semanticSimilarity(item, query) weight 0.4
        keywordOverlap(item, query) weight 0.3
        recency(item) weight 0.2
        userPreference(item) weight 0.1
    }

    // Thresholds for the fused confidence
    ensure { confidence > 0.3 }
    prefer { confidence > 0.7 }
}
`,
  },
};

// -- Spec documents mapping ---------------------------------------------------

const SPEC_FILES: Array<{ slug: string; filename: string; title: string }> = [
  { slug: "overview", filename: "01-overview.md", title: "Language Overview" },
  { slug: "grammar", filename: "02-grammar.md", title: "Grammar Reference" },
  { slug: "type-system", filename: "03-type-system.md", title: "Type System" },
  { slug: "intents", filename: "04-intents.md", title: "Intents" },
  { slug: "agents", filename: "05-agents.md", title: "Agents" },
  { slug: "memory-model", filename: "06-memory-model.md", title: "Memory Model" },
  { slug: "evolution-engine", filename: "07-evolution-engine.md", title: "Evolution Engine" },
  { slug: "error-model", filename: "08-error-model.md", title: "Error Model" },
  { slug: "runtime-architecture", filename: "09-runtime-architecture.md", title: "Runtime Architecture" },
  { slug: "type-system-formal", filename: "10-type-system-formal.md", title: "Type System (Formal)" },
  { slug: "execution-model", filename: "11-execution-model.md", title: "Execution Model" },
  { slug: "confidence-propagation", filename: "12-confidence-propagation.md", title: "Confidence Propagation" },
];

// -- MCP server ---------------------------------------------------------------

const server = new McpServer({
  name: "anima",
  version: "0.3.0",
});

// Tool handlers defined separately to avoid TS2589 (excessively deep type
// instantiation) caused by the MCP SDK's zod v3/v4 compat layer.

async function handleValidate(args: { code: string }) {
  const parser = createParser();
  const tree = parser.parse(args.code);
  const parseErrors: ParseError[] = [];
  collectErrors(tree.rootNode, parseErrors);

  // Run type checker in addition to parse validation
  const typeDiagnostics = runTypeChecker(tree.rootNode);
  const typeErrors = typeDiagnostics.filter((d) => d.severity === "error");
  const typeWarnings = typeDiagnostics.filter((d) => d.severity === "warning");

  const result = {
    valid: parseErrors.length === 0 && typeErrors.length === 0,
    parseErrors,
    typeErrors: typeErrors.map((d) => ({
      line: d.line,
      column: d.column,
      message: d.message,
    })),
    typeWarnings: typeWarnings.map((d) => ({
      line: d.line,
      column: d.column,
      message: d.message,
    })),
    // Keep backward-compatible 'errors' field (union of parse + type errors)
    errors: [
      ...parseErrors,
      ...typeErrors.map((d) => ({
        line: d.line,
        column: d.column,
        message: `[type] ${d.message}`,
      })),
    ],
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

async function handleExecute(args: { code: string; timeout?: number }) {
  if (!InterpreterModule) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { success: false, error: "Interpreter not available. Ensure the interpreter package is built." },
            null,
            2,
          ),
        },
      ],
    };
  }

  const timeoutMs = Math.min(args.timeout ?? 10000, 30000); // default 10s, max 30s

  // Parse the source code
  let parseResult: any;
  try {
    parseResult = InterpreterModule.parse(args.code);
  } catch (e: any) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ success: false, error: `Parse error: ${e.message}` }, null, 2),
        },
      ],
    };
  }

  if (parseResult.hasErrors && parseResult.errors.length > 0) {
    // Still attempt execution — tree-sitter produces partial trees
  }

  // Capture stdout by temporarily replacing process.stdout.write
  const outputChunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = function (chunk: any, ...rest: any[]): boolean {
    if (typeof chunk === "string") {
      outputChunks.push(chunk);
    } else if (Buffer.isBuffer(chunk)) {
      outputChunks.push(chunk.toString());
    }
    return true;
  } as any;

  let success = false;
  let error: string | undefined;
  let timedOut = false;

  try {
    // Run with a timeout
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        try {
          const interpreter = new InterpreterModule!.Interpreter();
          interpreter.run(parseResult.rootNode);
          resolve();
        } catch (e: any) {
          reject(e);
        }
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
    success = true;
  } catch (e: any) {
    error = e.message ?? String(e);
  } finally {
    // Restore stdout
    process.stdout.write = originalWrite;
  }

  const output = outputChunks.join("");

  const result: Record<string, unknown> = {
    success,
    output,
  };

  if (parseResult.hasErrors) {
    result.parseErrors = parseResult.errors.map((e: any) => ({
      line: e.line,
      column: e.column,
      message: e.message,
    }));
  }

  if (error) {
    result.error = error;
    if (timedOut) {
      result.timedOut = true;
    }
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

async function handleScaffold(args: { pattern: string; name?: string }) {
  const pattern = args.pattern.toLowerCase().trim();
  const template = SCAFFOLD_TEMPLATES[pattern];

  if (!template) {
    const available = Object.keys(SCAFFOLD_TEMPLATES).join(", ");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `Unknown pattern "${args.pattern}". Available patterns: ${available}`,
              availablePatterns: Object.entries(SCAFFOLD_TEMPLATES).map(([key, val]) => ({
                pattern: key,
                description: val.description,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  let code = template.code;

  // Replace placeholder names if a custom name was provided
  if (args.name) {
    const placeholders: Record<string, string> = {
      entity: "MyEntity",
      agent: "MyAgent",
      intent: "myIntent",
      fuzzy: "isRelevant",
    };
    const placeholder = placeholders[pattern];
    if (placeholder) {
      code = code.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), args.name);
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            pattern,
            description: template.description,
            code,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// -- Register tools -----------------------------------------------------------

// Tool: anima_validate
(server.registerTool as Function)(
  "anima_validate",
  {
    description:
      "Validate Anima source code for syntax and type errors. Returns parse errors, type errors, and type warnings with line/column locations.",
    inputSchema: { code: z.string() },
  },
  handleValidate,
);

// Tool: anima_parse
(server.registerTool as Function)(
  "anima_parse",
  {
    description: "Parse Anima source code and return a compact S-expression summary of the AST.",
    inputSchema: { code: z.string() },
  },
  handleParse,
);

// Tool: anima_execute
(server.registerTool as Function)(
  "anima_execute",
  {
    description:
      "Execute Anima source code and return the captured stdout output. " +
      "Runs the code through the tree-sitter parser and tree-walking interpreter. " +
      "Timeout defaults to 10 seconds (max 30 seconds).",
    inputSchema: {
      code: z.string().describe("Anima source code to execute"),
      timeout: z.number().optional().describe("Execution timeout in milliseconds (default 10000, max 30000)"),
    },
  },
  handleExecute,
);

// Tool: anima_scaffold
(server.registerTool as Function)(
  "anima_scaffold",
  {
    description:
      'Generate boilerplate code for common Anima patterns. ' +
      'Available patterns: "entity" (data entity with invariants), ' +
      '"agent" (agent with context/tools/boundaries), ' +
      '"intent" (intent function with constraints), ' +
      '"fuzzy" (fuzzy predicate with weighted factors).',
    inputSchema: {
      pattern: z
        .string()
        .describe('The pattern to scaffold: "entity", "agent", "intent", or "fuzzy"'),
      name: z
        .string()
        .optional()
        .describe("Custom name for the generated construct (replaces the placeholder name)"),
    },
  },
  handleScaffold,
);

// -- Register resources -------------------------------------------------------

// Resource: anima://coding-guide
server.registerResource(
  "coding-guide",
  "anima://coding-guide",
  {
    description:
      "Comprehensive coding guide for writing Anima code. Covers all syntax, AI-first constructs (intents, agents, confidence types, fuzzy predicates, evolving functions), and common patterns.",
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
  },
);

// Resource: anima://grammar-reference
server.registerResource(
  "grammar-reference",
  "anima://grammar-reference",
  {
    description:
      "Formal EBNF grammar reference for the Anima language. Defines every syntactic construct: declarations, expressions, types, statements, and literals.",
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
  },
);

// Spec document resources: anima://spec/{slug}
for (const spec of SPEC_FILES) {
  server.registerResource(
    `spec-${spec.slug}`,
    `anima://spec/${spec.slug}`,
    {
      description: `Anima language specification: ${spec.title}`,
      mimeType: "text/markdown",
    },
    async (uri) => {
      const specPath = path.resolve(__dirname, `../../docs/spec/${spec.filename}`);
      let text: string;
      try {
        text = fs.readFileSync(specPath, "utf-8");
      } catch {
        text = `# ${spec.title}\n\nSpec document not found. Expected at: docs/spec/${spec.filename}`;
      }
      return {
        contents: [{ uri: uri.href, text, mimeType: "text/markdown" }],
      };
    },
  );
}

// Example file resources: anima://examples/{name}
// Discover example files at startup
const examplesDir = path.resolve(__dirname, "../../examples");
try {
  const exampleFiles = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".anima"));
  for (const filename of exampleFiles) {
    const name = filename.replace(/\.anima$/, "");
    server.registerResource(
      `example-${name}`,
      `anima://examples/${name}`,
      {
        description: `Anima example program: ${name.replace(/-/g, " ")}`,
        mimeType: "text/plain",
      },
      async (uri) => {
        const filePath = path.join(examplesDir, filename);
        let text: string;
        try {
          text = fs.readFileSync(filePath, "utf-8");
        } catch {
          text = `// Example not found: ${filename}`;
        }
        return {
          contents: [{ uri: uri.href, text, mimeType: "text/plain" }],
        };
      },
    );
  }
} catch {
  // examples directory not found — skip
}

// -- start --------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting Anima MCP server:", err);
  process.exit(1);
});
