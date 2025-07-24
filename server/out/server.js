"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAllDatFiles = void 0;
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const fs = require("fs");
const path = require("path");
const vscode_uri_1 = require("vscode-uri");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let workspaceRoot = null;
connection.onInitialize((params) => {
    workspaceRoot = params.rootUri ? vscode_uri_1.URI.parse(params.rootUri).fsPath : null;
    documents.listen(connection);
    connection.onInitialized(() => {
        validateAllDatFiles(connection);
    });
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            hoverProvider: true
        }
    };
});
documents.onDidChangeContent(change => {
    if (change.document.uri.endsWith('.dat')) {
        validateDatFile(change.document, connection);
    }
});
connection.onDefinition((params) => __awaiter(void 0, void 0, void 0, function* () {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || !workspaceRoot)
        return;
    const lines = doc.getText().split(/\r?\n/);
    const lineText = lines[params.position.line];
    //Do nothing if we already are on the Decl line
    if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT)\b/i.test(lineText))
        return undefined;
    if (/^\s*(DECL|SIGNAL|STRUC)\b/i.test(lineText))
        return;
    // Match function name under the cursor
    const wordMatch = lineText.match(/\b(\w+)\b/g);
    if (!wordMatch)
        return;
    let functionName;
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
    if (!functionName)
        return;
    const files = yield findSrcFiles(workspaceRoot);
    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const fileLines = content.split(/\r?\n/);
        // Dynamic regex using actual function name and full signature matching
        const defRegex = new RegExp(`\\b(GLOBAL\\s+)?(DEF|DEFFCT)\\s+(\\w+\\s+)?${functionName}\\s*\\(([^)]*)\\)`, 'i');
        for (let i = 0; i < fileLines.length; i++) {
            const defLine = fileLines[i];
            const match = defLine.match(defRegex);
            if (match) {
                const uri = vscode_uri_1.URI.file(filePath).toString();
                const startCol = defLine.indexOf(functionName);
                return node_1.Location.create(uri, {
                    start: node_1.Position.create(i, startCol),
                    end: node_1.Position.create(i, startCol + functionName.length),
                });
            }
        }
    }
    return undefined;
}));
// Utility: Recursively find .src .dat files in workspace
function findSrcFiles(dir) {
    return __awaiter(this, void 0, void 0, function* () {
        let results = [];
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
                const subDirFiles = yield findSrcFiles(filePath);
                results = results.concat(subDirFiles);
            }
            else if (file.toLowerCase().endsWith('.src') || file.toLowerCase().endsWith('.dat') || file.toLowerCase().endsWith('.sub')) {
                results.push(filePath);
            }
        }
        return results;
    });
}
connection.onHover((params) => __awaiter(void 0, void 0, void 0, function* () {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return;
    const lines = doc.getText().split(/\r?\n/);
    const lineText = lines[params.position.line];
    //Do nothing if we already are on the Decl line
    if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT)\b/i.test(lineText))
        return undefined;
    if (/^\s*(DECL|SIGNAL|STRUC)\b/i.test(lineText))
        return;
    const wordMatch = lineText.match(/\b(\w+)\b/g);
    if (!wordMatch)
        return;
    // Find the hovered word by checking which word contains the position.character
    let hoveredWord;
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
    if (!hoveredWord)
        return;
    if (!workspaceRoot)
        return;
    const files = yield findSrcFiles(workspaceRoot);
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
}));
// Call this once during initialization
function validateAllDatFiles(connection) {
    documents.all().forEach(document => {
        if (document.uri.endsWith('.dat')) {
            validateDatFile(document, connection);
        }
    });
}
exports.validateAllDatFiles = validateAllDatFiles;
function validateDatFile(document, connection) {
    const diagnostics = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    let insidePublicDefdat = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        parseDatForStructs(line);
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
                severity: node_1.DiagnosticSeverity.Error,
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
const structDefinitions = new Map();
const structInstances = new Map();
function parseDatForStructs(text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        // Match GLOBAL STRUC lines
        const strucMatch = trimmed.match(/^GLOBAL\s+STRUC\s+(\w+)\s+(\w+)\s+(.+)$/i);
        if (strucMatch) {
            const structName = strucMatch[1];
            const type = strucMatch[2];
            const members = strucMatch[3].split(',').map(m => m.trim());
            structDefinitions.set(structName, { type, members });
        }
        // Match DECL instance lines
        const declMatch = trimmed.match(/^DECL\s+(\w+)\s+(\w+)/i);
        if (declMatch) {
            const type = declMatch[1];
            const instanceName = declMatch[2];
            structInstances.set(instanceName, type);
        }
    }
}
connection.onCompletion((params) => {
    console.log('Completion request received for:', params.textDocument.uri);
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return [];
    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const prefix = text.slice(0, offset);
    const match = prefix.match(/(\w+)\.$/); // Matches VarTest.
    if (match) {
        const instanceName = match[1];
        const typeName = structInstances.get(instanceName);
        if (!typeName)
            return [];
        // Find corresponding struct definition
        for (const [structName, def] of structDefinitions.entries()) {
            if (def.type === typeName) {
                return def.members.map(member => ({
                    label: `${instanceName}.${member}`,
                    kind: node_1.CompletionItemKind.Field,
                    detail: `Member of ${typeName}`
                }));
            }
        }
    }
    return [];
});
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map