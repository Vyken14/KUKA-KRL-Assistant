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
const fileVariablesMap: Map<string, VariableInfo[]> = new Map();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri ? URI.parse(params.rootUri).fsPath : null;

  documents.listen(connection);

  connection.onInitialized(() => {
    if (workspaceRoot) {
      const files = getAllDatFiles(workspaceRoot); // You must implement this (see below)
      files.forEach(filePath => {
        const content = fs.readFileSync(filePath, 'utf8');
        const uri = URI.file(filePath).toString();

        const collector = new DeclaredVariableCollector();
        collector.extractFromText(content);
        fileVariablesMap.set(uri, collector.getVariables());

        const mergedVariables = mergeAllVariables(fileVariablesMap);
        const diagnostics = validateVariablesUsage(TextDocument.create(uri, 'krl', 1, content), mergedVariables);
        connection.sendDiagnostics({ uri, diagnostics });
      });
    }
  });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: ['.']
      }
    }
  };
});


documents.onDidChangeContent(change => {
  const { document } = change;

  if (document.uri.endsWith('.dat')) {
    validateDatFile(document, connection);
  }

  parseKrlFile(document.getText());

  const collector = new DeclaredVariableCollector();
  collector.extractFromText(document.getText());
  fileVariablesMap.set(document.uri, collector.getVariables());

  const mergedVariables = mergeAllVariables(fileVariablesMap);
  const diagnostics = validateVariablesUsage(document, mergedVariables);
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
});

function mergeAllVariables(map: Map<string, VariableInfo[]>): { [varName: string]: string } {
  const result: { [varName: string]: string } = {};
  for (const vars of map.values()) {
    for (const v of vars) {
      result[v.name] = v.type || '';
    }
  }
  return result;
}

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

interface VariableInfo {
  name: string;
  type: string;
}

class DeclaredVariableCollector {
  private variables: Map<string, string> = new Map(); // name -> type

  extractFromText(documentText: string): void {
    // Remove STRUC blocks (non-greedy match)
    const textWithoutStrucs = documentText.replace(/STRUC\s+\w+[^]*?ENDSTRUC/gi, '');

    // Match DECL statements with optional GLOBAL before or after
    const declRegex = /^\s*(GLOBAL\s+)?DECL\s+(GLOBAL\s+)?(\w+)\s+([^\r\n;]+)/gim;

    let match: RegExpExecArray | null;
    while ((match = declRegex.exec(textWithoutStrucs)) !== null) {
      const type = match[3];
      const varList = match[4];

      const varNames = varList
        .split(',')
        .map(name => name.trim())
        .map(name => name.replace(/\[.*?\]/, ''))         
        .map(name => name.replace(/\s*=\s*.+$/, ''))      
        .filter(name => /^[a-zA-Z_]\w*$/.test(name)); 


      for (const name of varNames) {
        if (!this.variables.has(name)) {
          this.variables.set(name, type);
        }
      }
    }
  }

  getVariables(): VariableInfo[] {
    return Array.from(this.variables.entries()).map(([name, type]) => ({ name, type }));
  }

  clear(): void {
    this.variables.clear();
  }
}

function validateVariablesUsage(document: TextDocument, variableTypes: { [varName: string]: string }): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const text = document.getText();
  const lines = text.split(/\r?\n/);

  const collector = new DeclaredVariableCollector();
  logToFile(`Extracted variables : ${JSON.stringify(variableTypes, null, 2)}`);

  // Regex to match possible variable names: words (letters, digits, underscore)
  // Adjust if your variable naming rules differ
  const variableRegex = /\b([a-zA-Z_]\w*)\b/g;

  // Keywords and types to exclude from "used variables"
  const keywords = new Set([
    'GLOBAL', 'DECL', 'STRUC', 'SIGNAL', 'INT', 'REAL', 'BOOL', 'CHAR', 'STRING', 'IF', 'ELSE', 'WHILE',
    'FOR', 'RETURN', 'FUNCTION', 'DEF', 'DEFFCT', 'END', 'TRUE', 'FALSE', 'NULL',
  ]);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();

    // Skip lines that declare variables or structs or signals
    if (/^\s*(GLOBAL\s+)?(DECL|STRUC|SIGNAL)\b/i.test(line)) {
      continue;
    }

    let match;
    while ((match = variableRegex.exec(line)) !== null) {
      const varName = match[1];

      // Ignore keywords and known types
      if (keywords.has(varName.toUpperCase())) continue;

      // Check if variable is declared
      if (!(varName in variableTypes)) {
        // Mark diagnostic
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          message: `Variable "${varName}" not declared.`,
          range: {
            start: { line: lineIndex, character: match.index },
            end: { line: lineIndex, character: match.index + varName.length }
          },
          source: 'krl-linter'
        });
      }
    }
  }

  return diagnostics;
}





connection.listen();
documents.listen(connection);
