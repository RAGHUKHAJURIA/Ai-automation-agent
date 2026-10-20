# Agent core

# Agent core

Contains the provider-neutral bounded agent loop, structured actions, trust-labelled context construction, credential redaction, checkpoint schemas, usage/step limits, retry budget, and repeated-action detection. It has no direct provider SDK dependency and never executes a tool itself; an application callback owns policy evaluation and execution. Deterministic orchestration tests are under `test/`.

The implementation is Phase 2 and remains unverified until the test suite and provider/database flows run successfully.
