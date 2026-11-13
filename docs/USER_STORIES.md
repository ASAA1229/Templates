# User Stories and Acceptance Backlog

**Product:** ASAA Templates Platform  
**Backlog baseline:** 2026-11-13  
**Scope:** Internal ASAA platform; private repository; ₹0 operating-cost ceiling.

## Status vocabulary

- **Implemented — unverified:** code exists, but required CI/E2E/security evidence is not yet green.
- **Partial:** some acceptance criteria are implemented; remaining criteria are listed.
- **Open:** not implemented or not evidenced.
- **Future:** explicitly outside the initial internal release.

Do not upgrade a story's status based only on a commit, UI screen or successful build. Link evidence to a commit, test run and template/package version.

## Epic A — Identity, access and governance

| ID | User story | Acceptance criteria | Current state |
|---|---|---|---|
| US-A01 | As the owner, I can initialize and securely access the platform so that ultimate authority is controlled. | Unique owner bootstrap; hashed passwords; secure sessions/cookies; no secret logging; owner-only privileged actions; session expiry/revocation tested. | Partial — owner/auth/session foundations exist; full lifecycle evidence remains open. |
| US-A02 | As an employee, I can request access and activate an approved account without an administrator sharing a password. | Generic/rate-limited request response; Owner/Admin review; role restrictions; one-time hashed activation token; expiry and atomic consumption. | Implemented — unverified; manual activation-link delivery. |
| US-A03 | As an active user, I can recover a forgotten password securely. | Owner/Admin issues a 30-minute single-use link; only token hash is stored; consumption is rate-limited and atomic; password change revokes all sessions and other reset links; audit; reset flow tested. | Implemented — unverified; manual secure delivery, API, UI and tests added. |
| US-A04 | As a user, I can enable MFA and review active sessions. | TOTP or passkey policy; recovery codes stored safely; challenge/rate limits; session list/revoke; privileged-action policy. | Open. |
| US-A05 | As a project owner, I can share a project with a teammate as viewer or editor. | Owner-only member management; active account only; unique membership; revoke immediately; UI and API agree. | Implemented — unverified. |
| US-A06 | As a shared project member, I only access resources and actions allowed by my project role. | VIEWER read-only; EDITOR write within organization permissions; unrelated users denied; cover all project-linked routes, search, dashboard, exports and jobs. | Partial — core paths and regression tests added; exhaustive route audit/CI evidence open. |
| US-A07 | As an administrator, I can manage accounts without gaining owner authority. | Least-privilege role matrix; privilege escalation denied; account suspension revokes sessions; all changes audited. | Partial. |

## Epic B — Workspace, navigation and accessibility

| ID | User story | Acceptance criteria | Current state |
|---|---|---|---|
| US-B01 | As an authorized user, I can navigate all available platform modules from a consistent shell. | Every module has a route, navigation entry, permission state, loading/empty/error state and responsive layout. | Partial — foundation exists; complete module UX audit open. |
| US-B02 | As a user, I can understand project and platform status from dashboards. | Metrics scoped to authorized resources; definitions and timestamps visible; no cross-user leakage. | Partial — dashboard foundation/shared scope added; full coverage open. |
| US-B03 | As a user, I can use the platform with keyboard and assistive technology. | Keyboard operation, focus visibility, labels, contrast, semantic structure and automated/manual WCAG 2.2 AA checks. | Open — verification required. |
| US-B04 | As a user, I can search only content I am authorized to see. | Search filters, facets and result actions enforce current resource access; regression tests cover leakage. | Partial — core search scoping and regression test added. |
| US-B05 | As a user, I receive clear feedback for loading, empty, validation, success, offline and denied states. | Consistent reusable states; no misleading success; errors actionable and safe. | Partial. |

## Epic C — Projects and requirements

