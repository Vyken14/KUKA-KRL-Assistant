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
  Connection,
  Diagnostic,
  DiagnosticSeverity,
  CompletionItemKind,
  CompletionItem,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { Worker } from 'worker_threads';

// Import pure logic from krlLogic.ts
import {
  DeclaredVariableCollector,
  validateVariablesUsage,
  mergeAllVariables,
  // other exports if needed
} from './krlLogic';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceRoot: string | null = null;
const fileVariablesMap: Map<string, VariableInfo[]> = new Map();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri ? URI.parse(params.rootUri).fsPath : null;

  documents.listen(connection);

  // DEBUG: delete old log file
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: ['.'],
      },
    },
  };
});

connection.onInitialized(() => {
  if (workspaceRoot) {
    const files = getAllDatFiles(workspaceRoot);
    processFilesInWorker(files, (result: { uri: string; diagnostics: Diagnostic[] }[]) => {
      result.forEach(({ uri, diagnostics }) => {
        connection.sendDiagnostics({ uri, diagnostics });
      });
    });
  }
});

function processFilesInWorker(files: string[], callback: (result: { uri: string; diagnostics: Diagnostic[] }[]) => void) {
  logToFile(`Processing files in worker serverside: ${files.join(', ')}`);
  const worker = new Worker(path.resolve(__dirname, 'worker.ts'), {
    workerData: { files },
  });

  // logToFile(`Processing files in worker: ${files.join(', ')}`);
  // logToFile(`Worker at ${path.resolve(__dirname, 'worker.ts')}`);


  worker.on('error', err => {
    console.error('Worker error:', err);
  });

  worker.on('exit', code => {
    if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
  });

  worker.on('message', (diagnosticsList) => {
  connection.console.log('Received diagnostics from worker');
  for (const { uri, diagnostics } of diagnosticsList) {
    connection.sendDiagnostics({ uri, diagnostics });
  }
});

}

// On document content change: trigger validation in worker
documents.onDidChangeContent(async change => {
  try {
    const { document } = change;

    if (document.uri.endsWith('.dat')) {
      validateDatFile(document, connection);
    }

    // Use the worker for heavy validation to avoid blocking
    processFilesInWorker([URI.parse(document.uri).fsPath], (result) => {
      result.forEach(({ uri, diagnostics }) => {
        connection.sendDiagnostics({ uri, diagnostics });
      });
    });

  } catch (err) {
    logToFile(`Error during onDidChangeContent: ${String(err)}`);
  }
});


// Recursively find all .dat files under directory
function getAllDatFiles(dir: string): string[] {
  const result: string[] = [];

  function recurse(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        recurse(fullPath);
      } else if (entry.isFile() && fullPath.endsWith('.dat')) {
        result.push(fullPath);
      }
    }
  }

  recurse(dir);
  return result;
}

const logFile = path.join(__dirname, 'krl-server.log');
function logToFile(message: string) {
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}

// Validate .dat file global declarations (from your original code)
function validateDatFile(document: TextDocument, connection: Connection) {
  const diagnostics: Diagnostic[] = [];
  const text = document.getText();
  const lines = text.split(/\r?\n/);

  let insidePublicDefdat = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect start of PUBLIC DEFDAT
    const defdatMatch = line.match(/^DEFDAT\s+\w+\s+PUBLIC/i);
    if (defdatMatch) {
      insidePublicDefdat = true;
      continue;
    }

    // End of PUBLIC DEFDAT block
    if (/^DEFDAT\s+\w+/i.test(line) && !/PUBLIC/i.test(line)) {
      insidePublicDefdat = false;
    }

    // Look for global declarations outside PUBLIC DEFDAT
    if (/^(DECL|SIGNAL|STRUC)/i.test(line) && !insidePublicDefdat) {
      const newDiagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: line.length },
        },
        message: `Global declaration "${line.split(/\s+/)[0]}" is not inside a PUBLIC DEFDAT.`,
        source: 'krl-linter',
      };
      diagnostics.push(newDiagnostic);
    }
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// The interfaces used by krlLogic
interface VariableInfo {
  name: string;
  type: string;
}

