/**
 * Anima VS Code Extension
 *
 * Activates the Anima Language Server Protocol client for `.anima` files.
 * Provides syntax diagnostics, hover, go-to-definition, and completions.
 */

import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("anima.lsp");
  const customServerPath = config.get<string>("serverPath", "");

  // Resolve the LSP server module path
  // Priority: 1) user-configured path, 2) bundled server relative to extension
  let serverModule: string;
  if (customServerPath) {
    serverModule = customServerPath;
  } else {
    // The LSP server lives at ../../lsp/dist/server.js relative to the extension dist/
    // In a published extension, it would be bundled differently.
    // For development, we point to the monorepo lsp package.
    serverModule = context.asAbsolutePath(path.join("..", "..", "lsp", "dist", "server.js"));
  }

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.stdio,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: {
        execArgv: ["--nolazy", "--inspect=6009"],
      },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "anima" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.anima"),
    },
    outputChannelName: "Anima Language Server",
  };

  client = new LanguageClient("anima-lsp", "Anima Language Server", serverOptions, clientOptions);

  client.start();

  context.subscriptions.push({
    dispose: () => {
      if (client) {
        client.stop();
      }
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