| ID | User story | Acceptance criteria | Current state |
|---|---|---|---|
| US-C01 | As a user, I can create and manage projects I own or am allowed to edit. | Metadata validation; lifecycle state; owner/editor permissions; archive/restore owner policy; audit. | Partial — core project CRUD and sharing paths exist; complete authorization audit open. |
| US-C02 | As a project team, we can capture requirements with acceptance criteria and dependencies. | Create/update/status/priority; validation; project access checks; traceable change history. | Partial. |
| US-C03 | As a team, we can trace requirements to implementation, tests, defects and releases. | Traceability links and status evidence; no story marked done without tests. | Open. |
| US-C04 | As a project owner, I can see project membership and change access. | List/add/remove members; role display; active account validation; owner-only controls. | Implemented — unverified. |

## Epic D — Catalog, assets and template lifecycle

| ID | User story | Acceptance criteria | Current state |
|---|---|---|---|
| US-D01 | As a developer, I can discover templates by sector, family, stack, maturity and compatibility. | Permission-aware filters; metadata; useful empty states; accurate trust/maturity labels. | Partial — catalog/search foundation and demo packages exist. |
| US-D02 | As a maintainer, I can import or create a template package safely. | Manifest/schema validation; path and size limits; license/provenance; secret/dependency scan; preview; audit. | Partial — submission and validation foundation; full authoring/import pipeline open. |
| US-D03 | As a maintainer, I can certify a template version before release. | Repeatable static, security, dependency, functional, compatibility, responsive and accessibility gates; evidence attached to immutable version. | Open — critical P0. |
| US-D04 | As a user, I can select a stable template version and inspect its provenance. | Immutable version, checksum, changelog, compatibility, license and lifecycle status. | Partial — version/provenance foundations; certification/release completeness open. |
| US-D05 | As a maintainer, I can deprecate a version without breaking existing projects. | Deprecation notice, replacement mapping, existing-project pinning, rollback/restore path. | Open. |
| US-D06 | As a developer, I can reuse components, design systems and assets across templates. | Dependency resolution, licensing, compatibility, version pinning and asset integrity. | Open. |

## Epic E — Blueprint, project builder and generation

| ID | User story | Acceptance criteria | Current state |
|---|---|---|---|
| US-E01 | As a developer, I can create a project from an approved template, composition, import or blank blueprint. | Supported start paths; permission checks; deterministic inputs; provenance. | Partial — template and blueprint generation foundation exists. |
| US-E02 | As a developer, I can configure a project through guided or advanced settings. | Typed schema; defaults; validation; compatibility resolution; clear unsupported-combination errors. | Partial — blueprint/input foundation; complete guided/advanced builder open. |
| US-E03 | As a developer, I can preview the configured project before generation. | Preview reflects selected options and responsive states; no hidden side effects; validation errors actionable. | Partial — preview foundation; full configuration parity/viewport evidence open. |
| US-E04 | As a developer, I can generate reproducible output from a versioned blueprint. | Pinned generator/version; deterministic configuration; integrity checks; provenance; safe path handling. | Partial — current generation exists; multi-stack reproducibility open. |
| US-E05 | As a developer, I can update a generated project safely when its source template changes. | Impact analysis; explicit opt-in; diff; backup/rollback; never overwrite silently. | Open. |

## Epic F/G — Engineering workspace, execution and quality

| ID | User story | Acceptance criteria | Current state |
|---|---|---|---|
| US-F01 | As a developer, I can inspect and edit project files safely. | File tree, editor, path protections, diff/history, autosave/conflict behavior, project isolation. | Partial — local workspace foundation; complete online editor open. |
| US-F02 | As a developer, I can connect an authorized Git repository. | Scoped credentials; destination/content preview; explicit approval; branch policy; audit and revocation. | Partial — local Git foundation; remote provisioning/push open. |
| US-F03 | As a developer, I can export a complete project as a ZIP. | Complete safe file set; exclude secrets/cache; path validation; manifest/provenance/checksum; export authorization. | Open. |
| US-G01 | As a developer, I can run builds and tests without exposing the platform host. | Disposable isolated worker; no trusted API execution; resource/network limits; cleanup; timeout/cancel. | Open — critical P0. |
| US-G02 | As a tester, I can inspect reproducible test evidence. | Logs, exit codes, reports, artifacts, toolchain versions and commit association. | Partial — CI/test foundation; product runner evidence open. |
| US-G03 | As a maintainer, I can enforce quality gates before template certification. | Required scans/tests; severity policy; waivers audited; immutable evidence. | Open. |
| US-G04 | As a developer, I can verify compatibility across supported stacks and environments. | Adapter capability declarations; supported matrix; representative test jobs; clear unsupported result. | Open. |

