# Project Status — ASAA Templates

**Date:** 2026-11-14  
**Authoritative status and gap register:** this document  
**Assessment branch:** new  
**PR:** [#1 — new to dev](https://github.com/ASAA1229/Templates/pull/1) (open, not merged)  
**Release decision:** NO-GO (external gates remain; see "External dependencies")  
**Operating-cost ceiling:** ₹0 unless owner-authorized

## Product boundary

ASAA Templates is a private internal ASAA engineering platform for authorized management and employees to discover, govern, configure and generate reusable software templates and engineering assets. Public marketplace, external organizations, client deployment, paid services and external publishing are outside current authorization. JARVIS remains a separate product.

## Evidence rules

Statuses below are backed by commands run locally on Windows 11, Node 24.16.0, PostgreSQL 18 (local cluster), Microsoft Edge for Playwright. "CI VERIFIED" is not claimed: the GitHub CLI in the engineering environment was not authenticated, so no GitHub Actions run for the new commits could be observed. The CI workflow itself is read-only (`contents: read`) and now also runs the template certification step.

## Verification results (initial vs final)

| Stage | Command | Initial (2026-11-13 baseline) | Final (2026-11-14) |
|---|---|---|---|
| Format | `npm run format:check` | pass | pass |
| Lint | `npm run lint` | pass | pass |
| Typecheck | `npm run typecheck` | pass | pass |
| Contracts unit tests | `npm run test -w @asaa/contracts` | 25 passed | 25 passed |
| API unit/integration tests | `npm run test -w @asaa/api` | 138 passed, 1 skipped (12 files) after migrating the test DB; 83 failed on an unmigrated test database | 279 passed, 1 skipped (25 files) |
| Web unit tests | `npm run test -w @asaa/web` | 22 passed | 22 passed |
| Build | `npm run build` | pass | pass |
| Smoke | `npm run smoke` | 6/6 | 7/7 (readiness check added) |
| E2E + accessibility (Playwright) | `npm run test:e2e` | 16 passed, 6 failed locally (CI #705: 19 passed, 3 failed) | 27 passed, 0 failed (desktop, desktop-dark, mobile) |
| Template certification | `npm run certify:templates -w @asaa/api` | not available | 29/29 certified |
| Dependency audit | `npm run audit:deps` | passed in CI #705 | not re-run locally (needs registry access) |

### The three originally failing browser tests

| Test | Root cause | Fix | Final |
|---|---|---|---|
| `generation.spec.ts` blueprint selection (desktop and desktop-dark) | `humanize()` left hyphens, so the blueprint showed "Backend-service" while the test (and good UI copy) expect "Backend service" | `apps/web/src/lib/utils.ts` replaces hyphens and underscores | PASS |
| `template-batch.spec.ts` 25-template browser review, "Failed to fetch" | After navigating the same page to `file://` demos, API URLs were resolved against `page.url()` (a `file:` origin) | App origin captured while still on the app; API calls use that origin | PASS |
| (revealed by the previous fix) 25-demo render review | Demo templates had real defects: `body.booking` collided with the booking section (horizontal overflow at 1366px in 4 packages) and small accent text failed WCAG colour contrast in 20 packages | Template CSS fixed; batch review now reports every violation instead of stopping at the first | PASS |

Other local-only E2E failures were caused by the 30 s default timeout on slow disks (Git and cold dev server); the Playwright timeout is now 90 s.

## Maturity re-score

Scores are engineering assessments from the evidence above, not measured performance metrics.

| Dimension | Baseline /10 | Now /10 | Evidence |
|---|---:|---:|---|
| Architecture and maintainability | 7.0 | 7.5 | New isolated modules (certification, execution, export, integrations, resolver, release ledger) behind existing boundaries; DB-level immutability. |
| Requirements and documentation | 6.5 | 7.5 | Docs reconciled with code; duplicated sections removed; every gap has evidence or an explicit external dependency. |
| Implementation completeness | 6.0 | 8.0 | RG-01 to RG-15 implemented locally; remaining items are external or human review. |
| Unit, integration, API, UI and E2E testing | 6.0 | 8.5 | API 279 tests in 25 files, contracts 25, web 22, E2E 27 including the axe sweep; baseline was 138 + 25 + 22 and 19/22 E2E. |
| Security and privacy | 5.5 | 7.5 | Role matrix and lifecycle suites, MFA, authorization-before-validation, immutable releases, safe export; no OS-level sandbox or external review. |
| Performance and scalability | 4.5 | 4.5 | No load, capacity or latency evidence yet; unchanged. |
| Accessibility and compatibility | 5.0 | 7.0 | axe sweep over every route (light, dark, mobile layout) and all 25 demos; manual screen-reader review not done. |
| CI/CD and DevOps | 5.0 | 6.5 | Read-only workflow, certification gate and report; no observed GitHub run for the new commits. |
| Deployment and infrastructure | 3.0 | 3.5 | Readiness probe added; no approved topology or deployment. |
| Monitoring, backup and disaster recovery | 3.5 | 6.0 | Verified backup, checksum verification and isolated restore-check with a local round-trip test; no alerting, no approved RPO/RTO. |
| Release readiness and operational support | 3.0 | 5.0 | Gates mostly closed locally; owner sign-off, topology and live integrations outstanding. |

**Overall provisional project maturity: 6.5/10** (arithmetic mean 6.5; baseline 5.0). Separate from the ASAA organization-level score; do not compare without a common rubric.

## Status vocabulary

PLANNED, NOT STARTED, IN DEVELOPMENT, IMPLEMENTED, NEEDS TESTING, TEST FAILED, TEST PASSED, CI VERIFIED, DEVICE VERIFIED, OWNER ACCEPTANCE PENDING, ACCEPTED.

Gap-closure labels used in the register: COMPLETE AND VERIFIED (locally tested), IMPLEMENTED — NOT FULLY TESTED, PARTIALLY COMPLETE, BLOCKED BY EXTERNAL DEPENDENCY, NOT IMPLEMENTED.

## Gap register

| ID | Priority | Status | Evidence |
|---|---|---|---|
| RG-01 Authorization isolation | P0 | COMPLETE AND VERIFIED (locally tested) | `test/authorization-matrix.test.ts`: route inventory plus owner/editor/viewer/unrelated employee/unrelated admin/platform OWNER/suspended/revoked across 35 project endpoints, list/search/dashboard leakage and saved-search ownership. Defect fixed: request bodies were validated before project access, so callers without access saw validation behaviour; access is now resolved first. No asynchronous jobs exist (generation is synchronous). Accepted design: OWNER/ADMIN read the global audit log. |
| RG-02 Authentication lifecycle | P0 | COMPLETE AND VERIFIED (locally tested) | `test/auth-lifecycle.test.ts` (activation/reset expiry, single use, races, rate limits, generic errors, privileged restrictions, password change and reset revoke sessions), `test/mfa.test.ts` (TOTP RFC vector, encrypted secrets, challenge, replay, single-use recovery codes, reset, policy). Gap fixed: activation endpoint had no rate limit. MFA decision recorded in SECURITY.md. |
| RG-03 CI reliability | P0 | COMPLETE AND VERIFIED (locally tested); GitHub run not observed | Workflow is `contents: read` with no push step; local E2E green (27 passed, 0 failed (desktop, desktop-dark, mobile)). |
| RG-04 Template certification | P0 | COMPLETE AND VERIFIED (locally tested) | `npm run certify:templates`: 29/29 packages (25 demos, landing page, 3 starters) pass manifest, license, provenance, pinned dependencies, secret scan, deterministic dry-run, static HTML quality and digest lock; wired into CI with a report artifact; negative tests prove tampering, credentials, unpinned dependencies and missing provenance fail. Starter manifests were missing declared dependencies (fixed). Maintainer sign-off remains a human step. |
| RG-05 Blueprint/generator | P0 | COMPLETE AND VERIFIED (locally tested) | Versioned manifest and blueprint schema (`schemaVersion`), typed inputs, adapter capability checks, preview, disk and verify digests identical, byte-identical repeat renders (`test/template-lifecycle.test.ts`). |
| RG-06 Template lifecycle | P0 | PARTIALLY COMPLETE | API complete and verified: draft, review, approval (separate person unless OWNER), immutable release (database trigger), deprecation, version pinning (`templateVersion`), certification gate; metadata of released catalog items immutable. No browser UI for the release lifecycle yet. |
| RG-07 Isolated execution | P0 | PARTIALLY COMPLETE | `src/execution/worker.ts` with 13 real-process tests (timeout, tree kill, output/memory/disk caps, cancel, secret scrubbing, cleanup, concurrency). Honest limits: no network or syscall sandbox, POSIX path untested, not yet exposed as a product build/test job API. |
| RG-08 ZIP/Git hand-off | P0 | PARTIALLY COMPLETE | ZIP export complete and verified (deterministic, manifest, provenance, SHA-256, zip-slip, symlink refusal, authorization, audit; UI button). Approved remote Git provisioning needs credentials and an authorized destination (external). |
| RG-09 Accessibility | P0 | PARTIALLY COMPLETE | axe WCAG 2.2 A/AA sweep over all public and authenticated routes, form-error states, 25 demos, keyboard checks; violations fixed. Manual screen-reader review not performed. |
| RG-10 Operational release | P0 | BLOCKED BY EXTERNAL DEPENDENCY | `scripts/db-backup.mjs` (backup, verify, restore-check) with a local round-trip test is implemented. Approved zero-cost topology, operational owner, RPO/RTO and owner sign-off are owner decisions. |
| RG-11 Online workspace | P1 | COMPLETE AND VERIFIED (locally tested) | File tree, safe read/write with hash-based conflict detection, diff, history, commit detail, commit on work branches only; UI panel; API suite (`workspace-files.test.ts`), E2E edit and conflict journey, matrix coverage. IDE hand-off is the ZIP export. |
| RG-12 Connectors | P1 | BLOCKED BY EXTERNAL DEPENDENCY | Contract, guarded manager (scope, approval, revocation, redaction, audit), Jenkins and Nexus HTTP adapters and mocks, tested against local protocol fakes (`connectors.test.ts`). Live validation needs authorized endpoints and credentials. |
| RG-13 Reusable assets | P1 | COMPLETE AND VERIFIED (locally tested) | Semver ranges, version resolution, conflicts, cycles, license policy, trust and lifecycle checks, bounded graphs; `POST /api/catalog/resolve` (23 tests). |
| RG-14 Delivery operations | P1 | PARTIALLY COMPLETE | Readiness probe, backup and restore verification, safe template updates with backups (US-E05). Artifact promotion, deployment verification, rollback rehearsal and alerting need a target environment (external). |
| RG-15 Coverage expansion | P1 | PARTIALLY COMPLETE | All 29 packages certified; breadth unchanged by design (expand by demand, certify each). |

P2 deferred: advanced collaboration, notifications, semantic search/command orchestration, advanced BI, configurable workflows/forms, optional company-safe AI/JARVIS, offline/native clients, multi-organization tenancy and business operations. Public marketplace and paid services remain outside authorization.

## External dependencies (what is still needed)

1. Owner decisions: target environment and zero-cost topology, operational owner, RPO/RTO, MFA policy switch (`REQUIRE_MFA_PRIVILEGED=true`) and release sign-off.
2. Jenkins: base URL, a scoped service account token, an allow-listed job list. Nexus: base URL, scoped credentials, repository names. See OPERATIONS.md for the exact configuration.
3. A GitHub Actions run on the exact candidate SHA (authenticate `gh` or open the PR checks page).
4. Manual screen-reader and keyboard review by a human tester.
5. Remote Git hand-off: destination repository and scoped token.

## Security findings (2026-11-14 review)

| Finding | Severity | Status |
|---|---|---|
| Request bodies validated before project authorization (requirements, workspace, project update, submissions, generation retry) | Low (no data exposure; validation oracle) | Fixed, covered by matrix |
| Activation endpoint without rate limit | Medium | Fixed |
| Template release rows mutable; re-approval overwrote catalog digest | Medium | Fixed (ledger, trigger, 409 on changed content) |
| Catalog metadata (version, license, dependencies) editable after release | Low | Fixed |
| No MFA | Medium | Implemented (TOTP, recovery codes, policy flag) |
| Global audit log readable by ADMIN (all projects) | Info | Accepted governance behaviour |
| Execution worker has no network/syscall isolation | High if exposed to untrusted code | Open: do not wire to untrusted builds without a container or VM boundary |
| In-memory rate limiters reset on restart and do not span instances | Low | Open (single-instance deployment assumed) |

## Delivery order (unchanged)

1. RG-01/RG-02 access and identity. 2. RG-03 CI. 3. RG-04/05/06 certification, blueprint, lifecycle. 4. RG-07 execution. 5. RG-08 export. 6. RG-09/RG-10 accessibility and operations. 7. P1.

## Change/evidence log

### 2026-11-13 — baseline and CI hardening
Initial assessment of README, requirements, stories, architecture, security, development, operations, CI workflow, Prisma schema and representative modules. CI run #705 (merge candidate 886c8aaa37add14ea53ceb1e85d7ca92532f4f07, PR head b34c0a250be539833f8f927cc92b3fd1795ee31d): dependency audit, migrations, format, lint, typecheck, tests, build and smoke passed; Playwright 19 passed, 3 failed. The workflow was reduced from `contents: write` to `contents: read` and the formatter-and-push step removed; the template-batch helper was moved to Playwright's request context (insufficient: the real cause was the `file:` origin). Later commits on `new` (15fdfe1b016d2f7997008dc68701b99e4220ce26, CI #738) were documentation-only after that point; no completed result for them was observed.

### 2026-11-14 — implementation of the gap register
Reproduced the baseline locally, fixed the three browser failures at their root causes, and implemented RG-01 to RG-15 locally as described in the register. 14 logical commits on `new` (see `git log ba7918b..HEAD`). Documentation reconciled in this change; duplicated checkpoint sections in the other documents were consolidated here.

## Release decision

**NO-GO** until the external items above are closed: owner approval and topology (RG-10), live Jenkins/Nexus validation (RG-12), manual accessibility review (RG-09), a green GitHub run on the exact candidate SHA, and owner release sign-off. A passing build, source presence, merged PR or documentation update alone is insufficient.
