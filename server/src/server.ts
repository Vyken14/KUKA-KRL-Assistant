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
  CompletionParams,
  CompletionItem,
} from 'vscode-languageserver/node';

import {
  TextDocument
} from 'vscode-languageserver-textdocument';

import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { log } from 'console';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceRoot: string | null = null;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri ? URI.parse(params.rootUri).fsPath : null;

  documents.listen(connection); 
  connection.onInitialized(() => {
    validateAllDatFiles(connection);
  });


  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true ,
      completionProvider: {
        triggerCharacters: ['.']
      }
    }
  };
});

documents.onDidChangeContent(change => {
  if (change.document.uri.endsWith('.dat')) {
    validateDatFile(change.document, connection);
  }
    parseKrlFile(change.document.getText()); 
  
});

documents.onDidOpen(e => {
  console.log(`Opened: ${e.document.uri}`);
});

const logFile = path.join(__dirname, 'krl-server.log');

function logToFile(message: string) {
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}



connection.onDefinition(
  async (params: DefinitionParams): Promise<Location | undefined> => {
    console.log(`Definition requested for: ${params.textDocument.uri} at ${params.position.line}:${params.position.character}`);
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


// Call this once during initialization
export function validateAllDatFiles(connection: Connection) {
  documents.all().forEach(document => {
    if (document.uri.endsWith('.dat')) {
      validateDatFile(document, connection);
    }
  });
}

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

    // If we hit the end of the file or a new DEFDAT without PUBLIC, exit the public block
    if (/^DEFDAT\s+\w+/i.test(line) && !/PUBLIC/i.test(line)) {
      insidePublicDefdat = false;
    }

    // Look for global declarations
    if (/^(DECL|SIGNAL|STRUC)/i.test(line) && !insidePublicDefdat) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: line.length }
        },
        message: `Global declaration "${line.split(/\s+/)[0]}" is not inside a PUBLIC DEFDAT.`,
        source: 'krl-linter'
      });
    }
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

//Variables Management 
interface StructMap {
  [structName: string]: string[];
}

interface VariableToStructMap {
  [varName: string]: string; // VarTest → Template
}
let variableStructTypes: VariableToStructMap = {};

let structDefinitions: StructMap = {};

function parseKrlFile(datContent: string): void {
  const structRegex = /^GLOBAL\s+STRUC\s+(\w+)\s+(.+)$/gm;
  const knownTypes = ['INT', 'REAL', 'BOOL', 'CHAR', 'STRING'];
  let match;

  const tempStructDefinitions: Record<string, string[]> = {};

  // Step 1: Parse all GLOBAL STRUC blocks
  while ((match = structRegex.exec(datContent)) !== null) {
    const structName = match[1];
    const membersRaw = match[2];

    const members: string[] = [];

    // Match known types and their variable lists
    const typeRegex = /\b(?:INT|REAL|BOOL|CHAR|STRING)\s+([\w,\s]+)/g;
    let typeMatch;

    while ((typeMatch = typeRegex.exec(membersRaw)) !== null) {
      const vars = typeMatch[1]
        .replace("INT", '') 
        .replace("REAL", '') 
        .replace("BOOL", '') 
        .replace("CHAR", '') 
        .replace("STRING", '') 
        .split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0);
      members.push(...vars);
    }

    // Match any remaining tokens not part of known types
    const allVarsRaw = membersRaw.split(/[, ]+/).filter(Boolean);
    const extraMembers = allVarsRaw.filter(token =>
      !members.includes(token) &&
      !knownTypes.includes(token)
    );

    members.push(...extraMembers);

    tempStructDefinitions[structName] = members;
   // logToFile(`Parsed struct "${structName}" with raw members: ${members.join(', ')}`);
  }

  // Step 2: Remove custom types used as variable names
  for (const [structName, members] of Object.entries(tempStructDefinitions)) {
    const filtered = members.filter(
      member =>
        !knownTypes.includes(member) && // Not a known type
        !Object.keys(tempStructDefinitions).includes(member) // Not a custom struct
    );

    structDefinitions[structName] = filtered;
    logToFile(`Cleaned struct "${structName}" with valid variables: ${filtered.join(', ')}`);
  }
}



connection.onNotification('custom/validateFile', (params: { uri: string, text: string }) => {
    console.log(`Validating file: ${params.uri}`);
  if (params.uri.match(/\.(dat|src|sub)$/i)) {
    parseKrlFile(params.text); 
  }
});


connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const lines = document.getText().split(/\r?\n/);

  // Step 1: Scan document and build variableStructTypes
  variableStructTypes = {}; // reset
  for (const line of lines) {
    const cleanedLine = line.trim().replace(/^GLOBAL\s+DECL\s+/i, '');
    const parts = cleanedLine.split(/\s+/);
    if (parts.length >= 2) {
      const [type, varName] = parts;
      variableStructTypes[varName] = type;
    }
  }

  // Step 2: Get text before cursor
  const line = lines[params.position.line];
  const textBefore = line.substring(0, params.position.character);
  const match = textBefore.match(/(\w+)\.$/);
  if (!match) return [];

  const varName = match[1];
  const structName = variableStructTypes[varName];

  logToFile(`Available structDefinitions: ${JSON.stringify(structDefinitions, null, 2)}`);

  if (!structName) return [];
  const members = structDefinitions[structName];  
  if (!members) return [];

  return members.map(member => ({
    label: member,
    kind: CompletionItemKind.Field
  }));
});





connection.listen();
documents.listen(connection);
