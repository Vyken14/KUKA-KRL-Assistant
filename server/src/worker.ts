// worker.ts

const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { URI } = require('vscode-uri');
const { TextDocument } = require('vscode-languageserver-textdocument');

// Import pure logic from krlLogic.js
const { DeclaredVariableCollector, validateVariablesUsage, mergeAllVariables } = require('./krlLogic');

// Logging helper
const logFile = path.join(__dirname, 'krl-worker.log');
function logToFile(message: string) {
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}

// Dummy fallback if needed
function dummyIsFunctionDeclared() {
  return true;
}

// Message listeners (optional, only needed if you expect messages)
if (parentPort) {
  parentPort.on('message', (msg: any) => {
    logToFile(`Worker received message: ${JSON.stringify(msg)}`);
  });
}

(async () => {
    logToFile(`Worker started live`);
  try {
    logToFile(`Worker started with files: ${workerData?.files?.length}`);

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

      const diagnostics = await validateVariablesUsage(document, mergedVariables, dummyIsFunctionDeclared);
      diagnosticsList.push({ uri, diagnostics });
    }

    logToFile(`Worker finished with diagnostics count: ${diagnosticsList.length}`);
    parentPort.postMessage(diagnosticsList);

  } catch (error) {
    logToFile(`Worker error: ${String(error)}`);
    parentPort.postMessage({ error: String(error) });
  }
})();
