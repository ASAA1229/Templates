# Project Status — ASAA Templates

**Date:** 2026-11-14 (delta increment applied)  
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
| Implementation completeness | 6.0 | 8.5 | RG-01 to RG-15 implemented locally; remaining items are external or human review. |
| Unit, integration, API, UI and E2E testing | 6.0 | 8.5 | API 279 tests in 25 files, contracts 25, web 22, E2E 27 including the axe sweep; baseline was 138 + 25 + 22 and 19/22 E2E. |
| Security and privacy | 5.5 | 8.0 | Role matrix and lifecycle suites, MFA, authorization-before-validation, immutable releases, safe export, shared rate limits, labelled job isolation with an optional container boundary; no live container run or external review. |
| Performance and scalability | 4.5 | 5.5 | Reproducible load baseline with recorded latency and throughput and budgets; no capacity or soak testing; preview endpoint is slow. |
| Accessibility and compatibility | 5.0 | 7.5 | axe sweep, 320 px reflow, 200% text, focus, reduced motion, forced colors, 25 demos; manual screen-reader review not done. |
| CI/CD and DevOps | 5.0 | 6.5 | Read-only workflow, certification gate and report; no observed GitHub run for the new commits. |
| Deployment and infrastructure | 3.0 | 3.5 | Readiness probe added; no approved topology or deployment. |
| Monitoring, backup and disaster recovery | 3.5 | 6.0 | Verified backup, checksum verification and isolated restore-check with a local round-trip test; no alerting, no approved RPO/RTO. |
| Release readiness and operational support | 3.0 | 5.0 | Gates mostly closed locally; owner sign-off, topology and live integrations outstanding. |

**Overall provisional project maturity: 6.9/10** (arithmetic mean 6.86; baseline 5.0). Separate from the ASAA organization-level score; do not compare without a common rubric.

## Classification
| Area | Status |
|---|---|
| Product vision and boundaries | Initial draft created |
| Architecture direction | Initial draft created |
| Taxonomy | Initial proposal created |
| Sector directory | Placeholder taxonomy |
| Division directory | Placeholder taxonomy |
| Lifecycle and metadata expectations | Initial proposal |
| Roadmap | Initial proposal |
| Application implementation | IMPLEMENTED locally (RG-01 to RG-15; see gap register); not CI VERIFIED |
| Template catalog and engine | IMPLEMENTED locally; 25 demo packages, 29/29 certified by the local certification command |
| JARVIS integration | Not started (out of current scope) |
| Portfolio integration | Showcase-only concept; not implemented |
| Security/accessibility/quality gates | Implemented and tested locally (role matrix, MFA, axe sweep, reflow); manual screen-reader review and CI evidence pending |

## Next action
Observe a GitHub Actions run on the pushed head, obtain owner decisions on topology, RPO/RTO and live connectors, and complete manual accessibility review. Update this file whenever actual work changes status.


---

## ASAA Master Requirements Baseline v1.0 — 2026-11-14

Approved planning/governance reference for ASAA, Portfolio, JARVIS, Templates and shared ecosystem capabilities. Round 6 (12 consolidation stages) is complete at framework/consolidation level. Individual requirement mapping, reconciliation of the 1,000 discovery answers, repository/runtime evidence, named owners, dependency validation, acceptance criteria, evidence-based gaps and delivery estimates remain pending. Approval does not authorize implementation, testing, deployment, paid services or merges.

See `docs/ASAA_MASTER_REQUIREMENTS_BASELINE.md`, `docs/PROJECT_SCOPE.md` and `docs/EPIC_STATUS.md` for the approved baseline, project scope and epic status register.


## Gap register (RG-01 to RG-15) — 2026-11-14

Source of the gap definitions: REQUIREMENTS.md (release-gap register) and ROADMAP.md. The "Current status" column of that register in REQUIREMENTS.md is the original 2026-11-13 baseline and is preserved; this table is current. "Local" means run on one Windows 11 machine by the code agent; the coordinator's independent rerun was blocked (see below). Nothing is CI VERIFIED.

