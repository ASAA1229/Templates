# Product Requirements

**Product:** ASAA Templates Platform  
**Scope:** consolidated product requirements and acceptance baseline  
**Last consolidated:** 2026-11-12

## 1. Product objective

Provide ASAA with a private, governed workspace that reduces repeated engineering effort and helps authorized people discover, compose, configure, generate, develop, verify, release and maintain reusable digital products. The platform should improve delivery speed, consistency, quality, traceability and sustainable profitability.

The initial product is an internal engineering platform, not a public template marketplace. Broader business operations and external productization are future phases that require separate approval and readiness assessment.

## 2. Mandatory constraints

- Operating cost is **₹0** until the platform owner explicitly authorizes spending.
- Prefer local-first, free/open-source, replaceable technologies and reproducible workflows.
- Keep repository and application private. No public users, external organizations or external collaboration in the initial release.
- Owner retains ultimate platform authority; delegated administration is least-privilege and auditable.
- Do not expose personal JARVIS memory, personal data, private device control or personal permissions.
- No paid API/AI, hosting, runner, registry, storage, domain, subscription or infrastructure without explicit approval.
- No external publishing, client repository creation, client deployment, payment processing or consequential external communication without explicit authorization.
- Generated projects remain independent of source templates. No silent overwrite or update.
- A build passing does not mean tests passed, a template is certified or a product is production-ready.

## 3. Users and access

### Initial and intended internal actors

- **OWNER:** unique platform owner and ultimate authority.
- **ADMIN:** delegated platform administration within owner policy.
- **DEVELOPER:** project implementation and engineering workflows.
- **TESTER:** verification, quality evidence and defect workflows.
- **EMPLOYEE:** authorized internal user with scoped access.
- Future profiles may include project/product manager, designer, QA/security specialist, DevOps engineer, domain specialist and requester.

The current branch implements the initial five account roles, account creation/deactivation, public employee access requests, Owner/Admin review, one-time 24-hour activation links and server-side permission foundations. Activation tokens are stored only as hashes and consumed atomically. The activation link is displayed once to the approver for secure manual delivery; no email provider is assumed. General employee rollout remains blocked until password recovery, resource-level project sharing, specialized roles where needed and end-to-end access-isolation tests are complete. Never infer access from UI navigation alone.

Future external organizations require independently isolated identity, data, configuration, storage, audit and administration. Multi-tenant SaaS is not part of the initial release.

## 4. Core product capabilities

### 4.1 Identity, governance and audit
- Secure owner bootstrap, sign-in, session expiry/revocation and recovery.
- Internal account lifecycle: invitation, activation, suspension, deactivation and recovery.
- Role- and resource-scoped authorization enforced server-side.
- Auditable administration, access changes, approvals, exports, integrations and sensitive actions.
- Protected audit evidence with actor, time, action, target and outcome.
- Target authentication roadmap: configurable MFA, supported SSO and role/organization authentication policies. Passkeys may be added where supported. External identity providers remain optional and must preserve the ₹0 operating constraint.

### 4.2 Workspace and experience
- Unified workspace, dashboard, navigation, application launcher and contextual actions.
- Role-aware and permission-aware views; responsive desktop/tablet/mobile layouts.
- Loading, empty, populated, validation, success, error, disabled, offline and permission-denied states.
- Keyboard and screen-reader support, visible focus, contrast and reduced motion.
- WCAG 2.2 AA baseline; localization-ready dates, times, currency, number formats and RTL.
- Shared design system with governed tokens, themes, reusable components, variants, versioning and compatibility.

### 4.3 Requirements and project management
- Create, update, archive and recover projects with identity, purpose, owner, status and timestamps.
- Capture requirements/user stories with priority, dependencies, acceptance criteria and status.
- Decompose requirements into tasks/milestones and link implementation, tests, defects, documentation and releases.
- Maintain traceability and distinguish planned, in-development, implemented, build-verified, test-verified, approved, released and production states.
- Search and dashboards must respect the same authorization boundaries as the underlying resources.

### 4.4 Catalog and reusable asset ecosystem
- Private catalog with metadata, search, filters, categories, tags, technology profiles, versions, lifecycle and trust status.
- Reusable templates, components, design systems, themes, page sections, API modules, workflows, documentation and assets.
- Record source, owner, license, provenance, version, dependencies, compatibility, security status and supported project families.
- Support discovery, comparison, documentation, preview, version history and controlled release.
- Expandable sector, business-type, technical-division and organizational-function taxonomy. Registered taxonomy is not proof of populated/certified coverage.

