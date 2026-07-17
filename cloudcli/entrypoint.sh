#!/usr/bin/env bash
set -euo pipefail

config=/home/node/.codex/config.toml
auth=/home/node/.codex/auth.json

[[ -r "$config" ]] || { echo "Missing CC Switch Codex config" >&2; exit 1; }
[[ -r "$auth" ]] || { echo "Missing CC Switch Codex auth" >&2; exit 1; }

grep -Eq '^model_provider[[:space:]]*=[[:space:]]*"sub2api_local"' "$config" \
  || { echo "CloudCLI requires model_provider=sub2api_local" >&2; exit 1; }
grep -Eq 'base_url[[:space:]]*=[[:space:]]*"http://sub2api:8080/v1"' "$config" \
  || { echo "CloudCLI requires the internal Sub2API base URL" >&2; exit 1; }

exec node /app/dist-server/server/index.js
