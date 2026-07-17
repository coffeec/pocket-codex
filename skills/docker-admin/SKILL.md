---
name: docker-admin
description: Review and improve Dockerfiles, Compose files, container limits, health checks, and deployment configuration inside the currently registered project. Use for project Docker configuration work where no Docker daemon access is available.
---

# Docker Admin

1. Confirm the current working directory is the registered project root.
2. Inspect existing Docker and Compose files before editing.
3. Preserve secret injection, non-root users, resource limits, health checks, and least privilege.
4. Run static validation or project tests available without a Docker daemon.
5. Show the resulting diff and clearly state when an actual image build was not possible.

Never access a sibling project, Docker Socket, host Docker CLI, hostctl bypass, or embedded credentials. Do not weaken capabilities, mounts, ports, or authentication to make a build pass.
