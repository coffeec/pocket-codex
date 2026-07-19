#!/usr/bin/env python3
"""Restricted loopback-only adapter for the Palworld REST API."""

import base64
import binascii
import json
import re
import sys
import urllib.error
import urllib.request


SETTINGS_PATH = "/home/coffee/Steam/steamapps/common/PalServer/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"
MAX_RESPONSE_BYTES = 1024 * 1024


def parse_settings(text):
    enabled = re.search(r"(?:^|[,(])RESTAPIEnabled=(True|False)(?:,|\))", text)
    port = re.search(r"(?:^|[,(])RESTAPIPort=([0-9]{1,5})(?:,|\))", text)
    password = re.search(r'(?:^|[,(])AdminPassword="((?:\\.|[^"\\])*)"(?:,|\))', text)
    if not enabled or enabled.group(1) != "True":
        raise RuntimeError("Palworld REST API is disabled")
    if not port or not password:
        raise RuntimeError("Palworld REST API configuration is incomplete")

    port_number = int(port.group(1))
    if port_number < 1 or port_number > 65535:
        raise RuntimeError("Palworld REST API port is invalid")

    escaped = password.group(1)
    password_value = re.sub(r'\\([\\"])', r'\1', escaped)
    if not password_value or any(ord(char) < 32 or ord(char) == 127 for char in password_value):
        raise RuntimeError("Palworld administrator password is invalid")
    return port_number, password_value


def load_settings():
    with open(SETTINGS_PATH, "r", encoding="utf-8") as handle:
        return parse_settings(handle.read())


def request_api(path, method="GET", body=None):
    port, password = load_settings()
    credentials = base64.b64encode(("admin:" + password).encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        "http://127.0.0.1:{}{}".format(port, path),
        data=body,
        method=method,
        headers={
            "Authorization": "Basic " + credentials,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=5) as response:
        payload = response.read(MAX_RESPONSE_BYTES + 1)
        if len(payload) > MAX_RESPONSE_BYTES:
            raise RuntimeError("Palworld REST API response is too large")
        return payload


def bounded_text(value, limit):
    normalized = re.sub(r"[\x00-\x1f\x7f]", " ", str(value or ""))
    return re.sub(r"\s+", " ", normalized).strip()[:limit]


def sanitize_players(payload):
    players = payload.get("players")
    if not isinstance(players, list):
        raise RuntimeError("Palworld REST API returned an invalid player list")

    sanitized = []
    for player in players[:100]:
        if not isinstance(player, dict):
            continue
        entry = {"name": bounded_text(player.get("name"), 64)}
        if isinstance(player.get("level"), int):
            entry["level"] = max(0, min(player["level"], 9999))
        if isinstance(player.get("ping"), (int, float)):
            entry["ping"] = max(0, min(round(float(player["ping"]), 1), 99999))
        sanitized.append(entry)
    return {"available": True, "count": len(sanitized), "players": sanitized}


def decode_broadcast(encoded):
    if len(encoded) > 1068 or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", encoded):
        raise RuntimeError("Broadcast message is invalid")
    try:
        message = base64.b64decode(encoded, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as error:
        raise RuntimeError("Broadcast message is invalid") from error
    message = message.strip()
    if not message or len(message) > 200 or len(message.encode("utf-8")) > 800:
        raise RuntimeError("Broadcast message is invalid")
    if any(ord(char) < 32 or ord(char) == 127 for char in message):
        raise RuntimeError("Broadcast message is invalid")
    return message


def run(action, argument=None):
    if action == "players" and argument is None:
        payload = json.loads(request_api("/v1/api/players").decode("utf-8"))
        print(json.dumps(sanitize_players(payload), ensure_ascii=False, separators=(",", ":")))
        return
    if action == "broadcast" and argument is not None:
        message = decode_broadcast(argument)
        body = json.dumps({"message": message}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request_api("/v1/api/announce", method="POST", body=body)
        print('{"ok":true}')
        return
    raise RuntimeError("Denied")


def main():
    try:
        if len(sys.argv) == 2:
            run(sys.argv[1])
        elif len(sys.argv) == 3:
            run(sys.argv[1], sys.argv[2])
        else:
            raise RuntimeError("Denied")
    except (RuntimeError, OSError, ValueError, json.JSONDecodeError, urllib.error.URLError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(69)


if __name__ == "__main__":
    main()
