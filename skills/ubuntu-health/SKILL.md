---
name: ubuntu-health
description: Diagnose Ubuntu CPU, temperature, memory, disk, battery, Palworld, and FRP health using only PocketCodex's read-only hostctl commands. Use for server health checks, capacity checks, overheating, lag, or outage triage.
---

# Ubuntu Health

1. Run `/workspace/hostctl status`, then add `cpu`, `memory`, `disk`, or `battery` when relevant.
2. For service incidents, add only the matching `pal-status`, `pal-logs`, `frp-status`, or `frp-logs` command.
3. State measurements, thresholds, and uncertainty separately.
4. Recommend follow-up checks without asserting unobserved changes.

Do not bypass hostctl, use sudo, alter services, inspect `/etc` or `/home`, or search for secrets.
