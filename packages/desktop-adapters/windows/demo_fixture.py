"""Real interactive UIA safety demonstration against the synthetic WinForms app."""
import ctypes
import hashlib
import json
import pathlib
import subprocess
import time

from helper import HelperError, WindowsAdapter

ROOT = pathlib.Path(__file__).resolve().parents[3]
EXE = ROOT / "tests" / "fixtures" / "windows-ui" / "bin" / "Debug" / "net9.0-windows" / "Fixture.exe"
EVIDENCE = ROOT / "tests" / "fixtures" / "windows-ui" / "evidence"
APPS = {"app_fixture": str(EXE)}


def launch(adapter):
    process = subprocess.Popen([str(EXE)], shell=False)
    for _ in range(50):
        windows = adapter.dispatch("list_windows", {"approvedApps": APPS})["windows"]
        match = next((item for item in windows if adapter.windows[item["windowRef"]].pid == process.pid), None)
        if match:
            return process, match["windowRef"]
        time.sleep(0.2)
    process.terminate()
    raise RuntimeError("FIXTURE_WINDOW_NOT_FOUND")


def control(observation, name):
    match = next((item for item in observation["controls"] if item["name"] == name), None)
    if not match:
        raise RuntimeError("CONTROL_NOT_FOUND:" + name)
    return match["controlRef"]


def run():
    adapter = WindowsAdapter()
    result = {"session": adapter.dispatch("session_state", {})["state"]}
    assert result["session"] == "UNLOCKED"
    first, ref_a = launch(adapter)
    second = None
    try:
        adapter.dispatch("focus_window", {"approvedApps": APPS, "windowRef": ref_a})
        obs = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref_a})
        secret_controls = [item for item in obs["controls"] if item["secret"]]
        result["passwordRedacted"] = bool(secret_controls) and all(item["name"] == "[credential field]" and item["text"] == "" for item in secret_controls) and "synthetic-password-fixture" not in json.dumps(obs)
        result["passwordInputBlocked"] = False
        if secret_controls:
            try:
                adapter.dispatch("type_text", {"approvedApps": APPS, "windowRef": ref_a, "snapshotId": obs["snapshotId"], "controlRef": secret_controls[0]["controlRef"], "text": "SHOULD_NOT_APPEAR"})
            except HelperError as error:
                result["passwordInputBlocked"] = str(error) == "AUTH_REQUIRED"
        text_ref = control(obs, "Fixture input")
        text = "Phase 5 literal {ENTER} ^A %F4 + ( )"
        result["typed"] = adapter.dispatch("type_text", {"approvedApps": APPS, "windowRef": ref_a, "snapshotId": obs["snapshotId"], "controlRef": text_ref, "text": text})["verified"]
        second, ref_b = launch(adapter)
        adapter.dispatch("focus_window", {"approvedApps": APPS, "windowRef": ref_b})
        try:
            adapter.dispatch("type_text", {"approvedApps": APPS, "windowRef": ref_a, "snapshotId": obs["snapshotId"], "controlRef": text_ref, "text": "WRONG_WINDOW"})
            result["wrongWindowBlocked"] = False
        except HelperError as error:
            result["wrongWindowBlocked"] = str(error) == "WINDOW_NOT_FOREGROUND"
        adapter.dispatch("focus_window", {"approvedApps": APPS, "windowRef": ref_a})
        fresh = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref_a})
        adapter.dispatch("click_control", {"approvedApps": APPS, "windowRef": ref_a, "snapshotId": fresh["snapshotId"], "controlRef": control(fresh, "Update status")})
        after = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref_a})
        result["clickVerified"] = any(item.get("text") == "Updated: " + text for item in after["controls"])
        EVIDENCE.mkdir(exist_ok=True)
        screenshot = EVIDENCE / "fixture-window.png"
        capture = adapter.dispatch("capture_window", {"approvedApps": APPS, "windowRef": ref_a, "snapshotId": after["snapshotId"], "artifactPath": str(screenshot)})
        result["screenshot"] = {"width": capture["width"], "height": capture["height"], "sha256": hashlib.sha256(screenshot.read_bytes()).hexdigest()}
        stale = adapter.dispatch("inspect_window", {"approvedApps": APPS, "windowRef": ref_a})
        hwnd = adapter.windows[ref_a].handle
        l, t, r, b = stale["bounds"]
        ctypes.windll.user32.SetWindowPos(hwnd, 0, l + 30, t + 30, r - l, b - t, 0x0004)
        try:
            adapter.dispatch("click_control", {"approvedApps": APPS, "windowRef": ref_a, "snapshotId": stale["snapshotId"], "controlRef": control(stale, "Update status")})
            result["movementBlocked"] = False
        except HelperError as error:
            result["movementBlocked"] = str(error) == "STALE_OBSERVATION"
        result["dpi"] = ctypes.windll.user32.GetDpiForWindow(hwnd)
        result["monitorCount"] = ctypes.windll.user32.GetSystemMetrics(80)
        result["result"] = "PASS" if all(result.get(key) for key in ("typed", "wrongWindowBlocked", "clickVerified", "movementBlocked", "passwordRedacted", "passwordInputBlocked")) else "FAIL"
        print(json.dumps(result))
    finally:
        for process in (first, second):
            if process:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()


if __name__ == "__main__":
    run()