// Function to find the word at a position, used for definition/hover
function getWordAtPosition(lineText: string, character: number): string | undefined {
  const wordMatch = lineText.match(/\b(\w+)\b/g);
  if (!wordMatch) return;

  let charCount = 0;
  for (const w of wordMatch) {
    const start = lineText.indexOf(w, charCount);
    const end = start + w.length;
    if (character >= start && character <= end) {
      return w;
    }
    charCount = end;
  }
  return;
}

// You had this async function to find if a function is declared
async function isFunctionDeclared(name: string): Promise<FunctionDeclaration | undefined> {
  if (!workspaceRoot) return undefined;
  const files = await findSrcFiles(workspaceRoot);
  const defRegex = new RegExp(`\\b(GLOBAL\\s+)?(DEF|DEFFCT)\\s+(\\w+\\s+)?${name}\\s*\\(([^)]*)\\)`, 'i');

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileLines = content.split(/\r?\n/);
    for (let i = 0; i < fileLines.length; i++) {
      const defLine = fileLines[i];
      const match = defLine.match(defRegex);
      if (match) {
        const uri = URI.file(filePath).toString();
        const startChar = defLine.indexOf(name);
        return {
          uri,
          line: i,
          startChar,
          endChar: startChar + name.length,
          params: match[4].trim(),
        };
      }
    }
  }

  return undefined;
}

// Recursive find of .src, .dat, .sub files
async function findSrcFiles(dir: string): Promise<string[]> {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      const subDirFiles = await findSrcFiles(filePath);
      results = results.concat(subDirFiles);
    } else if (file.toLowerCase().endsWith('.src') || file.toLowerCase().endsWith('.dat') || file.toLowerCase().endsWith('.sub')) {
      results.push(filePath);
    }
  }
  return results;
}

interface FunctionDeclaration {
  uri: string;
  line: number;
  startChar: number;
  endChar: number;
  params: string;
}

// Definition provider
connection.onDefinition(async (params: DefinitionParams): Promise<Location | undefined> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !workspaceRoot) return;

  const lines = doc.getText().split(/\r?\n/);
  const lineText = lines[params.position.line];

  if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT|DECL|SIGNAL|STRUC)\b/i.test(lineText)) return;

  const functionName = getWordAtPosition(lineText, params.position.character);
  if (!functionName) return;

  const result = await isFunctionDeclared(functionName);
  if (!result) return;

  return Location.create(result.uri, {
    start: Position.create(result.line, result.startChar),
    end: Position.create(result.line, result.endChar),
  });
});

// Hover provider
connection.onHover(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc || !workspaceRoot) return;

  const lines = doc.getText().split(/\r?\n/);
  const lineText = lines[params.position.line];

  if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT|DECL|SIGNAL|STRUC)\b/i.test(lineText)) return;

  const functionName = getWordAtPosition(lineText, params.position.character);
  if (!functionName) return;

  const result = await isFunctionDeclared(functionName);
  if (!result) return;

  return {
    contents: {
      kind: 'markdown',
      value: `**${functionName}**(${result.params})`,
    },
  };
});

// Completion provider
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const lines = document.getText().split(/\r?\n/);

  // Scan document to build variableStructTypes
  const variableStructTypes: { [varName: string]: string } = {};
  for (const line of lines) {
    const cleanedLine = line.trim().replace(/^GLOBAL\s+DECL\s+/i, '');
    const parts = cleanedLine.split(/\s+/);
    if (parts.length >= 2) {
      const [type, varName] = parts;
      variableStructTypes[varName] = type;
    }
  }

  // Get text before cursor
  const line = lines[params.position.line];
  const textBefore = line.substring(0, params.position.character);
  const match = textBefore.match(/(\w+)\.$/);
  if (!match) return [];

  const varName = match[1];
  const structName = variableStructTypes[varName];
  if (!structName) return [];

  // Use structDefinitions parsed elsewhere or implement parsing here if needed
  // For now, returning empty array (you can import or implement parseKrlFile here if you want)
  // Example stub:
  const structDefinitions: { [key: string]: string[] } = {};
  const members = structDefinitions[structName];
  if (!members) return [];

  return members.map(member => ({
    label: member,
    kind: CompletionItemKind.Field,
  }));
});

connection.listen();
documents.listen(connection);
