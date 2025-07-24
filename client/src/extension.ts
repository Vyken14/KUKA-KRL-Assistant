import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import * as path from 'path';


const diagnosticCollection = vscode.languages.createDiagnosticCollection('krl');

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension activated');
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'krl' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
    }
  };

  client = new LanguageClient(
    'kukaKRL',
    'KUKA KRL Language Server',
    serverOptions,
    clientOptions
  );


  context.subscriptions.push(  vscode.languages.registerDefinitionProvider('krl', {
  async provideDefinition(document, position, token) {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return;

    const word = document.getText(wordRange);

    // First: check current file
    const lines = document.getText().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      if (
        (line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) &&
        line.includes(word)
      ) {
        const varRegex = new RegExp(`\\b${word}\\b`);
        if (varRegex.test(line)) {
          const startIdx = rawLine.indexOf(word);
          if (startIdx >= 0) {
            const start = new vscode.Position(i, startIdx);
            const end = new vscode.Position(i, startIdx + word.length);
            return new vscode.Location(document.uri, new vscode.Range(start, end));
          }

        }
      }
    }

    // Then: check other files in workspace
    const files = await vscode.workspace.findFiles('**/*.{src,dat,sub}', '**/node_modules/**');

    for (const file of files) {
      if (file.fsPath === document.uri.fsPath) continue;

      const otherDoc = await vscode.workspace.openTextDocument(file);
      const otherLines = otherDoc.getText().split('\n');

      for (let i = 0; i < otherLines.length; i++) {
        const rawLine = otherLines[i];
        const line = rawLine.trim();

        if (
          (line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) &&
          line.includes(word)
        ) {
          const varRegex = new RegExp(`\\b${word}\\b`);
          if (varRegex.test(line)) {
            const startIdx = rawLine.indexOf(word);
            if (startIdx >= 0) {
              const start = new vscode.Position(i, startIdx);
              const end = new vscode.Position(i, startIdx + word.length);
              return new vscode.Location(file, new vscode.Range(start, end));
            }

          }
        }
      }
    }

    return null;
  }
})

  )
context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
  const document = event.document;
  if (document.languageId !== 'krl') return;

  const diagnostics: vscode.Diagnostic[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    try {
      const line = document.lineAt(i);
      const fullText = line.text.trim();
      const lineText = fullText.split(';')[0].trim();

      // Check if line contains DECL, STRUC, SIGNAL anywhere (case-insensitive)
      if (/\b(DECL|STRUC|SIGNAL)\b/i.test(lineText)) {
        console.log(`Processing line ${i + 1}: ${lineText}`);

        // Remove DECL, STRUC, SIGNAL, GLOBAL, and types from start to isolate variables part
        // Example: DECL GLOBAL INT var1=5, var2
        // We'll remove leading keywords, then split vars by comma
        const varPart = lineText
          // Remove keywords at start
          .replace(/\bDECL\b/i, '')
          .replace(/\bGLOBAL\b/i, '')
          .replace(/\b(INT|FRAME|LOAD|REAL|BOOL|STRING|SIGNAL|STRUC)\b/i, '')
          .trim();

        // Split by comma and clean tokens
        const variableTokens = varPart.split(',').map(v => v.trim());

        for (const token of variableTokens) {
          // Extract variable name before any assignment or indexing
          const rawVar = token.split('=')[0].split('[')[0].trim();
          const match = rawVar.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
          const varName = match ? match[1] : null;

          if (varName && varName.length > 24) {
            const varIndex = line.text.indexOf(varName);
            if (varIndex >= 0) {
              const range = new vscode.Range(
                new vscode.Position(i, varIndex),
                new vscode.Position(i, varIndex + varName.length)
              );
              console.log(`Diagnostic for "${varName}" at line ${i + 1}, col ${varIndex}-${varIndex + varName.length}`);

              const message = 'The variable is too long (max 24 characters)';
              const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
              diagnostic.source = 'KRL Variable Length';
              diagnostics.push(diagnostic);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error processing line ${i + 1}:`, error);
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}));




  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  
    diagnosticCollection.clear();
    diagnosticCollection.dispose();

  if (!client) return undefined;
  return client.stop();
}
