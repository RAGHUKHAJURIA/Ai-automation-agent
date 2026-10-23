# Desktop package

Phase 3 source provides an Electron main/preload/renderer boundary, local Ed25519 device credentials protected with Electron `safeStorage`, pairing confirmation, outbound worker protocol v1, local allowed-root grants, bounded file search/read/write/move, and a local execution ledger.

This implementation is **in progress and unverified**. The Phase 2 task worker does not dispatch file tools through the API-hosted desktop gateway; device credential rotation and backend emergency stop are not implemented. Do not use personal folders for tests. The primary platform remains provisional Windows, and no operating-system runtime has been verified.

`pnpm dev:desktop` launches the development Electron app after workspace dependencies are installed. The renderer has no direct filesystem or Node access; privileged actions are mediated by schema-validated IPC in the main process. Browser/desktop UI automation, shell access, and file deletion are intentionally absent.