## Epic H/I — Delivery, operations and resilience

| ID | User story | Acceptance criteria | Current state |
|---|---|---|---|
| US-H01 | As an owner, I can configure deployment environments without embedding secrets. | Environment profiles; protected references; approval and audit; ₹0 constraint. | Open. |
| US-H02 | As an authorized operator, I can release, deploy and roll back a project safely. | Preview; explicit approval; health checks; versioned artifacts; rollback; deployment audit. | Open. |
| US-H03 | As an operator, I can monitor platform and job health. | Structured logs, metrics, alerts, correlation, redaction and ownership. | Partial — basic health/logging foundation only. |
| US-H04 | As an owner, I can restore platform data and artifacts after failure. | Database and file backup; encryption/access controls; restore drills; measured RPO/RTO. | Partial — documented manual guidance; automation and tested drills open. |
| US-I01 | As a security owner, I can audit privileged actions and access denials. | Actor/action/target/time/outcome; no secrets; tamper-resistant retention and export controls. | Partial — audit foundation; full event coverage/retention open. |
| US-I02 | As a security owner, I can prevent untrusted template code from accessing other projects or the host. | Isolation, least privilege, bounded resources, no privileged mounts, secret isolation and penetration tests. | Open. |

## Epic J–X — Extended capabilities

These remain future or phased requirements and must not displace P0 lifecycle and security work.

| ID / epic | User outcome | Acceptance boundary | Current state |
|---|---|---|---|
| US-J01–J05 AI/JARVIS | Use optional company-safe AI assistance. | Separate company identity/context/tools; grounded access; human approval; no personal JARVIS memory/device access; no paid AI without approval. | Future/partial foundations only. |
| US-K01–K03 tenancy | Operate isolated external organizations. | Tenant-isolated identity/data/storage/audit/policy and independent security review. | Future. |
| Epic L business operations | Manage CRM, sales, contracts, finance, HR, procurement, support and related business workflows. | Separate product-domain approval and roadmap; no MVP diversion. | Future. |
| US-M01–M05 collaboration | Collaborate through comments, reviews, assignments and presence. | Project-scoped permissions, audit, conflict handling and controlled external sharing. | Open. |
| US-N01–N06 notifications | Receive actionable, preference-aware notifications. | Delivery status, deduplication, escalation, privacy and audit. | Open. |
| US-O01–O06 search/command | Find and act on authorized platform resources. | Search authorization recheck; safe command execution; approval for consequential actions. | Partial search foundations. |
| US-P01–P06 dashboards | Build personal/team/operational dashboards. | Governed metrics, refresh/freshness, sharing policy and accessible visualization. | Partial foundation. |
| US-Q01–Q06 BI | Produce governed reports and analytics. | Metric definitions, lineage, freshness, privacy, export and audit. | Open. |
| US-R01–R06 workflows | Create forms and approval workflows. | Versioned schemas, validation, conditional logic, audit and safe signatures. | Open. |
| US-S01–S06 documents/assets | Store, preview and share project files securely. | Malware scanning, access control, versioning, retention and integrity. | Partial workspace foundations. |
| US-T01–T05 activity/audit | Trace changes and preserve evidence. | Correlated events, immutable retention policy and controlled export. | Partial. |
| US-U01–U04 navigation | Navigate organization context consistently. | Hierarchy, launcher, context preservation and permission filtering. | Partial. |
| US-V01–V05 learning | Onboard users and provide contextual guidance. | Role-aware tours, knowledge, support and feedback. | Open. |
| US-W01–W06 design/device | Use consistent, accessible experiences across devices. | Tokens/components, responsive/offline strategy, localization and visual/accessibility gates. | Partial foundation. |
| US-X01–X12 objective closure | Close template certification, builder, execution, export, access, connectors, assets, workspace, operations and coverage gaps. | Trace each to P0/P1 stories above; avoid duplicate implementation or false completion. | Active gap-closure program. |

