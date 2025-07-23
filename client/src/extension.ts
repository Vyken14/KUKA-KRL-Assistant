import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import * as path from 'path';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
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


  context.subscriptions.push(
   vscode.languages.registerDefinitionProvider('krl', {
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

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
