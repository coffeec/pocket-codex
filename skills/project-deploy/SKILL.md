---
name: project-deploy
description: Validate, build, and prepare deployment changes for the currently registered PocketCodex project. Use for release checks, build failures, deployment manifests, or project-scoped rollout instructions.
---

# Project Deploy

1. Verify the working directory and inspect repository status before editing.
2. Read the project's own deployment documentation and existing scripts.
3. Run the narrowest relevant tests, then the documented build or validation command.
4. Review the diff and check for secrets, destructive steps, and unintended files.
5. Execute deployment only when the requested project exposes an in-project authorized mechanism; otherwise give the exact remaining operator step.

Operate only inside the registered project. Never use hostctl to deploy, access Docker Socket, mount host paths, alter host services, or read credentials outside the project.
