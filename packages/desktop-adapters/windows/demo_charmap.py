"""Verified, clipboard-free workflow in a new Windows Character Map window."""
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
        item = next((item for item in adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"] if item["windowRef"] not in before), None)
        if item:
            ref = item["windowRef"]
            break
        time.sleep(0.2)
    if ref is None:
        raise RuntimeError("CHARMAP_WINDOW_NOT_FOUND")
    adapter.dispatch("focus_window", {"approvedApps": APPS, "windowRef": ref})
    initial = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref})
    advanced = next(item for item in initial["controls"] if item["name"] == "Advanced view")
    adapter.dispatch("click_control", {"approvedApps": APPS, "windowRef": ref, "snapshotId": initial["snapshotId"], "controlRef": advanced["controlRef"]})
    opened = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref})
    search = next((item for item in opened["controls"] if item["controlType"] == "Edit" and item["name"].lower().startswith("search for")), None)
    if search is None:
        print(json.dumps({"result": "BLOCKED", "code": "CHARMAP_SEARCH_FIELD_NOT_FOUND", "controls": [{"type": x["controlType"], "name": x["name"]} for x in opened["controls"]]}))
    else:
        adapter.dispatch("focus_window", {"approvedApps": APPS, "windowRef": ref})
        opened = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref})
        search = next(item for item in opened["controls"] if item["controlType"] == "Edit" and item["name"].lower().startswith("search for"))
        typed = adapter.dispatch("type_text", {"approvedApps": APPS, "windowRef": ref, "snapshotId": opened["snapshotId"], "controlRef": search["controlRef"], "text": "exclamation"})
        ready = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref})
        button = next(item for item in ready["controls"] if item["name"] == "Search")
        if not button["enabled"]:
            print(json.dumps({"result": "BLOCKED", "code": "SEARCH_BUTTON_DISABLED_AFTER_UIA_SET", "button": {"enabled": button["enabled"], "visible": button["visible"]}}))
            raise SystemExit(0)
        adapter.dispatch("click_control", {"approvedApps": APPS, "windowRef": ref, "snapshotId": ready["snapshotId"], "controlRef": button["controlRef"]})
        result = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref})
        matches = [item["text"] for item in result["controls"] if "exclamation" in item["text"].lower()]
        print(json.dumps({"result": "PASS" if typed["verified"] and matches else "FAIL", "focus": True, "typedVerified": typed["verified"], "observedResult": matches[:3], "visibleText": [item["text"] for item in result["controls"] if item["controlType"] == "Text"][:15], "dpi": result["dpi"]}))
finally:
    if ref:
        ctypes.windll.user32.PostMessageW(adapter.windows[ref].handle, 0x0010, 0, 0)
    process.terminate()
