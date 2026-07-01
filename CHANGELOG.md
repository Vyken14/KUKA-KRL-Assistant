# Changelog

All notable changes to this project will be documented in this file.

---

## [1.7.0] - 2026-05-07
### Added
- Folding ranges for KRL block constructs: `DEF`/`DEFFCT`/`DEFDAT`, `IF`, `LOOP`, `FOR`, `WHILE`, `SWITCH`, `STRUC` and `REPEAT`. Also folds the KUKA-style `;FOLD … ;ENDFOLD` editor blocks that appear in machine-generated code.
- Recognize uppercase file extensions `.SRC`, `.DAT` and `.SUB` in addition to the lowercase variants — KUKA controllers commonly produce uppercase filenames.

---

## [1.6.0] - 2026-05-07
### Added
- Find All References (`Shift+F12`, right-click → "Find All References" / "Go to References", peek view via `Alt+Shift+F12`). Case-insensitive workspace-wide search across `.src`, `.dat` and `.sub` files. Skips line comments, subvariable accesses (`foo.bar`) and system variables (`$foo`, `#foo`). Honors the LSP `includeDeclaration` flag.

---

## [1.5.0] - 2026-05-07
### Added
- Document Symbols / Outline support for `DEF`, `DEFFCT` and `DEFDAT` blocks. Functions and data modules now appear in the Outline view, in Breadcrumbs, and via the symbol picker (Ctrl+Shift+O).

### Fixed
- `Go to Definition` failed when the symbol was written with a different case than its declaration. KRL is case-insensitive, but variable, struct and function lookups compared names strictly. Now all lookups are case-insensitive, and the jump position is computed correctly even when the file uses a different casing than the call site.

---

## [1.4.6] - 2025-08-24
### Fixed
- Fix issue with variables that could contain the string "Global" and trigger the PUBLIC DEFDAT error.

---

## [1.4.5] - 2025-08-24
### Fixed
- Fix issue with global variables inside a DEDFAT error

---

## [1.4.4] - 2025-07-28
### Fixed
- Fix warning for DECL variable with GLOBAL if a predefined type is used

------

## [1.4.3] - 2025-07-28
### Fixed
- Autocompletion via Intellisense didn't show Keywords when written

---

## [1.4.2] - 2025-07-28
### Fixed
- `Go to Definition` didn't work properly for variable or custom variable type
- `Go to Definition` will first check inside the same DEF, DEFCT if the variable is declare, then will check globally

---

## [1.4.1] - 2025-07-25
### Fixed
- Autocompletion with variables only shows now subvariables with '.', not declared functions

---

## [1.4.0] - 2025-07-25
### Added
- Autocompletion via Intellisense for functions with respectives params

### Removed
- Warning for GLOBAL ENUM that don't required DECL

---

## [1.3.1] - 2025-07-25
### Other
- Update ReadMe and Changelog

---

## [1.3.0] - 2025-07-25
### Added
- Extract variables from DECL, STRUC, and ENUM.
- Autocompletion for variables after typing the variable name followed by '.'.

### Fixed
- Errors and warnings were displayed multiple times; now they appear only once until cleared by the user.

### Other
- Refactored and cleaned up server and client code.

---

## [1.2.0] - 2025-07-24
### Added
- Error if a variable length is more than 24 characters
- Error if a GLOBAL is used without DECL, SIGNAL, STRUC
- Check all files for errors when opening a workspace or at VS Code startup.

---

## [1.1.1] - 2025-07-23
### Added
- No action if the clicked function is already on the DECL line.

### Fixed
- `Go to Definition` sometimes didn't work with function
- `Go to Definition` sometimes performed a peek instead of a go-to on variables.

---

## [1.1.0] - 2025-07-23
### Added
- Basic cross-file support for variable declarations using `DECL`, `SIGNAL`, and `STRUC`.
- `Go to Definition` now supports variables across multiple files.

---

## [1.0.0] - 2025-07-22
### Added
- Initial release.
- Syntax highlighting for KUKA KRL.
- Basic `Go to Definition` support for function only.
- Snippet support for KRL keywords.