### 4.5 Template authoring and lifecycle
- Create from blank, duplicate an existing version or import a package/repository.
- Edit metadata, manifest, source files, assets, declared inputs, dependencies, documentation and compatibility.
- Validate paths, schema, placeholders, dependency/license metadata, provenance, secrets and package integrity.
- Support draft, review, approved/released, deprecated and archived states with actor, timestamp and evidence.
- Released versions are immutable; edits create a new version and changelog.
- Project-to-template contribution requires source ownership/customer permission, rights confirmation and secret review; submissions are isolated pending review and require explicit maintainer approval.
- Contributor-defined typed inputs are validated; placeholders are explicit, not guessed. Binary assets remain unchanged.
- Do not publish or expose a submission as a selectable template before approval.

### 4.6 Project builder and generation
- Create from approved template, compatible asset composition, imported project or blank blueprint.
- Versioned blueprints declare project family, architecture, runtimes, languages, frameworks, package manager, database, APIs, infrastructure, OS compatibility, inputs and generator capabilities.
- Support websites, web applications, e-commerce, backend services/APIs and full-stack applications as initial families; expand through adapters to mobile, desktop, enterprise, data/AI and DevOps.
- Offer guided, structured low-code and advanced configuration where supported.
- Validate dependencies and compatibility before generation; show actionable errors.
- Preview configured outputs, including supported responsive viewports and representative states.
- Preserve template, blueprint, generator, configuration and source provenance.
- Generated projects are independent and editable; template upgrades require explicit impact review and migration.

### 4.7 Engineering workspace and delivery
- Project source tree, file preview/editing, diffs, repository status, history and branch policy.
- Safe local hand-off and approved remote repository provisioning/push.
- Complete ZIP export with directory structure, documentation, provenance and checksum.
- Build/test execution through isolated disposable runners, not the trusted API process.
- Apply time, CPU, memory, disk, network and output limits; cancellation, cleanup, logs, exit codes and reports.
- Product-level CI/CD, artifact management, environment promotion, approvals, deployment verification, rollback and maintenance history.
- Build/test evidence is distinct from production-readiness approval.

### 4.8 Integrations, collaboration and workflow
- Governed connector registry for Git/GitHub, CI systems (including possible Jenkins), storage, databases, toolchains and deployment providers. Target connector governance includes scoped permissions, version compatibility, health monitoring, documented APIs/webhooks/SDKs and auditable revocation.
- Connector contracts cover authentication, capabilities, configuration, health, version, error handling, audit and revocation.
- Realtime collaboration, comments, annotations, assignments, presence, review/approval and controlled file sharing.
- Notifications with priority, preferences, grouping, escalation, delivery tracking and audit.
- Workflow/form builder with schema, conditional logic, validation, approvals, versioning and audit.
- All external integrations are optional and must preserve the ₹0 constraint.

### 4.9 Search, analytics, knowledge and assistance
- Permission-aware global search with filters/facets, saved searches, semantic/natural-language discovery and command palette over time.
- Search index is not the authorization source of truth; access is rechecked at query and action time.
- Dashboards for personal, role, team, project, executive and operational use, with governed data access. Target analytics include usage trends, project health, security insights and operational reporting.
- Reports/BI with definitions, lineage, freshness, privacy, export and audit.
- Central documents/assets/knowledge with versioning, checksums, retention, malware scanning and access-controlled preview.
- Onboarding, contextual help, tutorials, knowledge center and optional support assistant.
- AI assistance is optional, grounded in authorized data and separately permissioned. Consequential actions require human approval.

### 4.10 Future business ecosystem
CRM, sales, proposals, quotations, contracts, finance/accounting, HR/payroll, procurement, vendors, inventory/assets, support/service management, knowledge, BI, legal/compliance, risk, continuity and strategic planning are future modules. Do not divert the core MVP into these capabilities before the software-project lifecycle is reliable.

## 5. Initial template library and taxonomy

The initial demo batch contains 25 website packages: five variants (Essential, Editorial, Catalog, Booking and Multi-location) for each of:
- Restaurant/cafe (hospitality).
- Clinic/healthcare provider.
- School/education institute.
- Retail/e-commerce store.
- Professional services firm.

The broader registry includes 21 broad sectors and 12 technical divisions. It is an expandable coverage plan, not evidence that all sectors/divisions have maintained template collections. New packages should be prioritized by actual project demand and reuse value, not an arbitrary fixed count.

Demo content uses fictional sample data. Forms are preview-only and do not transmit/store personal data. Retail interactions are local demonstrations only; no checkout, payment or inventory integration exists. Healthcare content is informational placeholder content, not medical advice or clinical workflow. Production use requires domain, legal, privacy, accessibility and security review.

Each maintained template should be self-contained and versioned, and declare intended users, required modules, technology/dependencies, supported inputs, license/ownership, compatibility, maturity, security/compliance considerations and validation evidence.

## 6. Product domains and future experience