## P0 implementation order

1. Complete project-sharing endpoint authorization audit and regression suite; get CI green.
2. Verify secure password recovery and session revocation end to end; then add MFA policy and recovery controls.
3. Certify the 25 existing demo packages with version-specific evidence.
4. Complete blueprint/generator capability and compatibility contracts.
5. Implement isolated build/test execution.
6. Deliver ZIP export, then approved remote Git provisioning.

## Definition of Done

A story is complete only when all acceptance criteria are implemented, reviewed and backed by passing tests/evidence tied to the relevant commit and package version. Security, privacy, accessibility, performance and recovery checks must be completed according to risk. Documentation and operational guidance must be updated. Build, test, approval, release and production-ready are separate states.


## Release-blocking implementation tasks — 2026-11-13

The following task-level stories decompose the remaining internal-release work. They extend the existing epics and do not mark any capability complete. Each task must be linked to code, automated/manual evidence and the candidate commit. Status remains Open or Partial until that evidence exists.

### P0 — internal release

| Task ID | Parent stories | Task / user outcome | Acceptance criteria | Current state |
|---|---|---|---|---|
| RLC-01 | US-A05, US-A06, US-C01–C04, US-F01–F03, US-G01, US-I02 | As the owner, I can prove project and resource isolation across every API and asynchronous operation. | Maintain a route/job inventory; test owner, admin, editor, viewer, unrelated user, suspended user and revoked member; cover project, requirements, workspace, generation, submissions, search, dashboard, audit, export and background jobs; verify no IDOR or cross-project leakage. | Partial — core sharing paths/tests exist; exhaustive inventory and green evidence open. |
| RLC-02 | US-A01–A04, US-A07 | As the owner, I can trust the complete authentication and account lifecycle before employee rollout. | E2E-test bootstrap/login, activation token expiry and one-time use, reset issuance/expiry/single-use, generic responses, rate limits, privileged-account restrictions, password change and all-session revocation; record MFA policy and implement required controls/recovery. | Partial — activation and reset implementations exist but are unverified; MFA open. |
| RLC-03 | US-G02, US-G03, US-W06 | As a maintainer, I can rely on a deterministic CI pipeline without CI modifying or pushing source code. | Remove temporary formatter-and-push step; commit formatting changes normally; run install, migration, format, lint, typecheck, unit/integration, dependency audit, build, smoke, E2E and accessibility; retain reports; pass on exact PR head SHA. | Blocked — latest PR check recorded as action_required; prior failures need resolution and rerun. |
| RLC-04 | US-D01–D05, US-G03, US-G04 | As a maintainer, I can certify each demo template before anyone generates a project from it. | For all 25 packages, validate manifest/schema, safe paths, license/provenance, dependencies, secrets, loader, preview, generation, output integrity, responsive/browser rendering, accessibility and security; attach version/checksum/evidence; only approved versions appear as certified. | Open — 25 demo packages exist; certification evidence pending. |
| RLC-05 | US-E01–E05, US-G04 | As a developer, I can configure a supported blueprint and reproduce the same project output. | Versioned schema; typed required/optional inputs; generator capability declarations; runtime/stack compatibility matrix; actionable unsupported-combination errors; preview matches generation; deterministic output/provenance; safe explicit template migration with diff/rollback. | Partial — blueprint and generation foundation exists; full contract/reproducibility and migration remain open. |
| RLC-06 | US-D02–D05 | As a maintainer, I can manage a template from draft through immutable release and deprecation. | Create/import/edit; validate package and metadata; review/approve; prevent unapproved selection; immutable release version; changelog; deprecation/replacement mapping; existing-project pinning and prior-version selection. | Partial — contribution/submission review foundation exists; full authoring and lifecycle open. |
| RLC-07 | US-G01–G04, US-I02 | As a developer, I can build and test untrusted generated code without risking the platform host or other projects. | Disposable isolated worker; no execution in API process; enforce CPU/memory/disk/time/process/network/output limits; isolate secrets and filesystem; cancel jobs; clean up on success/failure/timeout; retain redacted logs, exit code, reports and artifact checksums. | Open — critical security blocker. |
| RLC-08 | US-F02, US-F03, US-I01–I02 | As a developer, I can hand off a generated project without losing files or exposing secrets. | Complete ZIP with path validation, secret/cache exclusion, manifest, provenance and checksum; authorize export server-side; test archive integrity; remote Git creation/push requires scoped credentials, destination/content preview, explicit approval, branch policy, audit and revocation. | Partial — local Git foundation exists; ZIP and remote provisioning/push open. |
| RLC-09 | US-B01–B05, US-W01–W06 | As an employee, I can complete critical workflows accessibly across supported screen sizes. | Test login/access request, project creation, catalog discovery, template selection, blueprint configuration, generation, review and export; keyboard-only and screen-reader checks; focus/contrast/labels/semantics; responsive layouts; loading/empty/error/denied states; resolve critical WCAG 2.2 AA findings. | Open — accessibility and end-to-end UX evidence not established. |
| RLC-10 | US-H01–H04, US-I01, US-T01–T05 | As the owner, I can approve an internal release knowing recovery and operations are ready. | Define approved runtime/deployment topology without exceeding ₹0; assign operational ownership; backup database, template library and generated outputs; perform isolated restore drill; define owner-approved RPO/RTO, rollback, incident handling and post-release smoke test; obtain explicit owner sign-off. | Open — no production topology or deployment approval is established. |

