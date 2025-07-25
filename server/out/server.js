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
// Create LSP connection and document manager
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
// Global state variables
let workspaceRoot = null;
const fileVariablesMap = new Map();
const logFile = path.join(__dirname, 'krl-server.log');
// Variables and struct maps (updated dynamically)
let variableStructTypes = {};
let structDefinitions = {};
let functionsDeclared = [];
// =======================
// Initialization Handlers
// =======================
connection.onInitialize((params) => {
    workspaceRoot = params.rootUri ? vscode_uri_1.URI.parse(params.rootUri).fsPath : null;
    // Debug: Delete old log file if exists
    if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
    }
    // Return server capabilities
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            hoverProvider: true,
            completionProvider: {
                triggerCharacters: ['.']
            }
        }
    };
});
connection.onInitialized(() => __awaiter(void 0, void 0, void 0, function* () {
    if (!workspaceRoot)
        return;
    const files = getAllDatFiles(workspaceRoot);
    // Step 1: Collect variables from all .dat files
    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const uri = vscode_uri_1.URI.file(filePath).toString();
        const collector = new DeclaredVariableCollector();
        collector.extractFromText(content);
        fileVariablesMap.set(uri, collector.getVariables());
        functionsDeclared = yield getAllFunctionDeclarations();
        logToFile(`Extracted functions from : ${JSON.stringify(functionsDeclared, null, 2)}`);
    }
    // Step 2: Merge and log variables for all files
    const mergedVariables = mergeAllVariables(fileVariablesMap);
    //logToFile(`Merged variables: ${JSON.stringify(mergedVariables, null, 2)}`);
    // Step 3: Optionally validate each file with merged variables (commented out)
    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const uri = vscode_uri_1.URI.file(filePath).toString();
        // const diagnostics = await validateVariablesUsage(
        //   TextDocument.create(uri, 'krl', 1, content),
        //   mergedVariables
        // );
        // connection.sendDiagnostics({ uri, diagnostics });
    }
}));
// ==========================
// Document Change Event Hook
// ==========================
documents.onDidChangeContent((change) => __awaiter(void 0, void 0, void 0, function* () {
    const { document } = change;
    if (document.uri.endsWith('.dat')) {
        validateDatFile(document, connection);
    }
    extractStrucVariables(document.getText());
    const collector = new DeclaredVariableCollector();
    collector.extractFromText(document.getText());
    fileVariablesMap.set(document.uri, collector.getVariables());
    const mergedVariables = mergeAllVariables(fileVariablesMap);
    // const diagnostics = await validateVariablesUsage(document, mergedVariables);
    // connection.sendDiagnostics({ uri: document.uri, diagnostics });
}));
// ===================
// File and Variables Utilities
// ===================
/**
 * Recursively find all .dat files in the workspace directory.
 */
function getAllDatFiles(dir) {
    const result = [];
    function recurse(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                recurse(fullPath);
            }
            else if (entry.isFile() && fullPath.endsWith('.dat')) {
                result.push(fullPath);
            }
        }
    }
    recurse(dir);
    return result;
}
/**
 * Merge all variables from multiple files into a single map.
 */
function mergeAllVariables(map) {
    const result = {};
    for (const vars of map.values()) {
        for (const v of vars) {
            result[v.name] = v.type || '';
        }
    }
    return result;
}
/**
 * Append a timestamped message to the log file.
 */
