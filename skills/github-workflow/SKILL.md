---
name: github-workflow
description: Inspect Git state, review diffs, run tests, create focused commits, and push the currently registered project to its configured GitHub remote. Use for repository status, commit, push, branch, or GitHub delivery tasks.
---

# GitHub Workflow

1. Run `git status --short --branch` and inspect the configured remote without printing credential-bearing URLs.
2. Preserve pre-existing user changes and keep the commit focused.
3. Run relevant tests and inspect the staged diff before committing.
4. Use a concise commit message that describes behavior.
5. Push only when requested and report the branch and commit hash.

Stay inside the registered project. Never rewrite history, discard changes, modify Git credentials, print tokens, access another project, or bypass hostctl and container restrictions.
