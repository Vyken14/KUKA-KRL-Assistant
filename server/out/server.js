"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode_uri_1 = require("vscode-uri");
const worker_threads_1 = require("worker_threads");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let workspaceRoot = null;
const fileVariablesMap = new Map();
connection.onInitialize((params) => {
    workspaceRoot = params.rootUri ? vscode_uri_1.URI.parse(params.rootUri).fsPath : null;
    documents.listen(connection);
    // DEBUG: delete old log file
    if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
    }
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
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
        processFilesInWorker(files, (result) => {
            result.forEach(({ uri, diagnostics }) => {
                connection.sendDiagnostics({ uri, diagnostics });
            });
        });
    }
});
function processFilesInWorker(files, callback) {
    logToFile(`Processing files in worker serverside: ${files.join(', ')}`);
    const worker = new worker_threads_1.Worker(path.resolve(__dirname, 'worker.ts'), {
        workerData: { files },
    });
    // logToFile(`Processing files in worker: ${files.join(', ')}`);
    // logToFile(`Worker at ${path.resolve(__dirname, 'worker.ts')}`);
    worker.on('error', err => {
        console.error('Worker error:', err);
    });
    worker.on('exit', code => {
        if (code !== 0)
            console.error(`Worker stopped with exit code ${code}`);
    });
    worker.on('message', (diagnosticsList) => {
        connection.console.log('Received diagnostics from worker');
        for (const { uri, diagnostics } of diagnosticsList) {
            connection.sendDiagnostics({ uri, diagnostics });
        }
    });
}
// On document content change: trigger validation in worker
documents.onDidChangeContent((change) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { document } = change;
        if (document.uri.endsWith('.dat')) {
            validateDatFile(document, connection);
        }
        // Use the worker for heavy validation to avoid blocking
        processFilesInWorker([vscode_uri_1.URI.parse(document.uri).fsPath], (result) => {
            result.forEach(({ uri, diagnostics }) => {
                connection.sendDiagnostics({ uri, diagnostics });
            });
        });
    }
    catch (err) {
        logToFile(`Error during onDidChangeContent: ${String(err)}`);
    }
}));
// Recursively find all .dat files under directory
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
const logFile = path.join(__dirname, 'krl-server.log');
function logToFile(message) {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}
// Validate .dat file global declarations (from your original code)
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
        // End of PUBLIC DEFDAT block
        if (/^DEFDAT\s+\w+/i.test(line) && !/PUBLIC/i.test(line)) {
            insidePublicDefdat = false;
        }
        // Look for global declarations outside PUBLIC DEFDAT
        if (/^(DECL|SIGNAL|STRUC)/i.test(line) && !insidePublicDefdat) {
            const newDiagnostic = {
                severity: node_1.DiagnosticSeverity.Error,
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
// Function to find the word at a position, used for definition/hover
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
// You had this async function to find if a function is declared
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
                    };
                }
            }
        }
        return undefined;
    });
}
// Recursive find of .src, .dat, .sub files
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
// Definition provider
connection.onDefinition((params) => __awaiter(void 0, void 0, void 0, function* () {
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
    return node_1.Location.create(result.uri, {
        start: node_1.Position.create(result.line, result.startChar),
        end: node_1.Position.create(result.line, result.endChar),
    });
}));
// Hover provider
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
            value: `**${functionName}**(${result.params})`,
        },
    };
}));
// Completion provider
connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return [];
    const lines = document.getText().split(/\r?\n/);
    // Scan document to build variableStructTypes
    const variableStructTypes = {};
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
    if (!match)
        return [];
    const varName = match[1];
    const structName = variableStructTypes[varName];
    if (!structName)
        return [];
    // Use structDefinitions parsed elsewhere or implement parsing here if needed
    // For now, returning empty array (you can import or implement parseKrlFile here if you want)
    // Example stub:
    const structDefinitions = {};
    const members = structDefinitions[structName];
    if (!members)
        return [];
    return members.map(member => ({
        label: member,
        kind: node_1.CompletionItemKind.Field,
    }));
});
connection.listen();
documents.listen(connection);
//# sourceMappingURL=server.js.map