function logToFile(message) {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}
// =====================
// Definition Request Handler
// =====================
connection.onDefinition((params) => __awaiter(void 0, void 0, void 0, function* () {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || !workspaceRoot)
        return;
    const lines = doc.getText().split(/\r?\n/);
    const lineText = lines[params.position.line];
    // Ignore certain declarations lines
    if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT|DECL|SIGNAL|STRUC)\b/i.test(lineText))
        return;
    const functionName = getWordAtPosition(lineText, params.position.character);
    if (!functionName)
        return;
    const result = yield isFunctionDeclared(functionName);
    if (!result)
        return;
    return node_1.Location.create(result.uri, {
        start: node_1.Position.create(result.line, result.startChar),
        end: node_1.Position.create(result.line, result.endChar)
    });
}));
// ===================
// Hover Request Handler
// ===================
connection.onHover((params) => __awaiter(void 0, void 0, void 0, function* () {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || !workspaceRoot)
        return;
    const lines = doc.getText().split(/\r?\n/);
    const lineText = lines[params.position.line];
    if (/^\s*(GLOBAL\s+)?(DEF|DEFFCT|DECL|SIGNAL|STRUC)\b/i.test(lineText))
        return;
    const functionName = getWordAtPosition(lineText, params.position.character);
    if (!functionName)
        return;
    const result = yield isFunctionDeclared(functionName);
    if (!result)
        return;
    return {
        contents: {
            kind: 'markdown',
            value: `**${functionName}**(${result.params})`
        }
    };
}));
// ==================
// Completion Request Handler
// ==================
connection.onCompletion((params) => __awaiter(void 0, void 0, void 0, function* () {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return [];
    const lines = document.getText().split(/\r?\n/);
    // === 1. Struct field completions (unchanged) ===
    const variableStructTypes = {};
    for (const line of lines) {
        const declRegex = /^(?:GLOBAL\s+)?(?:DECL\s+)?(?:GLOBAL\s+)?(\w+)\s+(\w+)/i;
        const match = declRegex.exec(line.trim());
        if (match) {
            const type = match[1];
            const varName = match[2];
            variableStructTypes[varName] = type;
        }
    }
    const line = lines[params.position.line];
    const textBefore = line.substring(0, params.position.character);
    const dotMatch = textBefore.match(/(\w+)\.$/);
    const structItems = [];
    if (dotMatch) {
        const varName = dotMatch[1];
        const structName = variableStructTypes[varName];
        const members = structDefinitions[structName];
        if (members) {
            structItems.push(...members.map(member => ({
                label: member,
                kind: node_1.CompletionItemKind.Field
            })));
        }
    }
    // === 2. Function completions ===
    logToFile(`Extracted functions: ${JSON.stringify(functionsDeclared, null, 2)}`);
    const functionItems = functionsDeclared.map(fn => {
        const paramList = fn.params.split(',').map(p => p.trim()).filter(Boolean);
        const snippetParams = paramList.map((p, i) => `\${${i + 1}:${p}}`).join(', ');
        return {
            label: fn.name,
            kind: node_1.CompletionItemKind.Function,
            detail: `${fn.name}(${fn.params})`,
            insertText: `${fn.name}(${snippetParams})`,
            insertTextFormat: node_1.InsertTextFormat.Snippet,
            documentation: `User-defined function: ${fn.name}`
        };
    });
    // === 3. Return all completions combined ===
    return [...structItems, ...functionItems];
}));
function getAllFunctionDeclarations() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!workspaceRoot)
            return [];
        const files = yield findSrcFiles(workspaceRoot);
        const defRegex = /\b(GLOBAL\s+)?(DEF|DEFFCT)\s+(?:\w+\s+)?(\w+)\s*\(([^)]*)\)/i;
        const allDeclarations = [];
        for (const filePath of files) {
            const content = fs.readFileSync(filePath, 'utf8');
            const fileLines = content.split(/\r?\n/);
            for (let i = 0; i < fileLines.length; i++) {
                const line = fileLines[i];
                const match = defRegex.exec(line);
                if (match) {
                    const name = match[3];
                    const params = match[4].trim();
                    const startChar = line.indexOf(name);
                    const uri = vscode_uri_1.URI.file(filePath).toString();
                    allDeclarations.push({
                        name,
                        uri,
                        line: i,
                        startChar,
                        endChar: startChar + name.length,
                        params,
                    });
                }
            }
        }
        return allDeclarations;
    });
}
// =========================
// Utility Functions
// =========================
/**
 * Extract the word at a given character position in a line.
 */
function getWordAtPosition(lineText, character) {
    const wordMatch = lineText.match(/\b(\w+)\b/g);
    if (!wordMatch)
        return;
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
/**
 * Recursively find .src, .dat, and .sub files in workspace.
 */
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
            else if (file.toLowerCase().endsWith('.src') ||
                file.toLowerCase().endsWith('.dat') ||
                file.toLowerCase().endsWith('.sub')) {
                results.push(filePath);
            }
        }
        return results;
    });
}
/**
 * Check if a function with given name is declared in any source file.
 */
function isFunctionDeclared(name) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!workspaceRoot)
            return undefined;
        const files = yield findSrcFiles(workspaceRoot);
        const defRegex = new RegExp(`\\b(GLOBAL\\s+)?(DEF|DEFFCT)\\s+(\\w+\\s+)?${name}\\s*\\(([^)]*)\\)`, 'i');
        for (const filePath of files) {
            const content = fs.readFileSync(filePath, 'utf8');
            const fileLines = content.split(/\r?\n/);
            for (let i = 0; i < fileLines.length; i++) {
                const defLine = fileLines[i];
                const match = defLine.match(defRegex);
                if (match) {
                    const uri = vscode_uri_1.URI.file(filePath).toString();
                    const startChar = defLine.indexOf(name);
                    return {
                        uri,
                        line: i,
                        startChar,
                        endChar: startChar + name.length,
                        params: match[4].trim(),
                        name: name
                    };
                }
            }
        }
        return undefined;
    });
}
// =====================
// Diagnostics & Validation
// =====================
/**
 * Validate all .dat files in currently opened documents.
 */
