# Development Guide

## 1. Prerequisites

- Node.js 24.16.0 (repository `.nvmrc`; package engine range is Node >=24 and <25).
- npm 11 or newer.
- Git.
- PostgreSQL server utilities `initdb`, `pg_ctl` and `psql` on `PATH` when using the bundled local database helper.

Install the exact Node version using the version manager available in your environment, then verify:

```bash
node --version
npm --version
git --version
```

## 2. Install dependencies

Run from the repository root:

```bash
npm ci
```

This installs the locked npm workspaces: `packages/contracts`, `apps/api` and `apps/web`.

## 3. Initialize PostgreSQL for local development

Recommended zero-cost local setup:

```bash
npm run db:local -- init
```

The helper uses locally installed PostgreSQL binaries. It creates a cluster in `.local/pgdata`, listens on `127.0.0.1` only (default port 54329), creates `templates_dev` and `templates_test`, generates a local password under `.local/` and creates `apps/api/.env` from the example. It does not require Docker or a hosted database.

Other commands:

```bash
npm run db:local -- status
npm run db:local -- start
npm run db:local -- stop
```

To use an existing PostgreSQL instance instead, copy `apps/api/.env.example` to `apps/api/.env` and configure `DATABASE_URL` and `TEST_DATABASE_URL`. Keep credentials local and never commit the resulting file.

## 4. Apply migrations and initialize the owner

```bash
npm run db:deploy
npm run owner:init -w @asaa/api
```

The owner CLI prompts for bootstrap credentials. Follow the CLI's prompts; do not store passwords in source files, issue descriptions, logs or shell history.

Useful database commands:

```bash
npm run db:deploy
npm run db:status -w @asaa/api
npm run db:migrate -w @asaa/api
```

Use `db:migrate` for intentional local schema development. Review generated migration SQL before committing it. Use `db:deploy` to apply committed migrations to a target database.

## 5. Run the application

```bash
npm run dev
```

- Web UI: http://127.0.0.1:5000
- API: http://127.0.0.1:4000
- Health endpoint: http://127.0.0.1:4000/api/health

Vite proxies `/api` requests to the API. The web server binds to loopback by default. Port overrides: `WEB_PORT` and `API_PROXY_TARGET` for Vite; `PORT` and `WEB_ORIGIN` for the API.

## 6. Environment configuration

The API validates configuration at startup. The main variables in `apps/api/.env.example` are:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | development, test, staging or production |
| `PORT` | API listen port (default 4000) |
| `WEB_ORIGIN` | permitted web origin |
| `DATABASE_URL` | PostgreSQL application database |
| `TEST_DATABASE_URL` | isolated test database connection |
| `SESSION_ABSOLUTE_MINUTES` | absolute session lifetime (default 720) |
| `SESSION_IDLE_MINUTES` | idle session lifetime (default 30) |
| `COOKIE_SECURE` | must be true for staging/production |
| `WEB_DIST_DIR` | optional built SPA directory served by API |
| `LOG_LEVEL` | debug, info, warn, error or silent |
| `TEMPLATE_LIBRARY_DIR` | optional template-library path |
| `GENERATION_OUTPUT_DIR` | generated-project output path, outside platform source/library |
| `GIT_EXECUTABLE`, `GIT_TIMEOUT_MS` | local Git executable and command timeout |

Do not copy production secrets into development or test environments. `apps/api/.env.example` contains placeholders only.

## 7. Quality and verification commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run validate
npm run smoke
```

`npm run validate` runs formatting check, lint, typecheck, workspace tests and production builds. `npm run smoke` checks the built application, database health, SPA fallback, anonymous API denial and selected security headers.

Browser E2E:

```bash
cd apps/web
npx playwright install chromium
cd ../..
npm run test:e2e
```

Run tests against disposable/test data. Never point destructive test suites at production data. Record the exact commit, commands, results and known failures. A successful build or smoke test is not a substitute for full acceptance, security or production-readiness review.

## 8. Repository conventions and branch workflow

Standard branches:
- `main`: production/release baseline; protected; changes only through an approved PR from `dev`.
- `dev`: integration branch.
- `new`: feature/specification work.
- `fix`: defect correction with reproduction and regression test.
- `test`: test-focused work and verification.

Start work from the latest appropriate integration baseline, use descriptive child branches for parallel work, and open a reviewed PR into `dev). After integration and release validation, use a separate approved PR from `dev` to `main`.

Rules:
- Do not force-push shared branches.
- Do not merge to `dev` or `main` without explicit approval and required checks.
- Do not claim checks passed unless the result is available.
- Keep changes scoped, tested and traceable.
- Update the canonical docs only when a meaningful product, architecture, development, operational or security decision changes.

## 9. Contribution and template authoring rules

Before adding a template, verify ownership/license, assign stable ID/family/tags/division, define supported technologies and inputs, record dependencies and compatibility, identify security/privacy/accessibility/compliance concerns, state maturity honestly and assign maintenance responsibility.

Template packages must be self-contained, versioned, manifest-valid and reviewable. Imported assets remain untrusted until provenance, licensing, security and functional checks pass. Pull requests describe purpose, affected areas, migration impact, validation evidence, risks and known gaps. Never include secrets or client-sensitive data.
