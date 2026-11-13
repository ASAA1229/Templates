# Engineering Maturity Roadmap — ASAA Templates

**Date:** 2026-11-13  
**Authoritative status/gap register:** [PROJECT_STATUS.md](PROJECT_STATUS.md)  
**Requirements:** [REQUIREMENTS.md](REQUIREMENTS.md) · **Stories:** [USER_STORIES.md](USER_STORIES.md)

This is a dependency-ordered roadmap, not a calendar promise. A milestone closes only when acceptance evidence is tied to the candidate commit.

## Milestone 0 — Trustworthy baseline
**Priority:** P0 · **Status:** IN DEVELOPMENT  
Establish authoritative status vocabulary; fix observed E2E failures; remove CI source auto-format/push behavior and unnecessary write permissions; require green checks on the exact candidate SHA.  
**Exit:** deterministic read-only validation passes.

## Milestone 1 — Identity and isolation
**Priority:** P0 · **Gaps:** RG-01, RG-02  
Inventory API routes/jobs and indirect lookup paths; test OWNER/ADMIN/DEVELOPER/TESTER/EMPLOYEE/VIEWER/EDITOR plus unrelated, suspended and revoked actors; verify activation/reset/session lifecycle; record MFA policy.  
**Exit:** no cross-project leakage or privilege escalation in API and E2E evidence.

## Milestone 2 — CI and QA gates
**Priority:** P0 · **Gap:** RG-03  
Keep install, migrations, format, lint, typecheck, unit/integration, dependency audit, build and smoke; stabilize Playwright and accessibility; retain reports and trace tests to stories.  
**Exit:** all required checks pass on exact candidate SHA.

## Milestone 3 — Template and generation governance
**Priority:** P0 · **Gaps:** RG-04, RG-05, RG-06  
Certify each package independently; complete versioned blueprint schemas, typed inputs, generator capabilities, compatibility and preview parity; complete draft/import/review/approval/immutable release/deprecation.  
**Exit:** package-specific certification and lifecycle/generation tests pass.

## Milestone 4 — Safe execution and hand-off
**Priority:** P0 · **Gaps:** RG-07, RG-08  
Implement disposable isolated workers with CPU/memory/disk/time/process/network/output limits, secret/filesystem isolation, cancellation and cleanup. Complete safe ZIP export and explicitly approved Git hand-off.  
**Exit:** isolation, cleanup, integrity and authorization tests pass.

## Milestone 5 — Accessible operational release
**Priority:** P0 · **Gaps:** RG-09, RG-10  
Complete WCAG 2.2 AA target review; obtain owner-approved zero-cost topology and operational ownership; back up database/library/generated outputs; perform isolated restore; define owner-approved RPO/RTO, rollback and incident process.  
**Exit:** all P0 evidence and explicit owner release acceptance. Until then, NO-GO.

## Milestone 6 — Workspace and delivery maturity
**Priority:** P1 · **Gaps:** RG-11, RG-12, RG-14  
Complete online editing/history/conflict handling; add optional adapters only with scoped credentials, health, audit and revocation. Verify Jenkins only with an actual authorized agent; verify Nexus only with an actual approved registry endpoint and credentials. Complete artifact promotion, deployment verification, rollback and observability.  
**Exit:** live integration and deployment rehearsal evidence.

## Milestone 7 — Reusable assets and coverage
**Priority:** P1 · **Gaps:** RG-13, RG-15  
Govern component/design-system/asset reuse; expand sectors and technical divisions based on demand; certify every added package/version.  
**Exit:** license-reviewed, versioned and certified evidence.

## P2 — Deferred ecosystem
Advanced collaboration/presence, notifications, semantic search, command orchestration, advanced BI, configurable workflows/forms, optional company-safe AI/JARVIS, offline/native clients, multi-organization tenancy and business operations. Public marketplace/external productization requires separate approval.

## Governance and dependencies

Maintain the ₹0 ceiling; preserve the modular monolith absent measured reasons to change; keep work on new until reviewed; do not merge to dev or main without explicit approval. Use PROJECT_STATUS.md as the single current-state source.
