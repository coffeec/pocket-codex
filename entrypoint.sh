#!/usr/bin/env bash
set -euo pipefail

password_file=/run/secrets/web_password
if [[ ! -s "$password_file" ]]; then
  echo "Missing web password secret: $password_file" >&2
  exit 1
fi

if [[ "${CC_SWITCH_PROXY:-0}" == "1" ]]; then
  cc-switch --app codex proxy enable
fi

web_user=${WEB_USER:-admin}
web_password=$(<"$password_file")

exec ttyd \
  --interface 0.0.0.0 \
  --port 7681 \
  --writable \
  --credential "${web_user}:${web_password}" \
  bash --login
