# Proof of Concept — ASAA Templates

**Status:** foundational implementation exists; POC not accepted  
**Date:** 2026-11-13  
**Authoritative status:** [PROJECT_STATUS.md](PROJECT_STATUS.md)

## Purpose

Demonstrate a private, zero-operating-cost internal engineering platform that lets authorized ASAA users discover governed reusable templates, configure a project blueprint, generate an independent project workspace and retain traceability from template source to generated output.

The POC succeeds only when the critical user journey, security boundaries, quality gates and recovery controls are demonstrated—not merely when the application starts.

## Approved scope

- Internal ASAA management and employees, after access and release gates pass.
- Owner-governed identity, role-based permissions, project membership and audit.
- Projects, requirements, acceptance criteria and traceability.
- Private catalog, manifest-driven templates and submission/review foundations.
- Blueprint configuration and generation for supported project families.
- Independent generated workspaces and local Git foundations.
- Build/test evidence, safe export and future approved Git hand-off.
- Initial demo library: 25 website packages across hospitality, healthcare information, education, retail/commerce and professional services.

The 25 demo packages are not certified templates. Healthcare samples are informational placeholders, demo forms do not store/submit real data, and sample commerce does not process payments.

## Out of scope

Public marketplace, external organization onboarding, public publishing, client deployment, paid services, arbitrary execution in the API process, silent template overwrite, personal JARVIS memory/device access and unapproved regulated-industry compliance claims.

## Current implementation evidence

React/Vite, Express, PostgreSQL/Prisma, shared TypeScript/Zod contracts, identity/project modules, private catalog/template packages, blueprint/generation foundations, local workspace, CI and Playwright are present.

CI run #705 passed dependency audit, migrations, format/lint/typecheck/unit+integration/build and smoke, but failed the Playwright stage (19 passed, 3 failed). POC is therefore not accepted.

## Critical proof scenarios

1. Owner bootstrap, employee access request, review, activation, login and account lifecycle.
2. Owner shares a project as VIEWER/EDITOR; unrelated/revoked users cannot access it through APIs, search, dashboard, exports or jobs.
3. Maintainer imports/submits a package; validation and review happen; only an approved immutable version becomes selectable.
4. User selects a supported blueprint, configures inputs, previews, generates a project and verifies provenance/integrity.
5. Untrusted code executes in a disposable constrained worker, not the API process; cancellation and cleanup work.
6. Authorized user exports a complete safe ZIP; remote Git requires scoped credentials, destination/content preview and explicit approval.
7. Critical workflows pass unit/integration/API/E2E, browser, keyboard/screen-reader and WCAG 2.2 AA target checks.
8. Database, template library and generated outputs are backed up and restored in isolation; rollback and incident ownership are rehearsed.

## Acceptance criteria

All P0 gates in PROJECT_STATUS.md have objective evidence; critical journeys pass on the candidate commit; each released template has version-specific certification; no unresolved critical/high security issue remains without owner risk acceptance; no untrusted code executes in the trusted API process; export integrity/access controls pass; cost remains ₹0; owner approves target environment and operations.

## Current decision

**NO-GO.** E2E failures, incomplete authorization evidence, uncertified templates, missing isolated execution and unproven recovery prevent POC acceptance.
