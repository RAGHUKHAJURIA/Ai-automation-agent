# ADR-0017: Windows UI input and observation safety

Status: Accepted for partial Phase 5 implementation, 2026-10-23.

The helper uses UIA first and opaque window/control IDs. A window ID binds HWND, PID, process start time, and locally approved executable path. A control ID binds a fresh snapshot and its original wrapper/bounds. Before input, it checks unlocked input desktop, current process identity, window existence, snapshot age and geometry, and actual foreground HWND. It then performs one bounded action. No model-provided pywinauto selector or key expression is accepted. Literal text uses `set_edit_text`, never `send_keys` syntax. The tested fixed hotkey is VS Code Ctrl+P.

Click effects require a fresh post-action observation and an expected text transition. Without sufficient evidence the result is `OUTCOME_UNKNOWN`; no automatic repeat is authorized. Consequential or unknown buttons are denied by the helper until app-specific approval handling exists. The owner can take control locally; resume clears observations. A coarse last-input tick detects some owner activity without recording keys. It cannot eliminate the OS race between checking foreground and sending input.

Window screenshots are captured from the target window bounds into a private local artifact directory with a 24-hour pruning rule. No image bytes go to the model. A visual-target/coordinate-click fallback is deferred because privacy, occlusion, DPI, and freshness enforcement are not yet adequate. WinForms fixture behavior was verified at 120 DPI with one monitor; cross-monitor behavior remains unverified.
