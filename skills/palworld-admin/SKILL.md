---
name: palworld-admin
description: Inspect Palworld service health and recent logs through PocketCodex's restricted hostctl boundary. Use for Palworld status, crash, disconnect, memory, or FRP reachability diagnosis.
---

# Palworld Admin

1. Run `/usr/local/bin/hostctl pal-status` and `/usr/local/bin/hostctl pal-logs 50 60`.
2. For disconnects or lag, also run `status`, `cpu`, `memory`, `disk`, and `frp-status` through the same hostctl path.
3. Correlate timestamps and distinguish confirmed failures from warnings.
4. Report the observed state and a minimal operator action when a write operation is required.

Never bypass hostctl, invoke SSH directly, read Palworld save files, expose credentials, or claim a restart occurred without a server-issued confirmation.
