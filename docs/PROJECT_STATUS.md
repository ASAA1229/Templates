# Project Status — ASAA Templates

**Date:** 2026-11-13  
**Authoritative status and gap register:** this document  
**Assessment branch:** new  
**PR:** [#1 — new to dev](https://github.com/ASAA1229/Templates/pull/1)  
**Release decision:** NO-GO  
**Operating-cost ceiling:** ₹0 unless owner-authorized

## Product boundary

ASAA Templates is a private internal ASAA engineering platform for authorized management and employees to discover, govern, configure and generate reusable software templates and engineering assets. Public marketplace, external organizations, client deployment, paid services and external publishing are outside current authorization. JARVIS remains a separate product.

## Repository and CI evidence

- Five standard branches confirmed: main, dev, new, fix, test.
- PR #1 is open from new to dev and is not merged.
- PR head: b34c0a250be539833f8f927cc92b3fd1795ee31d.
- PR base SHA: 7989af5e858a4221d71183636e0cf5c285d10180.
- CI run #705: [43417094364](https://github.com/ASAA1229/Templates/actions/runs/43417094364), merge candidate 886c8aaa37add14ea53ceb1e85d7ca92532f4f07.
- Dependency audit, migrations, formatting, lint, typecheck, unit/integration tests, build and smoke passed.
- Playwright stage failed: 19 passed, 3 failed. Blueprint selection text was not found; the 25-template browser review failed with TypeError: Failed to fetch.
- CI workflow grants contents: write and has a temporary format-and-push step. Remove the write path after formatting is committed normally.
- No production deployment, Jenkins execution, Nexus operation, restore drill or device verification is evidenced.
- Branch names were confirmed, but complete branch-head/history inventory was not available through the inspection interface. Do not infer branch synchronization.

## Implementation foundations found

React/Vite web app; Express API; PostgreSQL/Prisma; TypeScript/Zod contracts; account roles and session foundations; access requests/activation; hashed, expiring, single-use password reset tokens; projects, requirements, dashboard, search and audit; VIEWER/EDITOR project sharing; private catalog and manifest-driven template library; submission/review; blueprint/generation; local Git/environment workspace; 25 demo packages; GitHub Actions and Playwright.

Code presence is not acceptance. Password reset and activation implementations remain NEEDS TESTING. The 25 packages are not certified merely because they exist.

## Maturity baseline

Scores are provisional engineering assessments based on inspected documentation/source samples and observed CI evidence. They are not measured performance metrics.

| Dimension | Baseline /10 | Evidence |
|---|---:|---|
| Architecture and maintainability | 7.0 | Modular monolith, shared contracts and domain boundaries; full source inventory incomplete. |
| Requirements and documentation | 6.5 | Strong requirements/stories/architecture/security; missing POC, roadmap, authoritative status and QA records; status vocabulary drift. |
| Implementation completeness | 6.0 | Broad foundations; certification, isolation, lifecycle and export incomplete. |
| Unit, integration, API, UI and E2E testing | 6.0 | Unit/integration and smoke passed; 3 browser tests failed; full route coverage unproven. |
| Security and privacy | 5.5 | Hashed tokens, server-side policy and audit foundations; exhaustive isolation, MFA and safe execution open. |
| Performance and scalability | 4.5 | No measured load, capacity, latency or resource-limit evidence. |
| Accessibility and compatibility | 5.0 | Playwright accessibility stage exists; browser failures and no complete WCAG 2.2 AA evidence. |
| CI/CD and DevOps | 5.0 | Pipeline exists; current run fails; excessive workflow write permissions and auto-push behavior. |
| Deployment and infrastructure | 3.0 | Local setup and migrations; no approved production topology or deployment verification. |
| Monitoring, backup and disaster recovery | 3.5 | Structured logs, request IDs and health endpoint; no restore drill, alerting or approved RPO/RTO. |
| Release readiness and operational support | 3.0 | Open PR, failing E2E, uncertified templates and unproven operations. |

**Overall provisional project maturity: 5.0/10 (arithmetic mean of the 11 dimension scores).** Separate from the ASAA organization-level score of 6.2/10; do not compare without a common rubric.

## Status vocabulary

PLANNED, NOT STARTED, IN DEVELOPMENT, IMPLEMENTED, NEEDS TESTING, TEST FAILED, TEST PASSED, CI VERIFIED, DEVICE VERIFIED, OWNER ACCEPTANCE PENDING, ACCEPTED.

## Gap register

| ID | Priority | Current state | Evidence | Required outcome / acceptance | Dependencies | Verification | Status |
|---|---|---|---|---|---|---|---|
| RG-01 Authorization isolation | P0 | Shared access helper and scoped queries exist; full route coverage unproven | Project, requirements, dashboard and search modules | Inventory all routes/jobs; prove OWNER/ADMIN/EDITOR/VIEWER/unrelated/suspended/revoked boundaries; zero IDOR or cross-project leakage | Route/job inventory | Positive/negative API tests and role matrix | NEEDS TESTING |
| RG-02 Authentication lifecycle | P0 | Activation/reset foundations exist; E2E and MFA policy incomplete | Development guide and auth/schema docs | Verify expiry, single use, rate limits, generic responses, privileged restrictions, password change and session revocation; record MFA decision | Owner MFA policy | API/E2E and security review | NEEDS TESTING |
| RG-03 CI reliability | P0 | Browser stage failed; workflow can write/push | CI run #705 and ci.yml | Fix 3 browser failures; make PR validation read-only; green exact candidate SHA | E2E root-cause fixes | New workflow run and permissions review | TEST FAILED |
| RG-04 Template certification | P0 | 25 packages exist; no per-version certification evidence | PR #1 | Manifest, provenance/license, dependencies, secrets, preview, generation, integrity, responsive, accessibility and security checks for each package | Certification criteria | Package test report, checksum and maintainer approval | NOT STARTED |
| RG-05 Blueprint/generator | P0 | Foundations exist | Prisma schema and generation modules | Versioned schema, typed inputs, capability/compatibility checks, preview parity and reproducible output | Schema/adapter inventory | Contract tests and repeat generation comparison | IN DEVELOPMENT |
| RG-06 Template lifecycle | P0 | Submission/review foundations exist | Submission modules and docs | Draft/import/edit/review/approval/immutable release/deprecation and prior-version pinning | RG-04 | API/UI lifecycle and immutability tests | IN DEVELOPMENT |
| RG-07 Isolated execution | P0 | No verified isolated worker | Security/operations docs | Disposable workers; CPU/memory/disk/time/process/network/output limits; filesystem/secret isolation; cancel and cleanup | Threat model and worker design | Isolation, resource exhaustion and cleanup tests | NOT STARTED |
| RG-08 ZIP/Git hand-off | P0 | Local Git foundation; complete export not verified | Requirements and stories | Safe complete ZIP with manifest/provenance/checksum; scoped Git credentials, preview, approval and audit | RG-01 and artifact model | Archive integrity and authorization tests | IN DEVELOPMENT |
| RG-09 Accessibility | P0 | Playwright tooling exists; evidence incomplete | CI run #705 | WCAG 2.2 AA target across critical workflows, keyboard and screen-reader review | Stable E2E workflows | axe plus manual review | NEEDS TESTING |
| RG-10 Operational release | P0 | Local operations documented; no production topology/restore proof | Operations guide | Zero-cost approved topology, operational owner, backup and isolated restore, rollback, incident process and owner sign-off | Owner decision and environment | Restore drill and release checklist | NOT STARTED |
| RG-11 Online workspace | P1 | Local workspace foundations | Requirements/stories | Editor, file tree, diff/history, conflict handling and IDE hand-off | RG-01, RG-07 | UI/API and security tests | IN DEVELOPMENT |
| RG-12 Connectors | P1 | Jenkins/Nexus/production integrations not verified | No live environment evidence | Scoped credentials, capability/version contracts, health, revocation and audit | Credentials and authorized endpoints | Live integration test | PLANNED |
| RG-13 Reusable assets | P1 | Composition incomplete | Requirements/stories | License, dependency, compatibility and version resolution | Catalog lifecycle | Package/integration tests | PLANNED |
| RG-14 Delivery operations | P1 | Basic health/logging and CI exist | Operations guide | Artifact promotion, approvals, deployment verification, rollback, monitoring and tested recovery | RG-10 | Deployment rehearsal and restore drill | IN DEVELOPMENT |
| RG-15 Coverage expansion | P1 | 25 demo packages and taxonomy; certified breadth unproven | PR #1 and catalog registry | Expand by demand; certify every package/version | RG-04, RG-05 | Coverage and certification report | IN DEVELOPMENT |

P2 deferred: advanced collaboration, notifications, semantic search/command orchestration, advanced BI, configurable workflows/forms, optional company-safe AI/JARVIS, offline/native clients, multi-organization tenancy and business operations. Public marketplace and paid services remain outside authorization.

## Delivery order

1. RG-01/RG-02 access and identity.
2. RG-03 CI and browser reliability.
3. RG-04/RG-05/RG-06 template certification, blueprint contract and lifecycle.
4. RG-07 isolated execution.
5. RG-08 safe export and Git hand-off.
6. RG-09/RG-10 accessibility and operational acceptance.
7. P1 after P0 risk closure.

## Change/evidence log

### 2026-11-13 — initial baseline
Inspected README, requirements, stories, architecture, security, development, operations, workspace manifests, CI workflow, Prisma schema and representative project/requirements/dashboard/search API modules. Verified CI run #705. No source implementation was changed in this assessment increment.

## Release decision

**NO-GO** until RG-01 through RG-10 have objective evidence, critical/high security findings are resolved or explicitly risk-accepted, required CI/E2E/accessibility checks pass on the candidate SHA, released templates are certified, backup/restore and operational ownership are demonstrated, and the owner approves release.

A passing build, source presence, merged PR or documentation update alone is insufficient.
