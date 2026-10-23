"""Read-only UIA probe of a fresh classic Windows Character Map window."""
import ctypes
import json
import subprocess
import time

from helper import WindowsAdapter

EXE = r"C:\Windows\System32\charmap.exe"
APPS = {"app_charmap": EXE}
adapter = WindowsAdapter()
before = {item["windowRef"] for item in adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"]}
process = subprocess.Popen([EXE], shell=False)
ref = None
try:
    for _ in range(40):
        match = next((item for item in adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"] if item["windowRef"] not in before), None)
        if match:
            ref = match["windowRef"]
            break
        time.sleep(0.2)
    if not ref:
        print(json.dumps({"result": "BLOCKED", "code": "CHARMAP_WINDOW_NOT_FOUND", "processExit": process.poll()}))
    else:
        focus = adapter.dispatch("focus_window", {"approvedApps": APPS, "windowRef": ref})
        observed = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref})
        print(json.dumps({"result": "OBSERVED", "foreground": focus["foreground"], "title": next((x["title"] for x in adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"] if x["windowRef"] == ref), ""), "controls": [{"type": x["controlType"], "name": x["name"], "text": x["text"]} for x in observed["controls"]]}))
finally:
    if ref:
        ctypes.windll.user32.PostMessageW(adapter.windows[ref].handle, 0x0010, 0, 0)
    process.terminate()
