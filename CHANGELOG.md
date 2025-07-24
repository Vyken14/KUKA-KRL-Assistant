# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2025-07-24
### Added
- Error if a variable length is more than 24 characters
- Error if a GLOBAL is used without DECL, SIGNAL, STRUC
- Check all files for error when opening a workspace or at VS Code startup

---

## [1.1.1] - 2025-07-23
### Added
- Do nothing if the function clicked is already on DECL line

### Fixed
- `Go to Definition` sometimes didn't work with function
- `Go to Definition` sometimes did a peek insteak of a Go To on variables

---

## [1.1.0] - 2025-07-23
### Added
- Basic cross-file support for variable declarations using `DECL`, `SIGNAL`, and `STRUC`.
- `Go to Definition` support now variables accros multiples files.

---

## [1.0.0] - 2025-07-22
### Added
- Initial release.
- Syntax highlighting for KUKA KRL.
- Basic `Go to Definition` support for function only.
- Snippet support for KRL keywords.