function validateAllDatFiles(connection) {
    documents.all().forEach(document => {
        if (document.uri.endsWith('.dat')) {
            validateDatFile(document, connection);
        }
    });
}
exports.validateAllDatFiles = validateAllDatFiles;
/**
 * Validate global declarations in .dat files, ensuring globals appear inside PUBLIC DEFDAT blocks.
 */
function validateDatFile(document, connection) {
    const diagnostics = [];
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
        // If new DEFDAT without PUBLIC, exit public block
        if (/^DEFDAT\s+\w+/i.test(line) && !/PUBLIC/i.test(line)) {
            insidePublicDefdat = false;
        }
        // Look for global declarations outside PUBLIC DEFDAT
        if (/^(DECL|SIGNAL|STRUC)/i.test(line) && !insidePublicDefdat) {
            const newDiagnostic = {
                severity: node_1.DiagnosticSeverity.Error,
                range: {
                    start: { line: i, character: 0 },
                    end: { line: i, character: line.length }
                },
                message: `Global declaration "${line.split(/\s+/)[0]}" is not inside a PUBLIC DEFDAT.`,
                source: 'krl-linter'
            };
            if (!isDuplicateDiagnostic(newDiagnostic, diagnostics)) {
                diagnostics.push(newDiagnostic);
            }
        }
    }
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
/**
 * Check if a diagnostic is duplicate in the list.
 */
function isDuplicateDiagnostic(newDiag, existingDiagnostics) {
    return existingDiagnostics.some(diag => diag.range.start.line === newDiag.range.start.line &&
        diag.range.start.character === newDiag.range.start.character &&
        diag.range.end.line === newDiag.range.end.line &&
        diag.range.end.character === newDiag.range.end.character &&
        diag.message === newDiag.message &&
        diag.severity === newDiag.severity);
}
/**
 * Validate usage of variables by ensuring each variable usage is declared.
 * Returns array of Diagnostics for undeclared variables.
 */
function validateVariablesUsage(document, variableTypes) {
    return __awaiter(this, void 0, void 0, function* () {
        const diagnostics = [];
        const text = document.getText();
        const lines = text.split(/\r?\n/);
        const variableRegex = /\b([a-zA-Z_]\w*)\b/g;
        // Keywords and types to exclude from "used variables"
        const keywords = new Set([
            'GLOBAL', 'DEF', 'DEFFCT', 'END', 'ENDFCT', 'RETURN', 'TRIGGER',
            'REAL', 'BOOL', 'DECL', 'IF', 'ELSE', 'ENDIF', 'CONTINUE', 'FOR', 'ENDFOR', 'WHILE',
            'AND', 'OR', 'NOT', 'TRUE', 'FALSE', 'INT', 'STRING', 'PULSE', 'WAIT', 'SEC', 'NULLFRAME', 'THEN',
            'CASE', 'DEFAULT', 'SWITCH', 'ENDSWITCH', 'BREAK', 'ABS', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN2', 'MAX', 'MIN',
            'DEFDAT', 'ENDDAT', 'PUBLIC', 'STRUC', 'WHEN', 'DISTANCE', 'DO', 'DELAY', 'PRIO', 'LIN', 'PTP', 'DELAY',
            'C_PTP', 'C_LIN', 'C_VEL', 'C_DIS', 'BAS', 'LOAD', 'FRAME', 'IN', 'OUT',
            'X', 'Y', 'Z', 'A', 'B', 'C', 'S', 'T', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6',
            'SQRT', 'TO', 'Axis', 'E6AXIS', 'E6POS', 'LOAD_DATA', 'BASE', 'TOOL',
            'INVERSE', 'FORWARD', 'B_AND', 'B_OR', 'B_NOT', 'B_XOR', 'B_NAND', 'B_NOR', 'B_XNOR',
        ]);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            // Skip lines with declarations or structs or signals
            if (/^\s*(GLOBAL\s+)?(DECL|STRUC|SIGNAL)\b/i.test(line)) {
                continue;
            }
            let match;
            while ((match = variableRegex.exec(line)) !== null) {
                const varName = match[1];
                // Skip comments starting with ';'
                const commentIndex = line.indexOf(';');
                if (commentIndex !== -1 && match.index >= commentIndex)
                    continue;
                // Skip params starting with '&'
                const paramIndex = line.indexOf('&');
                if (paramIndex !== -1 && match.index >= paramIndex)
                    continue;
                // Skip system vars starting with '$' or '#'
                if (match.index !== undefined && match.index > 0 && (line[match.index - 1] === '$' || line[match.index - 1] === '#'))
                    continue;
                // Skip known function names
                if (yield isFunctionDeclared(varName))
                    continue;
                // Skip keywords and known types
                if (keywords.has(varName.toUpperCase()))
                    continue;
                // Report undeclared variables
                if (!(varName in variableTypes)) {
                    const newDiagnostic = {
                        severity: node_1.DiagnosticSeverity.Error,
                        message: `Variable "${varName}" not declared.`,
                        range: {
                            start: { line: lineIndex, character: match.index },
                            end: { line: lineIndex, character: match.index + varName.length }
                        },
                        source: 'krl-linter'
                    };
                    if (!isDuplicateDiagnostic(newDiagnostic, diagnostics)) {
                        diagnostics.push(newDiagnostic);
                    }
                }
            }
        }
        return diagnostics;
    });
}
// =====================
// Struct and Variable Extraction
// =====================
/**
 * Extract struct and enum variable members from .dat file content.
 * Updates global structDefinitions map.
 */
