#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
if [[ $# -ne 1 || ! -s "$1" ]]; then
  echo "Usage: sudo $0 /path/to/id_ed25519.pub" >&2
  exit 2
fi

project_dir=$(cd "$(dirname "$0")/.." && pwd)
public_key=$(<"$1")
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT

if command -v cc >/dev/null 2>&1; then
  cc -O2 -Wall -Wextra -Werror "$project_dir/host/pocket-host-actions.c" -o "$build_dir/pocket-host-actions"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$project_dir:/src:ro" \
    -v "$build_dir:/out" \
    node:22-bookworm-slim \
    sh -lc 'apt-get update >/dev/null
      apt-get install -y --no-install-recommends gcc libc6-dev >/dev/null
      cc -O2 -Wall -Wextra -Werror /src/host/pocket-host-actions.c -o /out/pocket-host-actions'
else
  echo "Neither cc nor Docker is available to compile pocket-host-actions." >&2
  exit 3
fi

backup_dir="/var/backups/pocketcodex-host-helper/$(date +%Y%m%d-%H%M%S)"
install -d -o root -g root -m 0700 "$backup_dir"
[[ ! -e /usr/local/sbin/codex-host-helper ]] || cp -a /usr/local/sbin/codex-host-helper "$backup_dir/"
[[ ! -e /usr/local/sbin/pocket-host-actions ]] || cp -a /usr/local/sbin/pocket-host-actions "$backup_dir/"
[[ ! -e /home/codexbot/.ssh/authorized_keys ]] || cp -a /home/codexbot/.ssh/authorized_keys "$backup_dir/authorized_keys"

if ! id codexbot >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash codexbot
fi
usermod -aG systemd-journal codexbot

install -o root -g root -m 0755 "$project_dir/host/codex-host-helper" /usr/local/sbin/codex-host-helper
install -o root -g root -m 4755 "$build_dir/pocket-host-actions" /usr/local/sbin/pocket-host-actions
install -d -o codexbot -g codexbot -m 0700 /home/codexbot/.ssh
printf 'restrict,command="/usr/local/sbin/codex-host-helper" %s\n' "$public_key" \
  > /home/codexbot/.ssh/authorized_keys
chown codexbot:codexbot /home/codexbot/.ssh/authorized_keys
chmod 0600 /home/codexbot/.ssh/authorized_keys

echo "Installed restricted PocketCodex host helper for user codexbot."
echo "Previous helper files: $backup_dir"