### P1 — post-gate platform maturity

| Task ID | Parent stories | Task / user outcome | Acceptance criteria | Current state |
|---|---|---|---|---|
| RLC-11 | US-F01–F02 | Complete online engineering workspace. | Safe editor, file tree, diffs/history, autosave/conflict handling, branch operations, IDE hand-off and project isolation. | Partial — local workspace foundation only. |
| RLC-12 | US-F02, US-H01–H03, US-J01–J05 | Govern external tool integrations. | Connector registry; optional GitHub/Jenkins/CI/storage/database/deployment adapters; scoped credentials; documented capability/version contracts; health checks; revocation; audit; no paid services without approval. | Open — integrations remain limited/future. |
| RLC-13 | US-D06, US-W01–W03 | Reuse governed components, design systems and assets. | Dependency/license resolution, compatibility, version pinning, integrity checks, preview and controlled release. | Open. |
| RLC-14 | US-H01–H04 | Complete delivery and recovery operations. | Environment profiles; CI/CD; artifact promotion; approvals; deployment verification; rollback; monitoring; automated backup and tested restore; incident records. | Partial — CI and basic health/logging/documentation foundations exist; product delivery and recovery proof open. |
| RLC-15 | US-D01, US-G03–G04 | Expand verified template coverage by demand. | Prioritize actual reuse demand; add supported sectors/technical divisions through tested adapters; certify each package/version; do not count taxonomy registry entries as delivered templates. | Partial — taxonomy and 25 initial packages exist; broad certified coverage open. |

### P2 — deferred, not release blockers

The following remain future work and must not displace P0 closure: advanced collaboration/presence, notification channels, semantic search/command orchestration, configurable workflows/forms, advanced BI, optional company-safe AI/JARVIS, offline/native clients, multi-organization tenancy and business operations. Public marketplace, external customer onboarding, client deployment and paid infrastructure remain outside current authorization.

### Execution order

1. RLC-01 and RLC-02 — close access and authentication risks.
2. RLC-03 — stabilize CI and establish trustworthy evidence.
3. RLC-04, RLC-05 and RLC-06 — certify templates and complete the blueprint/authoring lifecycle.
4. RLC-07 — implement isolated execution before enabling untrusted builds.
5. RLC-08 — complete safe export and approved Git hand-off.
6. RLC-09 and RLC-10 — complete accessibility, recovery rehearsal and owner release acceptance.
7. Start RLC-11 through RLC-15 after the internal-release gates are closed.

### Story closure evidence

For every RLC task, record: implementation PR/commit, acceptance-test identifiers and results, security/accessibility findings, artifact or template version/checksum where applicable, reviewer/owner decision, and residual risks. Use the existing status vocabulary. Never change a task to complete because documentation was updated or code merely exists.
