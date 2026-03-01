# Anima MCP Server

MCP (Model Context Protocol) server that provides Anima language validation and reference resources to coding agents.

## What it does

- **`anima_validate`** tool -- Validates Anima source code and returns syntax errors with line/column locations
- **`anima_parse`** tool -- Parses Anima code and returns a compact AST summary
- **`anima://coding-guide`** resource -- The full Anima coding guide for agents
- **`anima://grammar-reference`** resource -- The formal EBNF grammar

## Install

```bash
cd mcp-server
npm install
```

Note: This requires the tree-sitter-anima native bindings to be built. If you haven't done that yet:

```bash
cd ../tree-sitter-anima
npx tree-sitter generate
npm install
cd ../mcp-server
npm install
```

## Typecheck

```bash
npx tsc --noEmit
```

## Add to Claude Code

In your project's `.claude/settings.json` (or `~/.claude/settings.json` for global):

```json
{
  "mcpServers": {
    "anima": {
      "command": "npx",
      "args": ["ts-node", "src/index.ts"],
      "cwd": "/absolute/path/to/anima/mcp-server"
    }
  }
}
```

## Add to Cursor

In `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "anima": {
      "command": "npx",
      "args": ["ts-node", "src/index.ts"],
      "cwd": "/absolute/path/to/anima/mcp-server"
    }
  }
}
```

## Add to VS Code (Copilot)

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "anima": {
      "command": "npx",
      "args": ["ts-node", "src/index.ts"],
      "cwd": "/absolute/path/to/anima/mcp-server"
    }
  }
}
```

## Add to Windsurf

In `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "anima": {
      "command": "npx",
      "args": ["ts-node", "src/index.ts"],
      "cwd": "/absolute/path/to/anima/mcp-server"
    }
  }
}
```

## Usage

Once connected, agents can call:

```
anima_validate({ code: "fun hello() { println(\"hi\") }" })
```

Response:
```json
{
  "valid": true,
  "errors": []
}
```

```
anima_validate({ code: "fun hello( { }" })
```

Response:
```json
{
  "valid": false,
  "errors": [
    { "line": 1, "column": 11, "message": "Syntax error at: {" }
  ]
}
```

Agents can also read `anima://coding-guide` to learn the full Anima syntax before writing code.
