# PocketCodex CloudCLI integration

This directory builds an AGPL-3.0-or-later CloudCLI derivative for the Agent workspace.
`upstream-27eaf0146a46.tar.gz` is a `git archive` of the pinned upstream commit. The Docker build
verifies its SHA-256 before applying the ordered local patches. CloudCLI remains a separate service
and is not copied into PocketCodex's MIT runtime source.

Runtime rules:

- PocketCodex authenticates all HTTP and WebSocket traffic.
- CloudCLI runs in platform mode and has no published host port.
- Codex reads the CC Switch managed `/home/node/.codex` configuration.
- `sub2api_local` is mandatory; startup fails closed for any other provider or base URL.
- Only registered paths below `/workspaces` may be used by Codex or the terminal.
- Project creation is restricted to `/workspaces/ssd` and `/workspaces/disk`.
- Only one Codex task can run at a time; the container is limited to 2 CPU and 2 GB RAM.
- Plugins, browser automation, self-update, and client-selected `danger-full-access` are disabled.
- The Agent UI uses local system font fallbacks and makes no Google Fonts or other decorative
  external-resource requests.
- Docker's default seccomp profile blocks the user namespace that Codex normally uses for its
  `workspace-write` bubblewrap sandbox. PocketCodex does not relax seccomp or add capabilities.
  Instead, `pocket-codex-landlock` validates the single `/workspaces/ssd` or `/workspaces/disk`
  project selected by the server, installs a Linux Landlock allowlist, and only then replaces the
  inner SDK sandbox argument. The current project and Codex state are writable; system files and
  Codex configuration are read-only; other projects and `/home/node/.cloudcli` are inaccessible.
- `auth.json`, `config.toml`, and both Skills mounts are read-only submounts inside the otherwise
  persistent Codex state mount. The wrapper fails closed if Landlock is unavailable, `--cd` is
  missing or outside the workspace roots, or an additional directory is requested.
- The UI is served below `/agent/`; its API and WebSocket routes are reachable only through the
  authenticated PocketCodex reverse proxy.
- Platform mode creates one synthetic internal user. CloudCLI login, provider login, and its
  seven-day JWT session are not exposed to the browser.
- The default model is `gpt-5.6-sol` with `high` reasoning. Models found in the current Codex
  `config.toml` are added to the selector so future Sub2API models do not require a UI rebuild.
- Agent model and reasoning selections are persisted per session in
  `/home/node/.cloudcli/pocket-session-preferences.json` and restored when the session is reopened.
- The persistent database is mounted at `/home/node/.cloudcli`; workspace roots and Codex skills
  are separate mounts. Skills are exposed read-only at both Codex's runtime path and CloudCLI's
  discovery path. The database and session preferences are both covered by the
  `data/cloudcli` backup.

The build pins upstream commit `27eaf0146a46aa8a55178f3d394360ff7465420f` and applies the
patches in lexical order. Regenerate the archive only with:

```bash
git -C /path/to/claudecodeui archive --format=tar.gz \
  --output=upstream-27eaf0146a46.tar.gz 27eaf0146a46aa8a55178f3d394360ff7465420f
```

This derivative remains covered by AGPL-3.0-or-later. Keep the archive, patches, this README, and
the upstream reference available with every deployed version.

`04-dependencies.patch` contains non-major lockfile updates produced by
`npm audit fix --omit=dev` against the official npm registry. The production audit is currently
0 critical, 0 high, and 10 moderate. The remaining advisories are in the disabled nut-js/Jimp
browser automation chain and PrismJS/react-syntax-highlighter, whose available fix is a major
upgrade. Re-run typecheck, build, visual tests, and the production audit before changing either.

Upstream: https://github.com/siteboon/claudecodeui
