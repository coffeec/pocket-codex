import base64
import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("palworld-api.py")
SPEC = importlib.util.spec_from_file_location("palworld_api", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PalworldApiTests(unittest.TestCase):
    def test_settings_require_enabled_rest_api(self):
        text = '(RESTAPIEnabled=True,RESTAPIPort=8212,AdminPassword="safe-secret")'
        self.assertEqual(MODULE.parse_settings(text), (8212, "safe-secret"))
        with self.assertRaisesRegex(RuntimeError, "disabled"):
            MODULE.parse_settings(text.replace("True", "False"))

    def test_players_only_expose_safe_fields(self):
        result = MODULE.sanitize_players({"players": [{
            "name": "Player\nOne", "level": 42, "ping": 18.25,
            "iP": "192.0.2.10", "userId": "secret-id", "accountName": "private",
        }]})
        self.assertEqual(result, {
            "available": True,
            "count": 1,
            "players": [{"name": "Player One", "level": 42, "ping": 18.2}],
        })
        self.assertNotIn("secret-id", str(result))
        self.assertNotIn("192.0.2.10", str(result))

    def test_broadcast_is_base64_utf8_and_bounded(self):
        encoded = base64.b64encode("server restart in ten minutes".encode()).decode()
        self.assertEqual(MODULE.decode_broadcast(encoded), "server restart in ten minutes")
        for invalid in ("not base64!", base64.b64encode(b"line\nbreak").decode(),
                        base64.b64encode(("x" * 201).encode()).decode()):
            with self.assertRaisesRegex(RuntimeError, "invalid"):
                MODULE.decode_broadcast(invalid)


if __name__ == "__main__":
    unittest.main()
