"""Read-only UIA probe of a dedicated synthetic VS Code window."""
import json
import pathlib
import subprocess
import time
import ctypes

from helper import WindowsAdapter

ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKSPACE = ROOT / "tests" / "fixtures" / "vscode-workspace"
EXE = pathlib.Path.home() / "AppData" / "Local" / "Programs" / "Microsoft VS Code" / "Code.exe"
APPS = {"app_vscode": str(EXE)}

adapter = WindowsAdapter()
before = {item["windowRef"] for item in adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"]}
process = subprocess.Popen([str(EXE), "--new-window", str(WORKSPACE), str(WORKSPACE / "fixture.txt")], shell=False)
ref = None
try:
    for _ in range(60):
        windows = adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"]
        match = next((item for item in windows if item["windowRef"] not in before and WORKSPACE.name.lower() in item["title"].lower()), None)
        if match:
            ref = match["windowRef"]
            break
        time.sleep(0.25)
    if not ref:
        print(json.dumps({"result": "BLOCKED", "code": "VSCODE_WINDOW_NOT_FOUND", "processExit": process.poll()}))
    else:
        focused = adapter.dispatch("focus_window", {"approvedApps": APPS, "windowRef": ref})
        snapshot = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref})
        print(json.dumps({"result": "OBSERVED", "windowRef": ref, "title": next((item["title"] for item in adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"] if item["windowRef"] == ref), ""), "focus": focused["foreground"], "bounds": snapshot["bounds"], "controls": [{"type": item["controlType"], "name": item["name"][:80]} for item in snapshot["controls"][:60]]}))
finally:
    if ref:
        ctypes.windll.user32.PostMessageW(adapter.windows[ref].handle, 0x0010, 0, 0)
