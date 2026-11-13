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


## 7.1 Employee access request flow

The public UI exposes `/request-access` and `/activate`.

- A visitor submits a work email, name and optional reason. The API applies in-memory per-IP and per-email rate limits and returns a generic response to avoid account enumeration.
- Owner/Admin reviews pending requests under `/access-requests`. Administrators may approve employee/developer/tester roles but only the Owner may approve an ADMIN role.
- Approval creates a one-time activation URL that is shown once to the reviewer for secure manual delivery. The URL expires after 24 hours; no email provider is configured by default.
- The activation token is stored as a SHA-256 hash and consumed atomically. The employee chooses their own password and then signs in.
- API routes: `POST /api/auth/access-requests`, `GET /api/auth/access-requests`, `POST /api/auth/access-requests/:id/approve`, `POST /api/auth/access-requests/:id/reject`, and `POST /api/auth/access-requests/activate`.
- Apply the committed Prisma migration before using these routes. The flow is not a substitute for password recovery, MFA or project-level authorization.

## 7.3 Password recovery

- Owner/Admin issues a reset link from Team Members; the API returns the raw token only in that one response for manual secure delivery.
- Only a SHA-256 token hash is stored. A new issuance invalidates prior outstanding links; links expire after 30 minutes.
- Consumption is rate-limited and atomic; successful reset updates the password timestamp, revokes every active session and invalidates other reset links.
- The reset UI is public only for possession of the token. No email delivery provider is configured; the administrator must verify the recipient and use a secure out-of-band channel.
- Test invalid, expired, reused, superseded and concurrent tokens; test privileged account issuance policy and session revocation.

## 7.2 Project sharing and resource authorization

Project membership is stored in `ProjectMember` and is separate from organization account roles.

- The project owner retains full control and is the only principal who can add, change or revoke project membership.
- `VIEWER` can read a shared project and its requirements, generation record and workspace overview. Mutations must be denied server-side.
- `EDITOR` can update project metadata, requirements and workspace/environment configuration, subject to the member's organization-level permissions.
- A project owner can share with an existing active team account by email. Sharing does not create accounts or bypass employee onboarding.
- Membership is checked on each API request; revocation therefore takes effect without waiting for a session refresh.
- Project lists, search and dashboard metrics must include only owned or explicitly shared projects. Search filters must combine membership scope and text filters with logical AND; never overwrite one OR clause with another.
- Keep destructive/administrative actions owner-only unless a future approved policy explicitly delegates them.
- New project-linked endpoints must use the centralized access helper and add direct-API tests for owner, editor, viewer, revoked member and unrelated account. Do not rely on hidden UI controls as authorization.

The current implementation adds a Prisma migration and project sharing UI/API. Full endpoint-by-endpoint isolation and CI/E2E verification remain release gates.

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


## 10. Current verification authority — 2026-11-13

Use [PROJECT_STATUS.md](PROJECT_STATUS.md) as the single source for maturity scores, implementation/test states, evidence, gaps and release readiness. The current observed PR CI run #705 failed in Playwright (19 passed, 3 failed); see [TESTING.md](TESTING.md). Do not infer that a feature is accepted from its source code or local development command alone.


## Current branch verification checkpoint — 2026-11-13

PR #1 candidate is `15fdfe1b016d2f7997008dc68701b99e4220ce26` on `new`, targeting `dev`; it is open and unmerged. CI #738 (`43419669158`) was in progress at last inspection. Do not treat partial workflow steps as validation success. Current evidence and release decision are in [PROJECT_STATUS.md](PROJECT_STATUS.md).
