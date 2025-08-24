import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import * as path from 'path';
import * as fs from 'fs';

// Diagnostic collection for KRL language
const diagnosticCollection = vscode.languages.createDiagnosticCollection('krl');
let client: LanguageClient;

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext) {
  

  // Path to the language server module
  const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

  // Server options for run and debug modes
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };

  // Client options, including document selector and file watchers
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'krl' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{dat,src,sub}')
    }
  };

  // Create the language client
  client = new LanguageClient('kukaKRL', 'KUKA KRL Language Server', serverOptions, clientOptions);

  // Register event handlers for document open/change/save
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => {
      if (document.languageId === 'krl') {
        validateTextDocument(document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.languageId === 'krl') {
        validateTextDocument(event.document);
        client.sendNotification('custom/validateFile', {
          uri: event.document.uri.toString(),
          text: event.document.getText(),
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.languageId === 'krl') {
        validateTextDocument(document);
      }
    })
  );

  // Start the language client
  client.start().then(() => {    
  
  commandsHandler(context, client);
  
    // After client starts, validate all already opened KRL documents
    vscode.workspace.textDocuments.forEach(doc => {
      if (doc.languageId === 'krl') {
        validateTextDocument(doc);
      }
    });

    // Also trigger a full workspace validation shortly after activation
    setTimeout(() => {
      validateAllKrlFiles();
    }, 1000);
  });
  


  // Dispose the diagnostic collection on extension deactivate
  context.subscriptions.push(diagnosticCollection);
}



/**
 * Validate a single KRL text document
 * Produces diagnostics for variable name length and improper GLOBAL usage
 */
function validateTextDocument(document: vscode.TextDocument): void {
  const diagnostics: vscode.Diagnostic[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    try {
      const line = document.lineAt(i);
      const fullText = line.text;
      const lineText = fullText.split(';')[0].trim(); // Ignore comments

      // Check variable length in DECL, STRUC, SIGNAL lines
      if (/\b(DECL|STRUC|SIGNAL)\b/i.test(lineText)) {
        // Remove keywords to isolate variable part
        const varPart = lineText
          .replace(/\bDECL\b/i, '')
          .replace(/\bGLOBAL\b/i, '')
          .replace(/\b(INT|FRAME|LOAD|REAL|BOOL|STRING|SIGNAL|STRUC)\b/i, '')
          .replace(/\b\w+_T\b/i, '')
          .trim();

        // Split variables and validate length
        const variableTokens = varPart.split(',').map(v => v.trim());

        for (const token of variableTokens) {
          const rawVar = token.split('=')[0].split('[')[0].trim();
          const match = rawVar.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
          const varName = match ? match[1] : null;

          if (varName && varName.length > 24) {
            const varIndex = fullText.indexOf(varName);
            if (varIndex >= 0) {
              const range = new vscode.Range(i, varIndex, i, varIndex + varName.length);
              diagnostics.push(new vscode.Diagnostic(
                range,
                'The variable name is too long (max 24 characters).',
                vscode.DiagnosticSeverity.Error
              ));
            }
          }
        }
      }

      // Check for standalone GLOBAL usage without DECL, DEF, DEFFCT, STRUC, SIGNAL
      if (/\bGLOBAL\b/i.test(lineText) && !/\b(DECL|DEF|DEFFCT|STRUC|SIGNAL|ENUM)\b/i.test(lineText)&& !/\b(INT|REAL|FRAME|CHAR|BOOL|STRING|E6AXIS|E6POS|AXIS|LOAD)\b/i.test(lineText)) {
        const globalIndex = fullText.indexOf('GLOBAL');
        const range = new vscode.Range(i, globalIndex, i, globalIndex + 'GLOBAL'.length);
        diagnostics.push(new vscode.Diagnostic(
          range,
          `'GLOBAL' must be used with DECL, STRUC, or SIGNAL on the same line, except if it's used with a predefined types.`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
    } catch (error) {
      console.error(`Error processing line ${i + 1}:`, error);
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Validate all KRL files in the workspace with extensions .src, .dat, .sub
 */
async function validateAllKrlFiles(): Promise<void> {
  const patterns = ['**/*.src', '**/*.dat', '**/*.sub'];
  const uris: vscode.Uri[] = [];

  // Collect all matching files
  for (const pattern of patterns) {
    const matched = await vscode.workspace.findFiles(pattern);
    uris.push(...matched);
  }

  // Validate each file (opening it if needed)
  for (const file of uris) {
    try {
      let document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === file.fsPath);
      if (!document) {
        document = await vscode.workspace.openTextDocument(file);
      }
      // Only validate if languageId is one of the KRL types (some files might not be recognized)
      if (['src', 'dat', 'sub'].includes(document.languageId)) {
        validateTextDocument(document);
      }
    } catch (error) {
      console.error(`Failed to validate ${file.fsPath}`, error);
    }
  }
}

/**
 * Append a timestamped message to the log file.
 */

const logFile = path.join(__dirname, 'krl-extension.log');
function logToFile(message: string) {
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}

/**
 * Extension deactivation handler
 */
export function deactivate(): Thenable<void> | undefined {
  diagnosticCollection.clear();
  diagnosticCollection.dispose();
  if (!client) return undefined;
  return client.stop();
}


function commandsHandler(context: vscode.ExtensionContext, client: LanguageClient) {
  
  //at init only
  sendSettingsToServer(client);

  // === Toggle DEFDAT Validation ===
  const toggleCmd = vscode.commands.registerCommand(
    "kuka-krl-assistant.toggleDefdatValidation",
    () => {
      const config = vscode.workspace.getConfiguration("kuka-krl-assistant");
      const current = config.get<boolean>("defdatValidation", true);
      config.update("defdatValidation", !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `DEFDAT Validation is now ${!current ? "enabled" : "disabled"}`
      );
    } 
  );
  context.subscriptions.push(toggleCmd);

  // === Track config changes and notify server ===
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("kuka-krl-assistant.defdatValidation")) {
      sendSettingsToServer(client);
    }
  });

  // === Status Summary Command ===
  const outputChannel = vscode.window.createOutputChannel("KUKA KRL Assistant");
  const disposable = vscode.commands.registerCommand(
    "kuka-krl-assistant.showStatus",
    () => {
      const config = vscode.workspace.getConfiguration("kuka-krl-assistant");

      outputChannel.clear();
      outputChannel.appendLine("=== KUKA KRL Assistant Settings Summary ===");
      outputChannel.appendLine(`DEFDAT validation: ${config.get("defdatValidation", false)}`);

      outputChannel.show(true);
    }
  );
  context.subscriptions.push(disposable);
}

function sendSettingsToServer(client: LanguageClient) {
  let config = vscode.workspace.getConfiguration("kuka-krl-assistant");
  let payload = {
      defdatValidation: config.get<boolean>("defdatValidation", true)
       };
    client.sendNotification("custom/settings", payload);
}