| ID | Priority | Gap | Status | Evidence / blocker |
|---|---|---|---|---|
| RG-01 | P0 | Access and authorization | COMPLETE AND VERIFIED (locally, agent-reported) | `authorization-matrix.test.ts` role matrix and route inventory |
| RG-02 | P0 | Authentication lifecycle and MFA | COMPLETE AND VERIFIED (locally, agent-reported) | `auth-lifecycle.test.ts`, `mfa.test.ts` (TOTP, recovery codes, reset) |
| RG-03 | P0 | CI and regression baseline | PARTIALLY COMPLETE | Read-only workflow with certification step configured; historical CI run #705 failed; no run observed for new commits |
| RG-04 | P0 | Template certification | COMPLETE AND VERIFIED (locally, agent-reported) | `certify:templates` 29/29 certified; `certification.test.ts` |
| RG-05 | P0 | Blueprint-to-builder contract | COMPLETE AND VERIFIED (locally, agent-reported) | `template-lifecycle.test.ts` reproducibility |
| RG-06 | P0 | Template authoring and release lifecycle | COMPLETE AND VERIFIED (locally, agent-reported) | Immutable releases, version pinning, release lifecycle UI E2E |
| RG-07 | P0 | Isolated build/test execution | PARTIALLY COMPLETE | Worker with limits, tree kill, cleanup tests and job API implemented; optional Docker boundary not exercised against a live container |
| RG-08 | P0 | Project export and hand-off | COMPLETE AND VERIFIED (locally, agent-reported) | Safe ZIP export with manifest and zip-slip protection (`export.test.ts`); remote Git push remains owner-authorized only |
| RG-09 | P0 | Accessibility and usability | PARTIALLY COMPLETE | axe sweep, 320 px reflow, 200% text, focus, forced colors automated; manual screen-reader review not done |
| RG-10 | P0 | Release approval | BLOCKED BY EXTERNAL DEPENDENCY | Needs owner-approved zero-cost topology, RPO/RTO, rollback and incident process and explicit release authorization; local backup/restore-check exists |
| RG-11 | P1 | Online workspace (files, diff, history, conflicts) | COMPLETE AND VERIFIED (locally, agent-reported) | `workspace-files.test.ts` |
| RG-12 | P1 | Governed connectors (Jenkins, Nexus, others) | PARTIALLY COMPLETE | Contracts, guarded manager and HTTP adapters verified against fake servers only; live Jenkins/Nexus need approved endpoints and credentials |
| RG-13 | P1 | Asset dependency, license and version resolution | COMPLETE AND VERIFIED (locally, agent-reported) | `asset-resolution.test.ts` |
| RG-14 | P1 | Delivery operations: backup, readiness, observability | PARTIALLY COMPLETE | Backup/verify/restore-check, readiness endpoint, shared rate limiter, load baseline; no alerting, no approved RPO/RTO, no deployment |
| RG-15 | P1 | Sector and technology coverage | PARTIALLY COMPLETE | 25 packages certified; expansion is demand-driven |

Tally (15): COMPLETE AND VERIFIED (locally) 8 (RG-01, 02, 04, 05, 06, 08, 11, 13); PARTIALLY COMPLETE 6 (RG-03, 07, 09, 12, 14, 15); BLOCKED BY EXTERNAL DEPENDENCY 1 (RG-10); NOT IMPLEMENTED 0.

## Verification caveat — coordinator rerun, 2026-11-14

The coordinator's rerun of `npm run validate` failed at the API typecheck with a Windows `EPERM` on the Prisma query-engine DLL rename (an environment file lock while another process held the engine; being fixed). It is recorded as an inconclusive rerun, not as a product failure and not as a pass. The figures in the verification table above are the code agent's local results; they were not independently reproduced. Latest commit at time of writing: `918ffa0` (test hardening: retry temp-directory cleanup, longer backup drill on loaded Windows machines). No GitHub Actions run has been observed, so nothing is CI VERIFIED. Release decision: NO-GO.

## Delivery phase — 2026-11-15

**Current phase: DEVELOPMENT** (owner direction: DEVELOPMENT, then TESTING, then DEPLOYMENT). Features added in this phase carry the status **IMPLEMENTED — NOT FULLY TESTED** until the testing phase runs. Test-phase and deployment-phase items that are not yet due (full-suite reruns, CI runs, hosted or staging verification, hosting, live providers, production rehearsal) are **deferred to test phase** or **deferred to deployment phase**; they are not failures. Evidence classes used in these documents: coordinator-verified, agent-reported, in progress, CI not observed.

## 2026-11-15 reconciliation (documentation owner)

Head at time of writing: `d3dcadb` (test-only: de-flaked job authorization test, longer `node --test` job timeout, 10 s async query timeout for web tests). The RG-06 release lifecycle UI with version pinning, RG-07 authenticated job API with optional Docker boundary, database-backed shared rate limiter, load baseline and reflow/zoom checks documented above are agent-reported and not yet coordinator-verified (status: IMPLEMENTED — NOT FULLY TESTED until the testing phase). The Environment Snapshot (TMP-E10) is IN DEVELOPMENT with uncommitted work and is not documented as done. The coordinator's `npm run validate` rerun (Windows EPERM) is deferred to the test phase; it is not recorded as a product failure. No GitHub Actions run observed (deferred to test phase). Release decision NO-GO (deployment phase items deferred).
