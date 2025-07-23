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
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            hoverProvider: true
        }
    };
});
documents.onDidChangeContent(change => {
    // Could add diagnostics later
});
connection.onDefinition((params) => __awaiter(void 0, void 0, void 0, function* () {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return;
    const lines = doc.getText().split(/\r?\n/);
    const lineText = lines[params.position.line];
    const callMatch = lineText.match(/\b(\w+)\s*\(/);
    if (!callMatch)
        return;
    const functionName = callMatch[1];
    // Search all files in workspace
    if (!workspaceRoot)
        return;
    const files = yield findSrcFiles(workspaceRoot);
    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const fileLines = content.split(/\r?\n/);
        for (let i = 0; i < fileLines.length; i++) {
            const defLine = fileLines[i];
            const defRegex = /\b(GLOBAL\s+)?(DEF|DEFFCT)\s+(\w+\s+)?(\w+)\s*\(/i;
            const defMatch = defLine.match(defRegex);
            if (defMatch && defMatch[4] === functionName) {
                const uri = vscode_uri_1.URI.file(filePath).toString();
                return node_1.Location.create(uri, {
                    start: node_1.Position.create(i, defLine.indexOf(defMatch[4])),
                    end: node_1.Position.create(i, defLine.indexOf(defMatch[4]) + defMatch[4].length)
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
}));
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map