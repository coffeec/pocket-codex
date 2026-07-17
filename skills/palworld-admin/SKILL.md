---
name: palworld-admin
description: Inspect Palworld service health and recent logs through PocketCodex's existing read-only hostctl boundary. Use for Palworld status, crash, disconnect, memory, or FRP reachability diagnosis; this skill never restarts or changes the host.
---

# Palworld Admin

1. Run `/workspace/hostctl pal-status` and `/workspace/hostctl pal-logs`.
2. For disconnects or lag, also run `status`, `cpu`, `memory`, `disk`, and `frp-status` through the same hostctl path.
3. Correlate timestamps and distinguish confirmed failures from warnings.
4. Report the observed state and a minimal operator action when a write operation is required.

Never bypass hostctl, invoke SSH directly, read Palworld save files, expose credentials, or claim a restart occurred. Host changes are outside this skill.
