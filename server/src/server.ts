import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  InitializeParams,
  InitializeResult,
  TextDocumentPositionParams,
  Location,
  Position,
  DefinitionParams,
} from 'vscode-languageserver/node';

import {
  TextDocument
} from 'vscode-languageserver-textdocument';

import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceRoot: string | null = null;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri ? URI.parse(params.rootUri).fsPath : null;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true 
    }
  };
});

documents.onDidChangeContent(change => {
  // Could add diagnostics later
});

connection.onDefinition(
  async (params: DefinitionParams): Promise<Location | undefined> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return;

    const lines = doc.getText().split(/\r?\n/);
    const lineText = lines[params.position.line];
    const callMatch = lineText.match(/\b(\w+)\s*\(/);
    if (!callMatch) return;

    const functionName = callMatch[1];

    // Search all files in workspace
    if (!workspaceRoot) return;

    const files = await findSrcFiles(workspaceRoot);

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileLines = content.split(/\r?\n/);
      for (let i = 0; i < fileLines.length; i++) {
        const defLine = fileLines[i];
        const defRegex = /\b(GLOBAL\s+)?(DEF|DEFFCT)\s+(\w+\s+)?(\w+)\s*\(/i;
        const defMatch = defLine.match(defRegex);
        if (defMatch && defMatch[4] === functionName) {
          const uri = URI.file(filePath).toString();
          return Location.create(uri, {
            start: Position.create(i, defLine.indexOf(defMatch[4])),
            end: Position.create(i, defLine.indexOf(defMatch[4]) + defMatch[4].length)
          });
        }
      }
    }

    return undefined;
  }
);

// Utility: Recursively find .src .dat files in workspace
async function findSrcFiles(dir: string): Promise<string[]> {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      const subDirFiles = await findSrcFiles(filePath);
      results = results.concat(subDirFiles);
    } else if (file.toLowerCase().endsWith('.src') || file.toLowerCase().endsWith('.dat')|| file.toLowerCase().endsWith('.sub')) {
      results.push(filePath);
    }
  }
  return results;
}

connection.onHover(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return;

  const lines = doc.getText().split(/\r?\n/);
  const lineText = lines[params.position.line];
  const wordMatch = lineText.match(/\b(\w+)\b/g);
  if (!wordMatch) return;

  // Find the hovered word by checking which word contains the position.character
  let hoveredWord: string | undefined;
  let charCount = 0;
  for (const w of wordMatch) {
    const start = lineText.indexOf(w, charCount);
    const end = start + w.length;
    if (params.position.character >= start && params.position.character <= end) {
      hoveredWord = w;
      break;
    }
    charCount = end;
  }
  if (!hoveredWord) return;

  if (!workspaceRoot) return;

  const files = await findSrcFiles(workspaceRoot);

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileLines = content.split(/\r?\n/);
    for (let i = 0; i < fileLines.length; i++) {
      const defLine = fileLines[i];
      // Regex to capture function definition with parameters, e.g.:
      // GLOBAL DEFFCT INT function2(params)
      const defRegex = new RegExp(`\\b(GLOBAL\\s+)?(DEF|DEFFCT)\\s+(\\w+\\s+)?${hoveredWord}\\s*\\(([^)]*)\\)`, 'i');
      const defMatch = defLine.match(defRegex);
      if (defMatch) {
        const paramsStr = defMatch[4].trim();
        return {
          contents: {
            kind: 'markdown',
            value: `**${hoveredWord}**(${paramsStr})`
          }
        };
      }
    }
  }

  return null;
});



documents.listen(connection);
connection.listen();