The platform is organized into independently delivered but integrated domains:
1. Identity, organization and governance.
2. Workspace and experience shell.
3. Template and asset ecosystem.
4. Project and product delivery.
5. Engineering and DevOps.
6. Workflow and forms.
7. Documents and knowledge.
8. Collaboration and communication.
9. Search and command center.
10. Notifications and attention.
11. Analytics and intelligence.
12. Activity, audit and observability.
13. Learning and assistance.
14. Future business operations.

The desired experience is adaptive: central brand, tokens, accessibility and component contracts with module-appropriate interaction patterns. Long-term channels may include responsive web, PWA, native mobile, desktop, APIs, CLI and offline synchronization. These are not all initial-release commitments.

## 7. Quality and acceptance baseline

Every capability must have observable acceptance criteria and appropriate tests. At minimum:
- Unit, component, API, contract, integration, UI and E2E tests as appropriate.
- Regression, smoke and post-deployment checks.
- Security, dependency/license, secret and supply-chain checks.
- Performance, load, compatibility, accessibility and reliability checks based on risk.
- Backup/restore and failure-path verification for operational data.
- Synthetic/privacy-safe test data and reproducible environments.
- Evidence links and defect state for each acceptance criterion.

Use distinct states: Not started, In development, Development complete, Build verified, Testing in progress, Testing complete, Blocked/failed, Approved/released and Production ready. Never mark a story complete from documentation or build success alone.

## 8. Priority and gap-closure sequence

### P0 — core product lifecycle
1. **Certify the existing 25 templates:** actual loader, approval, preview, generation, integrity, responsive/browser, accessibility and security validation for each version.
2. **Generalize blueprints and generator adapters:** multi-stack project families, compatibility contracts and reproducible output beyond static websites.
3. **Complete template authoring and release:** create/import/edit/validate/package/version/review/release in the platform.
4. **Complete project configuration and preview:** guided, low-code and advanced options with validated schemas and responsive preview.
5. **Build isolated execution:** safe build/test jobs, limits, cancellation, logs, reports and artifact evidence.
6. **Complete project hand-off:** verified ZIP export and explicitly authorized remote repository provisioning.
7. **Complete internal identity gates:** employee access request/review/activation is implemented on the current development branch; complete password recovery, resource-level sharing, least-privilege roles and end-to-end isolation tests before employee rollout.t.

### P1 — reusable engineering platform
8. Governed integration connector registry.
9. Reusable component/design-system/asset composition with dependency resolution.
10. Online source workspace with safe editing, diffs and IDE hand-off.
11. End-to-end delivery/operations lifecycle: CI/CD, releases, deployments, observability, incidents and tested recovery.
12. Expand sector and technology coverage by demand and certification evidence.

### P2 — advanced ecosystem
- Advanced collaboration, notification channels, semantic search and AI-assisted command orchestration.
- Rich BI/predictive analytics, configurable forms/workflows, knowledge/onboarding and offline/native clients.
- Multi-organization tenancy and broader business modules.
- External productization only after independent security, privacy, support, compliance and operational-readiness review.

## 9. Current implementation boundary (not a completion claim)

The current `new` branch includes a React/Vite and Express/Prisma foundation; multi-role account and session foundations; projects, requirements, dashboard, catalog, search, template library and generation; project blueprints; local Git/environment workspace; 25 demo website packages; project-to-template submission/review; shared contracts and CI/test foundations.

Current access implementation on `new`: public employee access request, Owner/Admin review, one-time 24-hour activation link, hashed/consumed activation token, multi-role accounts, and project-level VIEWER/EDITOR membership with owner-controlled sharing. Project, requirement, workspace and generation reads/writes are being scoped to membership; project lists, dashboard and search include shared projects. Automated isolation tests have been added, but remain unverified until CI completes.

Known remaining or unverified areas include:
- Final CI/E2E/accessibility evidence and full certification of the 25 packages.
- Secure password recovery/reset, MFA, invitation delivery automation and lifecycle edge cases.
- Complete isolation coverage for every project-linked endpoint, dashboard/search/analytics and background operation.
- Specialist roles, team/project group sharing, organization-level policy and access expiry.
- Broader project-family adapters and complete multi-stack generation.
- Full in-platform authoring/configuration/visual preview.
- Isolated build/test runner and complete ZIP/remote repository delivery.
- Connector registry, reusable asset composition and complete online source workspace.
- Product-level CI/CD, deployment, monitoring, incident handling and tested backup/restore.
- Expanded template coverage beyond the initial 25 website demos.

This document describes desired requirements and known gaps. Verify current code and test evidence before changing status. No production deployment or external publication is implied.


## 10. Consolidated backlog index and traceability

The detailed story backlog was consolidated into the capability and acceptance requirements above. Preserve the original story identifiers below for implementation, issue tracking and test traceability; these identifiers are references, not a claim that the stories are complete.

