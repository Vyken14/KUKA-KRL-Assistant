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
    if (!doc || !workspaceRoot) return;

    const lines = doc.getText().split(/\r?\n/);
    const lineText = lines[params.position.line];
    
  //Do nothing if we already are on the Decl line
  if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT)\b/i.test(lineText)) return undefined;
  if (/^\s*(DECL|SIGNAL|STRUC)\b/i.test(lineText)) return;

    // Match function name under the cursor
    const wordMatch = lineText.match(/\b(\w+)\b/g);
    if (!wordMatch) return;

    let functionName: string | undefined;
    let charCount = 0;
    for (const w of wordMatch) {
      const start = lineText.indexOf(w, charCount);
      const end = start + w.length;
      if (params.position.character >= start && params.position.character <= end) {
        functionName = w;
        break;
      }
      charCount = end;
    }
    if (!functionName) return;

    const files = await findSrcFiles(workspaceRoot);

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileLines = content.split(/\r?\n/);

      // Dynamic regex using actual function name and full signature matching
      const defRegex = new RegExp(`\\b(GLOBAL\\s+)?(DEF|DEFFCT)\\s+(\\w+\\s+)?${functionName}\\s*\\(([^)]*)\\)`, 'i');

      for (let i = 0; i < fileLines.length; i++) {
        const defLine = fileLines[i];
        const match = defLine.match(defRegex);
        if (match) {
          const uri = URI.file(filePath).toString();
          const startCol = defLine.indexOf(functionName);
          return Location.create(uri, {
            start: Position.create(i, startCol),
            end: Position.create(i, startCol + functionName.length),
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
  
  //Do nothing if we already are on the Decl line
  if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT)\b/i.test(lineText)) return undefined;
  if (/^\s*(DECL|SIGNAL|STRUC)\b/i.test(lineText)) return;

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
