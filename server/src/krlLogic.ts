import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';

// Interfaces
export interface VariableInfo {
  name: string;
  type: string;
}

export interface StructMap {
  [structName: string]: string[];
}

export interface VariableToStructMap {
  [varName: string]: string;
}

// Utility function
export const splitVarsRespectingBrackets = (input: string): string[] => {
  const result: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '[') bracketDepth++;
    if (char === ']') bracketDepth--;
    if (char === ',' && bracketDepth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current) result.push(current.trim());
  return result;
};

// Duplicate diagnostic checker
export function isDuplicateDiagnostic(newDiag: Diagnostic, existingDiagnostics: Diagnostic[]): boolean {
  return existingDiagnostics.some(diag =>
    diag.range.start.line === newDiag.range.start.line &&
    diag.range.start.character === newDiag.range.start.character &&
    diag.range.end.line === newDiag.range.end.line &&
    diag.range.end.character === newDiag.range.end.character &&
    diag.message === newDiag.message &&
    diag.severity === newDiag.severity
  );
}

// DeclaredVariableCollector class
export class DeclaredVariableCollector {
  private variables: Map<string, string> = new Map(); // name -> type

  extractFromText(documentText: string): void {
    const textWithoutStrucs = documentText.replace(/STRUC\s+\w+[^]*?ENDSTRUC/gi, '');

    const declRegex = /^\s*(GLOBAL\s+)?DECL\s+(GLOBAL\s+)?(\w+)\s+([^\r\n;]+)/gim;
    let match: RegExpExecArray | null;
    while ((match = declRegex.exec(textWithoutStrucs)) !== null) {
      const type = match[3];
      const varList = match[4];
      const varNames = splitVarsRespectingBrackets(varList)
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

  getVariables(): VariableInfo[] {
    return Array.from(this.variables.entries()).map(([name, type]) => ({ name, type }));
  }

  clear(): void {
    this.variables.clear();
  }
}

// Validation function, **NOTE**: isFunctionDeclared needs to be passed in or removed for worker
export async function validateVariablesUsage(
  document: TextDocument,
  variableTypes: { [varName: string]: string },
  isFunctionDeclared: (name: string) => Promise<boolean>
): Promise<Diagnostic[]> {

  const diagnostics: Diagnostic[] = [];
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

    if (/^\s*(GLOBAL\s+)?(DECL|STRUC|SIGNAL)\b/i.test(line)) continue;

    let match;
    while ((match = variableRegex.exec(line)) !== null) {
      const varName = match[1];

      const commentIndex = line.indexOf(';');
      if (commentIndex !== -1 && match.index >= commentIndex) continue;

      const paramIndex = line.indexOf('&');
      if (paramIndex !== -1 && match.index >= paramIndex) continue;

      if (match.index !== undefined && match.index > 0 && (line[match.index - 1] === '$' || line[match.index - 1] === '#')) continue;

      if (await isFunctionDeclared(varName)) continue;

      if (keywords.has(varName.toUpperCase())) continue;

      if (!(varName in variableTypes)) {
        const newDiagnostic: Diagnostic = {
          severity: DiagnosticSeverity.Error,
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
}

// Simple merge function
export function mergeAllVariables(map: Map<string, VariableInfo[]>): { [varName: string]: string } {
  const result: { [varName: string]: string } = {};
  for (const vars of map.values()) {
    for (const v of vars) {
      result[v.name] = v.type || '';
    }
  }
  return result;
}
