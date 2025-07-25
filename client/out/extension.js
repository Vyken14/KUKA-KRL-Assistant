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
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const node_1 = require("vscode-languageclient/node");
const path = require("path");
const diagnosticCollection = vscode.languages.createDiagnosticCollection('krl');
let client;
function activate(context) {
    const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
    const serverOptions = {
        run: { module: serverModule, transport: node_1.TransportKind.ipc },
        debug: { module: serverModule, transport: node_1.TransportKind.ipc }
    };
    const clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'krl' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{dat,src,sub}')
        }
    };
    client = new node_1.LanguageClient('kukaKRL', 'KUKA KRL Language Server', serverOptions, clientOptions);
    context.subscriptions.push(vscode.languages.registerDefinitionProvider('krl', {
        provideDefinition(document, position) {
            return __awaiter(this, void 0, void 0, function* () {
                const wordRange = document.getWordRangeAtPosition(position);
                if (!wordRange)
                    return;
                const word = document.getText(wordRange);
                const lines = document.getText().split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const rawLine = lines[i];
                    const line = rawLine.trim();
                    if ((line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) && line.includes(word)) {
                        const varRegex = new RegExp(`\\b${word}\\b`);
                        if (varRegex.test(line)) {
                            const startIdx = rawLine.indexOf(word);
                            if (startIdx >= 0) {
                                return new vscode.Location(document.uri, new vscode.Range(new vscode.Position(i, startIdx), new vscode.Position(i, startIdx + word.length)));
                            }
                        }
                    }
                }
                const files = yield vscode.workspace.findFiles('**/*.{src,dat,sub}', '**/node_modules/**');
                for (const file of files) {
                    if (file.fsPath === document.uri.fsPath)
                        continue;
                    const otherDoc = yield vscode.workspace.openTextDocument(file);
                    const otherLines = otherDoc.getText().split('\n');
                    for (let i = 0; i < otherLines.length; i++) {
                        const rawLine = otherLines[i];
                        const line = rawLine.trim();
                        if ((line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) && line.includes(word)) {
                            const varRegex = new RegExp(`\\b${word}\\b`);
                            if (varRegex.test(line)) {
                                const startIdx = rawLine.indexOf(word);
                                if (startIdx >= 0) {
                                    return new vscode.Location(file, new vscode.Range(new vscode.Position(i, startIdx), new vscode.Position(i, startIdx + word.length)));
                                }
                            }
                        }
                    }
                }
                return null;
            });
        }
    }));
    //Push when workspace changes
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        if (document.languageId === 'krl') {
            validateTextDocument(document);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'krl') {
            validateTextDocument(event.document);
            console.log("Sending custom/validateFile notification");
            client.sendNotification('custom/validateFile', {
                uri: event.document.uri.toString(),
                text: event.document.getText(),
            });
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        if (document.languageId === 'krl') {
            validateTextDocument(document);
        }
    }));
    const clientStartPromise = client.start();
    clientStartPromise.then(() => {
        // After client is ready, validate already open files
        vscode.workspace.textDocuments.forEach(document => {
            if (document.languageId === 'krl') {
                validateTextDocument(document);
            }
        });
        setTimeout(() => {
            validateAllKrlFiles();
        }, 1000);
    });
}
exports.activate = activate;
function validateTextDocument(document) {
    const diagnostics = [];
    for (let i = 0; i < document.lineCount; i++) {
        try {
            const line = document.lineAt(i);
            const fullText = line.text;
            const lineText = fullText.split(';')[0].trim();
            if (/\b(DECL|STRUC|SIGNAL)\b/i.test(lineText)) {
                const varPart = lineText
                    .replace(/\bDECL\b/i, '')
                    .replace(/\bGLOBAL\b/i, '')
                    .replace(/\b(INT|FRAME|LOAD|REAL|BOOL|STRING|SIGNAL|STRUC)\b/i, '')
                    .replace(/\b\w+_T\b/i, '')
                    .trim();
                const variableTokens = varPart.split(',').map(v => v.trim());
                for (const token of variableTokens) {
                    const rawVar = token.split('=')[0].split('[')[0].trim();
                    const match = rawVar.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
                    const varName = match ? match[1] : null;
                    if (varName && varName.length > 24) {
                        const varIndex = fullText.indexOf(varName);
                        if (varIndex >= 0) {
                            const range = new vscode.Range(new vscode.Position(i, varIndex), new vscode.Position(i, varIndex + varName.length));
                            const diagnostic = new vscode.Diagnostic(range, 'The variable is too long (max 24 characters)', vscode.DiagnosticSeverity.Error);
                            diagnostic.source = 'KRL Variable Length';
                            diagnostics.push(diagnostic);
                        }
                    }
                }
            }
            if (/\bGLOBAL\b/i.test(lineText) && !/\b(DECL|DEF|DEFFCT|STRUC|SIGNAL)\b/i.test(lineText)) {
                const globalIndex = fullText.indexOf('GLOBAL');
                const range = new vscode.Range(i, globalIndex, i, globalIndex + 'GLOBAL'.length);
                diagnostics.push({
                    message: `'GLOBAL' must be used with DECL, STRUC, or SIGNAL on the same line.`,
                    range,
                    severity: vscode.DiagnosticSeverity.Warning,
                    source: 'krl-linter'
                });
            }
        }
        catch (error) {
            console.error(`Error processing line ${i + 1}:`, error);
        }
    }
    diagnosticCollection.set(document.uri, diagnostics);
}
function validateAllKrlFiles() {
    return __awaiter(this, void 0, void 0, function* () {
        const patterns = ['**/*.src', '**/*.dat', '**/*.sub'];
        const uris = [];
        for (const pattern of patterns) {
            const matched = yield vscode.workspace.findFiles(pattern);
            uris.push(...matched);
        }
        for (const file of uris) {
            try {
                const alreadyOpen = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === file.fsPath);
                const document = alreadyOpen !== null && alreadyOpen !== void 0 ? alreadyOpen : yield vscode.workspace.openTextDocument(file);
                if (['src', 'dat', 'sub'].includes(document.languageId)) {
                    validateTextDocument(document);
                }
            }
            catch (error) {
                console.error(`Failed to validate ${file.fsPath}`, error);
            }
        }
    });
}
function deactivate() {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
    if (!client)
        return undefined;
    return client.stop();
}
exports.deactivate = deactivate;
