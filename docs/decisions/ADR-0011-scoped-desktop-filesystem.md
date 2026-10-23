# ADR-0011: Scoped Desktop Filesystem

- Status: Proposed; implementation in progress and unverified
- Date: 2026-10-22

## Context

Backend and model requests must not be able to choose arbitrary machine paths. Local user intent must authorize each root and operation.

## Decision

The desktop main process adds roots only using a native folder picker and local confirmation. Tools address files by opaque `rootId` and relative path. Local root grants separately specify SEARCH, READ, WRITE, MOVE_IN, and MOVE_OUT. A shared path authorization module rejects absolute paths, traversal, and filesystem links and uses canonical path containment. Writes default to create-new, replacement requires an expected content hash, and moves require both source/destination grants. A durable local ledger protects write/move replay. No delete or shell tool is provided.

## Alternatives considered

- Trusting backend absolute paths: rejected because it makes the model/backend the sole filesystem boundary.
- String-prefix root checks: rejected because same-prefix siblings escape containment.
- Following links: rejected because symlinks/junctions may escape approved roots.

## Tradeoffs

Path revalidation is practical defense-in-depth but is not race-free against a malicious local process that can change filesystem links concurrently. Cross-filesystem moves return unsupported. Local paths are stored as user-data metadata.

## Impact

The worker performs local permission and path checks independently of backend policy. Windows junction, ACL, filesystem crash, and TOCTOU behavior remain unverified.