| Epic | Story range | Scope retained in this requirements baseline |
|---|---|---|
| A — Identity and access | US-A01–A04 | Owner sign-in, sessions/recovery, MFA and policy-based authorization |
| B — Workspace and UI/UX | US-B01–B06 | Dashboard, navigation, global search, responsive accessibility, design system and screen specifications |
| C — Requirements and projects | US-C01–C04 | Project lifecycle, requirements, tasks/milestones and requirement-to-delivery traceability |
| D — Catalog and reusable assets | US-D01–D05 | Catalog discovery, import/metadata, taxonomy, immutable versions and reusable assets |
| E — Initialization and generation | US-E01–E05 | Template/scratch/import/composition starts and safe template updates |
| F — Engineering workspace and source control | US-F01–F04 | Repository integration, branch/review controls, reproducible environments and technology adapters |
| G — Build, test and quality | US-G01–G07 | Reproducible builds, automated/extensible testing, security/performance tests, quality gates and test traceability |
| H — DevOps and operations | US-H01–H07 | Environment profiles, CI, release/deploy/rollback, observability, backup/restore and infrastructure as code |
| I — Security and resilience | US-I01–I05 | Secrets, audit, data isolation, supply-chain controls and resilience/recovery |
| J — AI/JARVIS | US-J01–J05 | Optional assistant, specialized agents, monitoring bot, strict JARVIS boundary and cost/privacy controls |
| K — Multi-organization future | US-K01–K03 | Tenant workspaces, delegated administration and organization customization |
| L — Business operations future | Epic L | CRM, sales, proposals/contracts, finance, HR, procurement, inventory, support, knowledge, BI, legal/compliance and continuity |
| M — Collaboration | US-M01–M05 | Co-editing, comments/reviews, assignments, presence/chat and explicitly controlled external collaboration |
| N — Notifications | US-N01–N06 | Notification center, channel adapters, preferences, grouping, escalation and advisory AI prioritization |
| O — Search and command center | US-O01–O06 | Permission-aware search, facets/saved queries, semantic search, command palette, approved orchestration and relevance analytics |
| P — Dashboards | US-P01–P06 | Role dashboards, personal builder, shared dashboards, executive/operational views, refresh and AI-assisted layouts |
| Q — Reporting and BI | US-Q01–Q06 | Report builder, visualizations, governed cross-module metrics, historical/predictive analysis, AI insights and scheduled export |
| R — Forms and workflows | US-R01–R06 | Form schemas, conditional/multi-step flows, drafts, validation/imports, approvals/signatures and AI suggestions |
| S — Documents and assets | US-S01–S06 | File repository, preview/editing, version comparison, secure sharing, retention and document intelligence/scanning |
| T — Activity and audit | US-T01–T05 | Activity feeds, change comparison/correlation, protected audit, live summaries and evidence retention/export |
| U — Organization navigation | US-U01–U04 | Organization hierarchy, context-preserving navigation, app launcher/tabs and adaptive navigation |
| V — Onboarding and learning | US-V01–V05 | Tours, contextual guidance, searchable knowledge, support/issue reporting and training/feedback |
| W — Design system and device maturity | US-W01–W06 | Themes/tokens, component registry, advanced data views, device/offline support, accessibility/localization and visual quality gates |
| X — Core objective gap closure | US-X01–X12 | Template certification, multi-stack blueprints, authoring, configuration/preview, isolated execution, export/repository provisioning, internal access, connectors, asset composition, source workspace, delivery operations and coverage expansion |

### Definition of Done

A story is complete only when:
- Its acceptance criteria are implemented and reviewed.
- Relevant automated and manual tests pass with evidence tied to the relevant commit/version.
- Security, privacy, accessibility, performance, compatibility and recovery checks appropriate to the risk are complete.
- Documentation and operational procedures are updated where the change affects them.
- No unresolved blocker or unapproved high-severity risk remains.
- The change passes required review and branch/release controls.
- Its state is recorded accurately: implementation, build verification, test completion, approval, release and production readiness are distinct.

A commit, merge, passing build, static source inspection or attractive UI alone does not satisfy Definition of Done.

### Requirements change control

The initial discovery sequence Q1–Q31 is consolidated in this document. Future changes must identify the requirement/story, rationale, affected users and domains, acceptance criteria, dependencies, cost, security/privacy impact, architecture impact, test evidence and priority. Do not reopen completed discovery questions by assumption or silently change approved constraints.

### Current verification boundary

The current `new` branch contains implementation foundations described in Section 9. All remaining stories and unverified acceptance criteria stay open until code inspection and reproducible test evidence support a status change. The ₹0 limit, private/internal access boundary, owner governance and JARVIS separation remain binding across every epic.
