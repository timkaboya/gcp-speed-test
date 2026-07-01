# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report them privately via GitHub's
[private vulnerability reporting](https://github.com/timkaboya/gcp-speed-test/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). We aim to
acknowledge reports within a few days.

## Supported versions

Only the latest `main` is supported.

## Repository security posture

This is a public repository with a tight security configuration:

- **`main` is protected.** All changes must go through a pull request that
  passes required status checks (lint, tests, coverage, build) and receives
  code-owner approval. Direct pushes and force-pushes to `main` are blocked.
- **No unreviewed external contributions.** Pull requests are never merged
  without maintainer review; public contributions are reviewed, not
  auto-accepted (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **Secret scanning + push protection** are enabled to prevent committing
  credentials.
- **Dependabot** alerts and security updates are enabled.
- The app is **backendless** and stores no user data server-side; latency is
  measured entirely in the visitor's browser.
