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
exports.mergeAllVariables = exports.validateVariablesUsage = exports.DeclaredVariableCollector = exports.isDuplicateDiagnostic = exports.splitVarsRespectingBrackets = void 0;
const node_1 = require("vscode-languageserver/node");
// Utility function
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
exports.splitVarsRespectingBrackets = splitVarsRespectingBrackets;
// Duplicate diagnostic checker
function isDuplicateDiagnostic(newDiag, existingDiagnostics) {
    return existingDiagnostics.some(diag => diag.range.start.line === newDiag.range.start.line &&
        diag.range.start.character === newDiag.range.start.character &&
        diag.range.end.line === newDiag.range.end.line &&
        diag.range.end.character === newDiag.range.end.character &&
        diag.message === newDiag.message &&
        diag.severity === newDiag.severity);
}
exports.isDuplicateDiagnostic = isDuplicateDiagnostic;
// DeclaredVariableCollector class
class DeclaredVariableCollector {
    constructor() {
        this.variables = new Map(); // name -> type
    }
    extractFromText(documentText) {
        const textWithoutStrucs = documentText.replace(/STRUC\s+\w+[^]*?ENDSTRUC/gi, '');
        const declRegex = /^\s*(GLOBAL\s+)?DECL\s+(GLOBAL\s+)?(\w+)\s+([^\r\n;]+)/gim;
        let match;
        while ((match = declRegex.exec(textWithoutStrucs)) !== null) {
            const type = match[3];
            const varList = match[4];
            const varNames = (0, exports.splitVarsRespectingBrackets)(varList)
                .map(name => name.trim())
                .map(name => name.replace(/\[.*?\]/g, '').trim())
                .map(name => name.replace(/\s*=\s*.+$/, ''))
                .filter(name => /^[a-zA-Z_]\w*$/.test(name));
            for (const name of varNames) {
                if (!this.variables.has(name)) {
                    this.variables.set(name, type);
                }
            }
        }
    }
    getVariables() {
        return Array.from(this.variables.entries()).map(([name, type]) => ({ name, type }));
    }
    clear() {
        this.variables.clear();
    }
}
exports.DeclaredVariableCollector = DeclaredVariableCollector;
// Validation function, **NOTE**: isFunctionDeclared needs to be passed in or removed for worker
function validateVariablesUsage(document, variableTypes, isFunctionDeclared) {
    return __awaiter(this, void 0, void 0, function* () {
        const diagnostics = [];
        const text = document.getText();
        const lines = text.split(/\r?\n/);
        const variableRegex = /\b([a-zA-Z_]\w*)\b/g;
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
            if (/^\s*(GLOBAL\s+)?(DECL|STRUC|SIGNAL)\b/i.test(line))
                continue;
            let match;
            while ((match = variableRegex.exec(line)) !== null) {
                const varName = match[1];
                const commentIndex = line.indexOf(';');
                if (commentIndex !== -1 && match.index >= commentIndex)
                    continue;
                const paramIndex = line.indexOf('&');
                if (paramIndex !== -1 && match.index >= paramIndex)
                    continue;
                if (match.index !== undefined && match.index > 0 && (line[match.index - 1] === '$' || line[match.index - 1] === '#'))
                    continue;
                if (yield isFunctionDeclared(varName))
                    continue;
                if (keywords.has(varName.toUpperCase()))
                    continue;
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
exports.validateVariablesUsage = validateVariablesUsage;
// Simple merge function
function mergeAllVariables(map) {
    const result = {};
    for (const vars of map.values()) {
        for (const v of vars) {
            result[v.name] = v.type || '';
        }
    }
    return result;
}
exports.mergeAllVariables = mergeAllVariables;
//# sourceMappingURL=krlLogic.js.map