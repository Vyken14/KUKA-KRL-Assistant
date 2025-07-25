"use strict";
// worker.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { URI } = require('vscode-uri');
const { TextDocument } = require('vscode-languageserver-textdocument');
// Import pure logic from krlLogic.js
const { DeclaredVariableCollector, validateVariablesUsage, mergeAllVariables } = require('./krlLogic');
// Logging helper
const logFile = path.join(__dirname, 'krl-worker.log');
function logToFile(message) {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}
// Dummy fallback if needed
function dummyIsFunctionDeclared() {
    return true;
}
// Message listeners (optional, only needed if you expect messages)
if (parentPort) {
    parentPort.on('message', (msg) => {
        logToFile(`Worker received message: ${JSON.stringify(msg)}`);
    });
}
(() => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    logToFile(`Worker started live`);
    try {
        logToFile(`Worker started with files: ${(_a = workerData === null || workerData === void 0 ? void 0 : workerData.files) === null || _a === void 0 ? void 0 : _a.length}`);
        const fileVariablesMap = new Map();
        const diagnosticsList = [];
        for (const filePath of workerData.files) {
            const content = fs.readFileSync(filePath, 'utf8');
            const uri = URI.file(filePath).toString();
            const collector = new DeclaredVariableCollector();
            collector.extractFromText(content);
            fileVariablesMap.set(uri, collector.getVariables());
        }
        const mergedVariables = mergeAllVariables(fileVariablesMap);
        for (const [uri, variables] of fileVariablesMap.entries()) {
            const content = fs.readFileSync(URI.parse(uri).fsPath, 'utf8');
            const document = TextDocument.create(uri, 'krl', 1, content);
            const diagnostics = yield validateVariablesUsage(document, mergedVariables, dummyIsFunctionDeclared);
            diagnosticsList.push({ uri, diagnostics });
        }
        logToFile(`Worker finished with diagnostics count: ${diagnosticsList.length}`);
        parentPort.postMessage(diagnosticsList);
    }
    catch (error) {
        logToFile(`Worker error: ${String(error)}`);
        parentPort.postMessage({ error: String(error) });
    }
}))();
//# sourceMappingURL=worker.js.map