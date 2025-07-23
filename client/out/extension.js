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
            fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
        }
    };
    client = new node_1.LanguageClient('kukaKRL', 'KUKA KRL Language Server', serverOptions, clientOptions);
    context.subscriptions.push(vscode.languages.registerDefinitionProvider('krl', {
        provideDefinition(document, position, token) {
            return __awaiter(this, void 0, void 0, function* () {
                const wordRange = document.getWordRangeAtPosition(position);
                if (!wordRange)
                    return;
                const word = document.getText(wordRange);
                // First: check current file
                const lines = document.getText().split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const rawLine = lines[i];
                    const line = rawLine.trim();
                    if ((line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) &&
                        line.includes(word)) {
                        const varRegex = new RegExp(`\\b${word}\\b`);
                        if (varRegex.test(line)) {
                            const startIdx = rawLine.indexOf(word);
                            if (startIdx >= 0) {
                                const start = new vscode.Position(i, startIdx);
                                const end = new vscode.Position(i, startIdx + word.length);
                                return new vscode.Location(document.uri, new vscode.Range(start, end));
                            }
                        }
                    }
                }
                // Then: check other files in workspace
                const files = yield vscode.workspace.findFiles('**/*.{src,dat,sub}', '**/node_modules/**');
                for (const file of files) {
                    if (file.fsPath === document.uri.fsPath)
                        continue;
                    const otherDoc = yield vscode.workspace.openTextDocument(file);
                    const otherLines = otherDoc.getText().split('\n');
                    for (let i = 0; i < otherLines.length; i++) {
                        const rawLine = otherLines[i];
                        const line = rawLine.trim();
                        if ((line.startsWith('DECL') || line.startsWith('SIGNAL') || line.startsWith('STRUC')) &&
                            line.includes(word)) {
                            const varRegex = new RegExp(`\\b${word}\\b`);
                            if (varRegex.test(line)) {
                                const startIdx = rawLine.indexOf(word);
                                if (startIdx >= 0) {
                                    const start = new vscode.Position(i, startIdx);
                                    const end = new vscode.Position(i, startIdx + word.length);
                                    return new vscode.Location(file, new vscode.Range(start, end));
                                }
                            }
                        }
                    }
                }
                return null;
            });
        }
    }));
    client.start();
}
exports.activate = activate;
function deactivate() {
    if (!client)
        return undefined;
    return client.stop();
}
exports.deactivate = deactivate;
