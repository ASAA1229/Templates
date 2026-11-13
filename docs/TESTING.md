# Testing and Quality Assurance

**Date:** 2026-11-13  
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


## 2026-11-13 — test harness change awaiting verification

The template batch review helper was changed to use Playwright's shared API request context rather than executing fetch inside the page. This preserves the browser context's authentication state while avoiding a page-origin fetch dependency. The change is a hypothesis-driven hardening step; it is not considered fixed until the browser suite is rerun and the template batch review passes. The blueprint selection assertion failure remains open. No post-change CI result was available at the time of this update.


## Latest candidate validation status — 2026-11-13

The hardened candidate is 7268eae2ace8d037c1797a4a306b3968ad9d3a42. GitHub Actions CI run #731 (43419462644) is pending and has not exposed job results yet. Do not call it a pass. The last completed evidence remains run #705 with 19 passed and 3 failed browser tests.
