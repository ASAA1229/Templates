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
| Application implementation | Not started |
| Template catalog and engine | Not started |
| JARVIS integration | Not started |
| Portfolio integration | Showcase-only concept; not implemented |
| Security/accessibility/quality gates | Requirements drafted; implementation/evidence pending |

## Next action
Review and approve audience, platform targets, template scope, access model, and integration depth before implementation. Update this file whenever actual work changes status.


---

## ASAA Master Requirements Baseline v1.0 — 2026-11-14

Approved planning/governance reference for ASAA, Portfolio, JARVIS, Templates and shared ecosystem capabilities. Round 6 (12 consolidation stages) is complete at framework/consolidation level. Individual requirement mapping, reconciliation of the 1,000 discovery answers, repository/runtime evidence, named owners, dependency validation, acceptance criteria, evidence-based gaps and delivery estimates remain pending. Approval does not authorize implementation, testing, deployment, paid services or merges.

See `docs/ASAA_MASTER_REQUIREMENTS_BASELINE.md`, `docs/PROJECT_SCOPE.md` and `docs/EPIC_STATUS.md` for the approved baseline, project scope and epic status register.