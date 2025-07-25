# Changelog

All notable changes to this project will be documented in this file.

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
