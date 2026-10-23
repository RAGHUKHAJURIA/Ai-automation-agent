"""Narrow, local Windows UI Automation helper. JSON lines over stdio only."""

from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass

PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 65536
MAX_TEXT = 4000
MAX_CONTROLS = 100


class HelperError(Exception):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise HelperError(code)


def validate_request(value: object) -> dict:
    require(isinstance(value, dict), "INVALID_REQUEST")
    require(set(value) == {"protocolVersion", "requestId", "operation", "deadline", "payload"}, "INVALID_REQUEST")
    require(value["protocolVersion"] == PROTOCOL_VERSION, "PROTOCOL_MISMATCH")
    require(isinstance(value["requestId"], str) and len(value["requestId"]) <= 64, "INVALID_REQUEST_ID")
    require(isinstance(value["operation"], str), "INVALID_OPERATION")
    require(isinstance(value["deadline"], (int, float)) and value["deadline"] > time.time() * 1000, "DEADLINE_EXPIRED")
    require(isinstance(value["payload"], dict), "INVALID_PAYLOAD")
    return value


@dataclass
class WindowRecord:
    handle: int
    pid: int
    started: float
    app_id: str


class WindowsAdapter:
    def __init__(self) -> None:
        if sys.platform != "win32":
            raise HelperError("NOT_SUPPORTED")
        import ctypes
        # Must be set before creating windows or querying geometry.
        try:
            ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        except (AttributeError, OSError):
            ctypes.windll.user32.SetProcessDPIAware()
        ctypes.windll.user32.OpenInputDesktop.restype = ctypes.c_void_p
        ctypes.windll.user32.CloseDesktop.argtypes = [ctypes.c_void_p]
        ctypes.windll.user32.MonitorFromWindow.restype = ctypes.c_void_p
        from pywinauto import Desktop
        import psutil
        self.ctypes = ctypes
        self.Desktop = Desktop
        self.psutil = psutil
        self.windows: dict[str, WindowRecord] = {}
        self.controls: dict[str, tuple[str, str, object, tuple[int, int, int, int]]] = {}
        self.snapshots: dict[str, tuple[str, float, tuple[int, int, int, int]]] = {}

    def _process(self, pid: int):
        try:
            return self.psutil.Process(pid)
        except self.psutil.Error:
            raise HelperError("WINDOW_STALE") from None

    def _window(self, ref: str, approved: dict):
        require(isinstance(ref, str) and ref in self.windows, "WINDOW_NOT_FOUND")
        record = self.windows[ref]
        require(record.app_id in approved, "APP_NOT_APPROVED")
        process = self._process(record.pid)
        require(process.create_time() == record.started, "WINDOW_STALE")
        require(os.path.normcase(os.path.realpath(process.exe())) == os.path.normcase(os.path.realpath(approved[record.app_id])), "APP_IDENTITY_CHANGED")
        require(bool(self.ctypes.windll.user32.IsWindow(record.handle)), "WINDOW_STALE")
        _, current_pid = self._window_pid(record.handle)
        require(current_pid == record.pid, "WINDOW_STALE")
        try:
            wrapper = self.Desktop(backend="uia").window(handle=record.handle).wrapper_object()
        except Exception:
            raise HelperError("WINDOW_STALE") from None
        return record, wrapper

    def _window_pid(self, handle: int):
        pid = self.ctypes.c_ulong()
        thread = self.ctypes.windll.user32.GetWindowThreadProcessId(handle, self.ctypes.byref(pid))
        return thread, pid.value

    @staticmethod
    def _bounds(wrapper):
        r = wrapper.rectangle()
        return (r.left, r.top, r.right, r.bottom)

    def _display(self, handle: int):
        monitor = self.ctypes.windll.user32.MonitorFromWindow(handle, 2)
        return {"dpi": self.ctypes.windll.user32.GetDpiForWindow(handle), "monitorRef": f"monitor_{monitor:x}"}

    def _session(self):
        # OpenInputDesktop fails for locked/secure desktops. A zero foreground
        # window is also treated as unavailable; automation never bypasses it.
        user32 = self.ctypes.windll.user32
        desktop = user32.OpenInputDesktop(0, False, 0x0100)
        if not desktop:
            return "LOCKED"
        user32.CloseDesktop(desktop)
        return "UNLOCKED" if user32.GetForegroundWindow() else "LOCKED"

    def _last_input_tick(self):
        class LASTINPUTINFO(self.ctypes.Structure):
            _fields_ = [("cbSize", self.ctypes.c_uint), ("dwTime", self.ctypes.c_uint)]
        state = LASTINPUTINFO()
        state.cbSize = self.ctypes.sizeof(LASTINPUTINFO)
        if not self.ctypes.windll.user32.GetLastInputInfo(self.ctypes.byref(state)):
            return None
        return state.dwTime

    def _approved(self, payload: dict):
        apps = payload.get("approvedApps")
        require(isinstance(apps, dict) and len(apps) <= 50, "INVALID_APP_REGISTRY")
        for app_id, path in apps.items():
            require(isinstance(app_id, str) and app_id.startswith("app_") and isinstance(path, str) and path.lower().endswith(".exe"), "INVALID_APP_REGISTRY")
        return apps

    def _foreground(self, record: WindowRecord):
        require(self._session() == "UNLOCKED", "SESSION_LOCKED")
        require(self.ctypes.windll.user32.GetForegroundWindow() == record.handle, "WINDOW_NOT_FOREGROUND")

    def _snapshot(self, ref: str, snapshot_id: str, wrapper):
        record = self.snapshots.get(snapshot_id)
        require(record is not None and record[0] == ref, "STALE_OBSERVATION")
        require(time.time() - record[1] <= 5, "STALE_OBSERVATION")
        require(record[2] == self._bounds(wrapper), "STALE_OBSERVATION")

    def _control(self, ref: str, snapshot_id: str, control_ref: str, wrapper):
        self._snapshot(ref, snapshot_id, wrapper)
        entry = self.controls.get(control_ref)
        require(entry is not None and entry[0] == ref and entry[1] == snapshot_id, "CONTROL_STALE")
        control = entry[2]
        try:
            require(control.is_visible() and control.is_enabled() and self._bounds(control) == entry[3], "CONTROL_STALE")
        except Exception:
            raise HelperError("CONTROL_STALE") from None
        return control

    def dispatch(self, operation: str, payload: dict):
        require(operation in {"ping", "session_state", "list_windows", "inspect_window", "focus_window", "type_text", "click_control", "press_key", "hotkey", "capture_window"}, "UNKNOWN_OPERATION")
        if operation == "ping":
            require(not payload, "INVALID_PAYLOAD")
            import pywinauto
            return {"ready": True, "pywinautoVersion": pywinauto.__version__}
        if operation == "session_state":
            require(not payload, "INVALID_PAYLOAD")
            return {"state": self._session(), "lastInputTick": self._last_input_tick()}
        approved = self._approved(payload)
        if operation == "list_windows":
            require(set(payload) == {"approvedApps"}, "INVALID_PAYLOAD")
            found = []
            for window in self.Desktop(backend="uia").windows():
                try:
                    handle = window.handle
                    _, pid = self._window_pid(handle)
                    process = self._process(pid)
                    executable = os.path.normcase(os.path.realpath(process.exe()))
                    app_id = next((key for key, path in approved.items() if os.path.normcase(os.path.realpath(path)) == executable), None)
                    if not app_id or not window.is_visible():
                        continue
                    ref = next((key for key, value in self.windows.items() if value.handle == handle and value.pid == pid and value.started == process.create_time()), None)
                    if ref is None:
                        ref = str(uuid.uuid4())
                        self.windows[ref] = WindowRecord(handle, pid, process.create_time(), app_id)
                    found.append({"windowRef": ref, "appId": app_id, "title": window.window_text()[:160], "bounds": self._bounds(window), "foreground": self.ctypes.windll.user32.GetForegroundWindow() == handle, **self._display(handle)})
                    if len(found) >= 30:
                        break
                except Exception:
                    continue
            return {"windows": found, "sessionState": self._session()}
        ref = payload.get("windowRef")
        record, window = self._window(ref, approved)
        if operation == "inspect_window":
            require(set(payload) == {"approvedApps", "windowRef"}, "INVALID_PAYLOAD")
            snapshot_id = str(uuid.uuid4())
            bounds = self._bounds(window)
            self.snapshots.clear()
            self.controls.clear()
            self.snapshots[snapshot_id] = (ref, time.time(), bounds)
            controls = []
            try:
                descendants = window.descendants(depth=5)
            except Exception:
                raise HelperError("ACCESSIBILITY_UNAVAILABLE") from None
            for item in descendants[:MAX_CONTROLS]:
                try:
                    info = item.element_info
                    control_ref = str(uuid.uuid4())
                    item_bounds = self._bounds(item)
                    secret = bool(getattr(info, "is_password", False)) or "password" in (info.name or "").lower()
                    self.controls[control_ref] = (ref, snapshot_id, item, item_bounds)
                    kind = str(info.control_type)
                    display_text = item.window_text()[:160] if not secret and kind in {"Text", "Button", "CheckBox", "RadioButton", "Hyperlink"} else ""
                    controls.append({"controlRef": control_ref, "controlType": kind[:50], "name": "[credential field]" if secret else (info.name or "")[:120], "text": display_text, "automationId": (info.automation_id or "")[:100], "enabled": item.is_enabled(), "visible": item.is_visible(), "bounds": item_bounds, "secret": secret})
                except Exception:
                    continue
            return {"windowRef": ref, "snapshotId": snapshot_id, "bounds": bounds, "foreground": self.ctypes.windll.user32.GetForegroundWindow() == record.handle, "controls": controls, "observedAt": int(time.time() * 1000), **self._display(record.handle)}
        if operation == "focus_window":
            require(set(payload) == {"approvedApps", "windowRef"}, "INVALID_PAYLOAD")
            require(self._session() == "UNLOCKED", "SESSION_LOCKED")
            try:
                if window.is_minimized():
                    window.restore()
                window.set_focus()
            except Exception:
                raise HelperError("FOCUS_FAILED") from None
            self._foreground(record)
            return {"windowRef": ref, "foreground": True, "bounds": self._bounds(window)}
        snapshot_id = payload.get("snapshotId")
        require(isinstance(snapshot_id, str), "INVALID_PAYLOAD")
        self._snapshot(ref, snapshot_id, window)
        self._foreground(record)
        if operation == "type_text":
            require(set(payload) == {"approvedApps", "windowRef", "snapshotId", "controlRef", "text"}, "INVALID_PAYLOAD")
            value = payload["text"]
            require(isinstance(value, str) and len(value) <= MAX_TEXT, "INVALID_TEXT")
            control = self._control(ref, snapshot_id, payload["controlRef"], window)
            require(record.app_id in {"app_fixture", "app_notepad", "app_charmap"}, "TEXT_WORKFLOW_NOT_SUPPORTED")
            info = control.element_info
            if record.app_id == "app_charmap":
                require((info.name or "").lower().startswith("search for"), "TEXT_WORKFLOW_NOT_SUPPORTED")
            require(not bool(getattr(info, "is_password", False)) and "password" not in (info.name or "").lower(), "AUTH_REQUIRED")
            require(str(info.control_type) in {"Edit", "Document"}, "CONTROL_NOT_EDITABLE")
            if record.app_id == "app_charmap":
                require(bool(re.fullmatch(r"[A-Za-z0-9 ]{1,80}", value)), "INVALID_SEARCH_TEXT")
            self._foreground(record)
            try:
                if record.app_id == "app_charmap":
                    from pywinauto.keyboard import send_keys
                    control.set_focus()
                    require(control.has_keyboard_focus(), "CONTROL_NOT_FOCUSED")
                    self._foreground(record)
                    send_keys("^a")
                    send_keys(value, with_spaces=True)
                else:
                    control.set_edit_text(value)
                actual = control.get_value()
            except Exception:
                raise HelperError("INPUT_OUTCOME_UNKNOWN") from None
            require(actual == value, "INPUT_OUTCOME_UNKNOWN")
            return {"verified": True, "length": len(value)}
        if operation == "click_control":
            require(set(payload) == {"approvedApps", "windowRef", "snapshotId", "controlRef"}, "INVALID_PAYLOAD")
            control = self._control(ref, snapshot_id, payload["controlRef"], window)
            name = (control.element_info.name or "").lower()
            allowed_fixture = record.app_id == "app_fixture" and name == "update status"
            allowed_charmap = record.app_id == "app_charmap" and name in {"advanced view", "search"}
            require(allowed_fixture or allowed_charmap, "CONSEQUENTIAL_ACTION_DENIED")
            self._foreground(record)
            try:
                if hasattr(control, "invoke"):
                    control.invoke()
                else:
                    control.click_input()
            except Exception:
                raise HelperError("ACTION_OUTCOME_UNKNOWN") from None
            return {"inputSent": True, "verified": False}
        if operation in {"press_key", "hotkey"}:
            from pywinauto.keyboard import send_keys
            require(record.app_id == "app_vscode", "HOTKEY_NOT_ALLOWED")
            key = payload.get("key")
            if operation == "press_key":
                require(set(payload) == {"approvedApps", "windowRef", "snapshotId", "key"}, "INVALID_PAYLOAD")
                require(key in {"ESCAPE", "TAB", "UP", "DOWN"}, "KEY_NOT_ALLOWED")
                expression = {"ESCAPE": "{ESC}", "TAB": "{TAB}", "UP": "{UP}", "DOWN": "{DOWN}"}[key]
            else:
                require(set(payload) == {"approvedApps", "windowRef", "snapshotId", "key", "modifiers"}, "INVALID_PAYLOAD")
                require(payload["modifiers"] == ["CTRL"] and key == "P", "HOTKEY_NOT_ALLOWED")
                expression = "^p"
            self._foreground(record)
            send_keys(expression)
            return {"inputSent": True, "verified": False}
        if operation == "capture_window":
            require(set(payload) == {"approvedApps", "windowRef", "snapshotId", "artifactPath"}, "INVALID_PAYLOAD")
            target = payload["artifactPath"]
            require(isinstance(target, str) and target.lower().endswith(".png") and len(target) < 1024, "INVALID_ARTIFACT_PATH")
            try:
                image = window.capture_as_image()
                image.save(target, format="PNG")
            except Exception:
                raise HelperError("CAPTURE_FAILED") from None
            return {"width": image.width, "height": image.height, "bounds": self._bounds(window), **self._display(record.handle)}
        raise HelperError("UNKNOWN_OPERATION")


def serve() -> None:
    adapter = WindowsAdapter()
    for line in sys.stdin.buffer:
        request_id = "unknown"
        try:
            require(len(line) <= MAX_REQUEST_BYTES, "REQUEST_TOO_LARGE")
            request = validate_request(json.loads(line))
            request_id = request["requestId"]
            result = adapter.dispatch(request["operation"], request["payload"])
            response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "status": "SUCCESS", "result": result}
        except (ValueError, TypeError, json.JSONDecodeError):
            response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "status": "FAILED", "errorCode": "INVALID_REQUEST"}
        except HelperError as error:
            response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "status": "FAILED", "errorCode": str(error)}
        except Exception:
            response = {"protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "status": "FAILED", "errorCode": "HELPER_OPERATION_FAILED"}
        sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    serve()
