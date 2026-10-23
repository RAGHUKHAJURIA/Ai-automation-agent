import json
import subprocess
import sys
import time
import unittest

from helper import HelperError, validate_request


def request(operation, payload=None, **changes):
    value = {
        "protocolVersion": 1,
        "requestId": "test-1",
        "operation": operation,
        "deadline": time.time() * 1000 + 5000,
        "payload": payload or {},
    }
    value.update(changes)
    return value


class ProtocolTests(unittest.TestCase):
    def test_valid_request(self):
        self.assertEqual(validate_request(request("ping"))["operation"], "ping")

    def test_rejects_invalid_version_and_expired_deadline(self):
        for bad in (request("ping", protocolVersion=2), request("ping", deadline=1)):
            with self.assertRaises(HelperError):
                validate_request(bad)

    def test_rejects_extra_payload(self):
        with self.assertRaises(HelperError):
            validate_request({**request("ping"), "python": "print(1)"})

    def test_stdio_ping_and_unknown_operation(self):
        with subprocess.Popen([sys.executable, "-I", "helper.py"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as process:
            for value in (request("ping"), request("eval"), request("ping", {"unexpected": "value"})):
                process.stdin.write(json.dumps(value) + "\n")
                process.stdin.flush()
                response = json.loads(process.stdout.readline())
                self.assertEqual(response["protocolVersion"], 1)
                if value["operation"] == "ping" and not value["payload"]:
                    self.assertEqual(response["status"], "SUCCESS")
                else:
                    self.assertEqual(response["status"], "FAILED")
            process.terminate()


if __name__ == "__main__":
    unittest.main()
