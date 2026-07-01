# Contributing to gcp-speed-test

Thanks for your interest in improving gcp-speed-test! This project is public,
but it runs with a **security-first, review-required** workflow. Please read
this guide before opening a pull request.

## Golden rules

1. **`main` is protected — never commit to it directly.** Every change lands
   through a reviewed pull request. Direct pushes and force-pushes to `main`
   are blocked for everyone.
2. **All changes require review.** A pull request can only be merged after it
   passes all required status checks **and** is approved by a code owner
   (see [`.github/CODEOWNERS`](.github/CODEOWNERS)). Public pull requests are
   reviewed, not auto-accepted.
3. **Tests and coverage are mandatory.** New or changed behaviour must be
   covered by tests, and overall coverage must stay at or above the configured
   thresholds. A PR that drops coverage below the thresholds will fail CI and
   cannot be merged.

## Development setup

```bash
cd ui
npm install
npm start        # dev server at http://localhost:4200
```

Useful commands (run from `ui/`):

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint (must pass) |
| `npm test` | Run the unit tests (Vitest) |
| `npm run test:ci` | Run tests **with coverage + enforced thresholds** |
| `npm run format` | Apply Prettier formatting |
| `npm run build` | Production SSR build |

## Pull request workflow

1. Create a feature branch from `main` (e.g. `feat/region-sorting`,
   `fix/latency-timeout`).
2. Make your change. Keep it focused and small.
3. Add or update tests for every module you touch.
4. Run the full local gate and make sure it is green:
   ```bash
   cd ui
   npm run lint
   npm run test:ci   # tests + coverage thresholds
   npm run build
   ```
5. Commit with a sign-off (required): `git commit -s -m "..."`.
6. Push your branch and open a pull request against `main`. Fill in the PR
   template.
7. Wait for CI to pass and for a code-owner review. Address feedback.
8. A maintainer merges via **squash merge** once everything is green and
   approved. The branch is deleted automatically.

## Coverage requirement

CI runs `npm run test:ci`, which enforces the coverage thresholds configured in
`ui/angular.json` (`test` target → `ci` configuration → `coverageThresholds`).

- If your change adds code, add tests so coverage does not fall below the
  thresholds.
- Do not lower the thresholds to make a PR pass. Raising them (with the tests
  to back it up) is welcome.

## Code style

- Angular: standalone components, `inject()` DI, signals, `OnPush`.
- SSR-safe: guard browser-only APIs with `isPlatformBrowser`.
- Prettier: no semicolons, single quotes, no trailing commas, 100-char width.
  Run `npm run format` — do not hand-format.

## Security

Never commit secrets, credentials, or personal information. Secret scanning and
push protection are enabled and will block such pushes. To report a
vulnerability, follow [SECURITY.md](SECURITY.md).
