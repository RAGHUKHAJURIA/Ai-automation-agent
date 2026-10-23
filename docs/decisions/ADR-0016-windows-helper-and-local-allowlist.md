# ADR-0016: Narrow Windows helper and local application approval

Status: Accepted for Phase 5 implementation, 2026-10-23.

The TypeScript Electron worker owns a Python 3.10 helper using pywinauto 0.6.9. The helper is launched as a child process with JSON-lines stdin/stdout, protocol version 1, request IDs, deadlines, request size limits, and a fixed operation registry. It has no HTTP listener, arbitrary Python execution, shell endpoint, or model-controlled executable path. The worker times out and terminates a hung helper; mutating requests with ambiguous failure become `OUTCOME_UNKNOWN`.

Approved executables are selected through a local native picker and persisted under Electron user data with canonical path, size, and modified time. Backend and model inputs contain only `appId` and typed launch modes. Changed executables must be reapproved. Updates can invalidate an approval; this is safer than silently trusting a changed binary. Terminal/interpreter executables are rejected. VS Code launch templates accept only a Phase 3 approved root and optional canonicalized known file.

The local venv and executable are currently a development installation. A production installer/package for the helper is not yet verified.
