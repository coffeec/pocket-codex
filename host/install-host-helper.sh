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

if ! id codexbot >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash codexbot
fi
usermod -aG systemd-journal codexbot

install -o root -g root -m 0755 "$project_dir/host/codex-host-helper" /usr/local/sbin/codex-host-helper
install -d -o codexbot -g codexbot -m 0700 /home/codexbot/.ssh
printf 'restrict,command="/usr/local/sbin/codex-host-helper" %s\n' "$public_key" \
  > /home/codexbot/.ssh/authorized_keys
chown codexbot:codexbot /home/codexbot/.ssh/authorized_keys
chmod 0600 /home/codexbot/.ssh/authorized_keys

echo "Installed read-only host helper for user codexbot."
