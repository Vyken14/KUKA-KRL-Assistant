import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import * as path from 'path';

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

  // Register definition provider
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider('krl', {
      async provideDefinition(document, position) {
        return provideDefinitionHandler(document, position);
      }
    })
  );

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
 * Handler for providing definition locations for a symbol in a document
 */
async function provideDefinitionHandler(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Location | null | undefined> {
  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) return null;

  const word = document.getText(wordRange);
  const lines = document.getText().split('\n');

  // Search current document for DECL, SIGNAL or STRUC lines containing the word
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if ((line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) && line.includes(word)) {
      const varRegex = new RegExp(`\\b${word}\\b`);
      if (varRegex.test(line)) {
        const startIdx = rawLine.indexOf(word);
        if (startIdx >= 0) {
          return new vscode.Location(
            document.uri,
            new vscode.Range(new vscode.Position(i, startIdx), new vscode.Position(i, startIdx + word.length))
          );
        }
      }
    }
  }

  // If not found in current doc, search other workspace files of relevant extensions
  const files = await vscode.workspace.findFiles('**/*.{src,dat,sub}', '**/node_modules/**');

  for (const file of files) {
    if (file.fsPath === document.uri.fsPath) continue; // Skip current document

    const otherDoc = await vscode.workspace.openTextDocument(file);
    const otherLines = otherDoc.getText().split('\n');

    for (let i = 0; i < otherLines.length; i++) {
      const rawLine = otherLines[i];
      const line = rawLine.trim();

      if ((line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) && line.includes(word)) {
        const varRegex = new RegExp(`\\b${word}\\b`);
        if (varRegex.test(line)) {
          const startIdx = rawLine.indexOf(word);
          if (startIdx >= 0) {
            return new vscode.Location(
              file,
              new vscode.Range(new vscode.Position(i, startIdx), new vscode.Position(i, startIdx + word.length))
            );
          }
        }
      }
    }
  }

  return null;
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
      if (/\bGLOBAL\b/i.test(lineText) && !/\b(DECL|DEF|DEFFCT|STRUC|SIGNAL|ENUM)\b/i.test(lineText)) {
        const globalIndex = fullText.indexOf('GLOBAL');
        const range = new vscode.Range(i, globalIndex, i, globalIndex + 'GLOBAL'.length);
        diagnostics.push(new vscode.Diagnostic(
          range,
          `'GLOBAL' must be used with DECL, STRUC, or SIGNAL on the same line.`,
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
 * Extension deactivation handler
 */
export function deactivate(): Thenable<void> | undefined {
  diagnosticCollection.clear();
  diagnosticCollection.dispose();
  if (!client) return undefined;
  return client.stop();
}
