# Testing and Quality Assurance

**Date:** 2026-11-14 (originally 2026-11-13; dated sections below preserved)  
**Authoritative status:** [PROJECT_STATUS.md](PROJECT_STATUS.md)  
**Local commands/setup:** [DEVELOPMENT.md](DEVELOPMENT.md)

## Policy

A test is evidence only when suite/command, environment, commit SHA, result and report are recorded. Code presence, a configured script or a green build does not establish acceptance.

Use the status vocabulary in PROJECT_STATUS.md: PLANNED, NOT STARTED, IN DEVELOPMENT, IMPLEMENTED, NEEDS TESTING, TEST FAILED, TEST PASSED, CI VERIFIED, DEVICE VERIFIED, OWNER ACCEPTANCE PENDING and ACCEPTED.

## Test layers

| Layer | Current mechanism | Required coverage |
|---|---|---|
| Unit | Vitest in API, web and contracts | Domain rules, schemas, policies, components |
| Integration/API | Vitest, Prisma and Supertest | Database, transactions, routes, authn/authz and negative paths |
| Build/type | TypeScript and workspace builds | Contracts, API and web |
| Smoke | npm run smoke | Built app, DB health, SPA fallback, anonymous API denial and selected headers |
| Browser E2E | Playwright | Owner/employee journeys, sharing, catalog, blueprint, generation, review and export |
| Accessibility | axe/Playwright and manual review | WCAG 2.2 AA target, keyboard, focus, labels, semantics, contrast and screen reader |
| Security | Negative tests and manual review | IDOR, privilege escalation, CSRF/origin, sessions, secrets, path safety and isolation |
| Performance | No completed evidence found | Load, latency, throughput, resource use, concurrency and capacity |
| Recovery | Operator procedures documented | Isolated restore, integrity, rollback and recovery timing |

## Reproducible commands

From repository root, use the Node/npm versions in DEVELOPMENT.md and an isolated local PostgreSQL database:

- npm ci
- npm run db:deploy
- npm run format:check
- npm run lint
- npm run typecheck
- npm run test
- npm run build
- npm run validate
- npm run smoke
- npm run test:e2e
- npm run audit:deps

Install Playwright Chromium as documented in DEVELOPMENT.md. Never run destructive suites against production or valuable user data.

## Observed CI evidence — 2026-11-13

- Workflow: GitHub Actions CI.
- Run: [43417094364 — run #705](https://github.com/ASAA1229/Templates/actions/runs/43417094364).
- PR head: b34c0a250be539833f8f927cc92b3fd1795ee31d.
- Merge candidate tested: 886c8aaa37add14ea53ceb1e85d7ca92532f4f07.
- Overall conclusion: FAILURE.
- Passed: npm ci, dependency audit, database migrations, format/lint/typecheck/unit+integration/build, smoke, browser installation and report upload.
- Failed: Playwright E2E/accessibility stage.
- Result: 19 passed, 3 failed.
- Failure: apps/web/e2e/generation.spec.ts:74 expected Backend service in Selected project blueprint; element not found.
- Failure: apps/web/e2e/template-batch.spec.ts:29 browser review of 25 demos failed with TypeError: Failed to fetch.
- Blueprint assertion failed in desktop and desktop-dark projects.

The report artifact was uploaded by the workflow and is retained only for a limited period. This run is not CI VERIFIED.

## Immediate QA sequence

1. Reproduce blueprint selection failure; determine whether product UI, test fixture or expected label is wrong.
2. Reproduce template batch fetch failure; inspect browser console/network response and test server routing/static assets. Do not label it flaky without evidence.
3. Re-run browser suite after root-cause fixes.
4. Complete route/resource authorization coverage.
5. Add per-template certification evidence.
6. Complete keyboard/screen-reader/manual accessibility review.
7. Add performance and recovery tests before claiming those dimensions verified.

## Traceability

For each release-blocking story record its gap/story ID, acceptance criterion, test identifier/layer, exact commit SHA/environment, command/procedure, expected/actual result, report artifact, defect/retest, reviewer and owner acceptance. Never mark ACCEPTED based only on source inspection or build success.

## Current evidence — 2026-11-14

Authoritative results and the initial-versus-final comparison are in [PROJECT_STATUS.md](PROJECT_STATUS.md). Local environment: Windows 11, Node 24.16.0, PostgreSQL 18 (local cluster, separate databases for API tests and E2E), Microsoft Edge for Playwright. GitHub Actions results for the new commits were not observable (the `gh` CLI was not authenticated).

### Suites added

| Suite | Layer | Covers |
|---|---|---|
| `authorization-matrix.test.ts` | API security | RG-01 role matrix, route inventory, leakage |
| `auth-lifecycle.test.ts`, `mfa.test.ts` | API security | RG-02 activation/reset/password/MFA |
| `certification.test.ts` | Integration | RG-04 certification checker, lock, negative cases |
| `template-lifecycle.test.ts` | API | RG-05 reproducibility and RG-06 release lifecycle |
| `template-update.test.ts` | API | US-E05 three-way update plan and apply |
| `export.test.ts` | API | RG-08 ZIP writer/reader, export authorization |
| `workspace-files.test.ts` | API | RG-11 files, diff, history, commit |
| `asset-resolution.test.ts` | Unit and API | RG-13 resolver |
| `connectors.test.ts` | Unit and protocol | RG-12 manager and HTTP adapters against fake servers |
| `execution.test.ts` | Process | RG-07 limits, cancel, cleanup |
| `backup-restore.test.ts`, `health.test.ts` | Integration | RG-10/RG-14 |
| `accessibility.spec.ts` (Playwright) | Accessibility | RG-09 axe sweep of every route, states and keyboard |
| `template-batch.spec.ts` (Playwright) | E2E | all 25 demos at desktop and mobile widths: render, overflow and axe, reported together |

Added in the delta increment: `execution-jobs.test.ts` (job API, container command construction and fallback with a fake docker), `rate-limit.test.ts` (shared limiter, atomicity, cross-instance sign-in lockout), Playwright `zz-release-lifecycle.spec.ts` (release lifecycle UI with two people) and `reflow.spec.ts` (320 px reflow, 200% text, focus, reduced motion, forced colors). `npm run perf:baseline` produces the load numbers.

### Notes for maintainers

- The API suites share one PostgreSQL test database and run serially. Create it with `npm run db:local -- init` and apply migrations to **both** databases (`DATABASE_URL` and `TEST_DATABASE_URL`) with `prisma migrate deploy`; an unmigrated test database fails dozens of tests at once.
- Run E2E against a database that API tests are not using (set `TEST_DATABASE_URL`), and do not run `prisma generate` while an E2E API server is running on Windows (the query-engine DLL is locked).
- Remaining human steps: manual screen-reader review, a performance/load baseline, and live connector tests.

### Independent rerun note — 2026-11-14

The coordinator's rerun of `npm run validate` stopped at the API typecheck with a Windows `EPERM` on the Prisma engine DLL rename (a file lock from a concurrent process; it is the same hazard described above for `prisma generate`). That rerun is inconclusive. The agent-reported results (validate, smoke, E2E 27/27) remain local and unreproduced by a second party, and are not CI VERIFIED. Commit `918ffa0` hardened slow-machine behaviour (temp-directory cleanup retry, longer backup drill timeout).


## Update 2026-11-15

Commit d3dcadb adjusts test timeouts and removes a flake in the job authorization test. Full-suite verification by the coordinator and a CI run are deferred to the test phase; current results remain agent-reported.