function extractStrucVariables(datContent) {
    const structRegex = /^[ \t]*(?:GLOBAL\s+)?(?:DECL\s+)?(?:GLOBAL\s+)?(STRUC|ENUM)\s+(\w+)\s+(.+)$/gm;
    const knownTypes = ['INT', 'REAL', 'BOOL', 'CHAR', 'STRING', 'FRAME', 'ENUM'];
    const tempStructDefinitions = {};
    let match;
    while ((match = structRegex.exec(datContent)) !== null) {
        const structName = match[2];
        let membersRaw = match[3];
        // Remove inline comments (anything after a semicolon)
        membersRaw = membersRaw.split(';')[0].trim();
        const tokens = membersRaw.split(/[,\s]+/).map(v => v.trim()).filter(Boolean);
        const members = tokens.filter(token => !knownTypes.includes(token.toUpperCase()) &&
            !['ENUM', 'STRUC'].includes(token.toUpperCase()));
        tempStructDefinitions[structName] = members;
    }
    // Filter members to exclude other struct names and known types
    for (const [structName, members] of Object.entries(tempStructDefinitions)) {
        const filtered = members.filter(member => !knownTypes.includes(member.toUpperCase()) &&
            !Object.keys(tempStructDefinitions).includes(member));
        structDefinitions[structName] = filtered;
    }
}
// ========================
// Class: DeclaredVariableCollector
// ========================
/**
 * Helper class to extract declared variables from document text.
 */
class DeclaredVariableCollector {
    constructor() {
        this.variables = new Map(); // name -> type
    }
    /**
     * Extract declared variables from the provided text.
     * Removes STRUC blocks before processing.
     */
    extractFromText(documentText) {
        // Remove STRUC blocks (non-greedy match)
        const textWithoutStrucs = documentText.replace(/STRUC\s+\w+[^]*?ENDSTRUC/gi, '');
        // Match DECL statements with optional GLOBAL before or after
        const declRegex = /^\s*(GLOBAL\s+)?DECL\s+(GLOBAL\s+)?(\w+)\s+([^\r\n;]+)/gim;
        let match;
        while ((match = declRegex.exec(textWithoutStrucs)) !== null) {
            const type = match[3];
            const varList = match[4];
            const varNames = splitVarsRespectingBrackets(varList)
                .map(name => name.trim())
                .map(name => name.replace(/\[.*?\]/g, '').trim()) // Remove array brackets
                .map(name => name.replace(/\s*=\s*.+$/, '')) // Remove initializations
                .filter(name => /^[a-zA-Z_]\w*$/.test(name));
            for (const name of varNames) {
                if (!this.variables.has(name)) {
                    this.variables.set(name, type);
                }
            }
        }
    }
    /**
     * Returns all collected variables as an array.
     */
    getVariables() {
        return Array.from(this.variables.entries()).map(([name, type]) => ({ name, type }));
    }
    /**
     * Clears collected variables.
     */
    clear() {
        this.variables.clear();
    }
}
/**
 * Utility function to split variable declarations respecting brackets.
 * Example: "var1, arr[2,3], var2" splits correctly on commas outside brackets.
 */
const splitVarsRespectingBrackets = (input) => {
    const result = [];
    let current = '';
    let bracketDepth = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (char === '[')
            bracketDepth++;
        if (char === ']')
            bracketDepth--;
        if (char === ',' && bracketDepth === 0) {
            result.push(current.trim());
            current = '';
        }
        else {
            current += char;
        }
    }
    if (current)
        result.push(current.trim());
    return result;
};
// =====================
// Start LSP Server
// =====================
connection.listen();
documents.listen(connection);
//# sourceMappingURL=server.js.map