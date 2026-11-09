# Product Architecture (Target)

**Status:** Target architecture direction; final stack and detailed contracts remain pending ADRs.

## 1. Architectural style
- Begin with a **modular monolith** for the first usable release.
- Define clear domain boundaries, ownership and internal interfaces.
- Use REST/OpenAPI as a default HTTP contract where appropriate; add GraphQL, gRPC, webhooks or events only when a use case justifies them.
- Use event-driven communication and background workers for long-running or decoupled workloads where appropriate.
- Extract independently deployable services only when security, workload, scaling, ownership or deployment needs justify the added operational cost.
- Keep deployment local-first and provider-independent.

## 2. Logical layers
1. **Experience layer** — unified workspace, dashboards, navigation, catalog, project wizard, editors and administration.
2. **Identity and governance layer** — authentication, authorization, policy, audit, approvals and tenant boundaries.
3. **Project/product layer** — projects, requirements, tasks, milestones, delivery and lifecycle.
4. **Catalog and asset layer** — template metadata, source packages, components, design systems, documentation and dependencies.
5. **Customization and generation layer** — configuration profiles, validation, scaffolding, composition and independent project output.
6. **Engineering layer** — repositories, development workspace, build runners, tests, quality gates and artifacts.
7. **Delivery and operations layer** — environments, CI/CD, deployment, monitoring, incidents, backup and recovery.
8. **Integration layer** — provider adapters for Git, storage, databases, CI/CD, infrastructure and optional JARVIS.
9. **Future business layer** — CRM, sales, contracts, finance, HR, support, procurement and analytics.

## 3. Frontend architecture
- Unified application shell with feature-based modules.
- Shared design tokens and documented component system.
- Typed interfaces and centralized API clients.
- Role-aware routes and navigation.
- Explicit loading, empty, success, validation, error, offline and interaction states.
- Responsive desktop/tablet/mobile behavior and WCAG 2.2 AA target.
- Lazy loading and performance budgets.
- Plugin-ready extension points; micro-frontends only if justified.

## 4. Backend architecture
- Domain-oriented modules with explicit responsibility and data ownership.
- Standard request validation, authorization, error contracts and correlation IDs.
- Background jobs for generation, builds, tests, deployments, AI and scheduled maintenance as needed.
- Idempotency, retries, timeouts, cancellation, dead-letter handling and observability for asynchronous work.
- Avoid unrestricted tool execution; use isolated runners and scoped credentials.

## 5. Data and storage architecture
- Select the MVP database only after mapping actual entities, relations, transactions and query patterns.
- Specify ERDs, schemas, constraints, indexes, migrations, seed data, retention, audit and recovery.
- Separate project/client data and design tenant isolation before multi-organization rollout.
- Use storage adapters for local/self-hosted/cloud/object storage where needed.
- Version artifacts and record checksums, provenance and ownership.

## 6. API and integration architecture
- Contract-first API design with OpenAPI where appropriate.
- Define auth, authorization, validation, pagination, filtering, errors, versioning, idempotency, rate limits and compatibility.
- Define event schemas, delivery guarantees, retries and replay where events are used.
- Integrations are optional adapters with scoped credentials, health checks, audit and revocation.
- External provider selection must honor ₹0 until authorized and preserve export/migration paths.

## 7. Security and identity
- Owner-first authentication; secure password handling, sessions, recovery and MFA.
- Least-privilege policy enforcement; RBAC initially with room for ABAC/ReBAC.
- Secrets never enter Git or logs.
- Audit administrative, AI, generation, integration and deployment actions.
- Use sandboxed execution, dependency scanning, threat modeling and tenant-isolation tests.
- Personal JARVIS identity, memory and device capabilities remain outside the company platform boundary.

## 8. AI/JARVIS integration
JARVIS is independent. A dedicated adapter may expose only approved chatbot, agent, monitoring and model-orchestration capabilities. Company agents use separate identities, memory, tools, permissions and audit records. Local/free AI is preferred; paid services require explicit approval. High-risk actions require human approval.

## 9. DevOps and runtime architecture
- Local-first reproducible setup.
- Separate dev/test/stage/prod configuration profiles.
- Evaluate free/local-first CI tools; do not assume a final provider.
- Pipeline: validation, build, tests, security scans, package, artifact verification, approvals, deployment, smoke tests and rollback as applicable.
- Secrets management, artifact provenance, IaC, drift detection, observability, backup and restore.
- No paid runner, registry, hosting, database or infrastructure without explicit authorization.

## 10. Testing architecture
Testing spans unit, component, integration, API, contract, UI, E2E, regression, security, performance, accessibility, compatibility, reliability, recovery and post-deployment validation. Use risk-based selection, synthetic/privacy-safe data, reproducible environments, centralized reports and traceability.

## 11. Architecture decision records
Before implementation, record decisions for:
- Frontend framework, UI foundation, routing and state management.
- Backend runtime/framework and module structure.
- Primary database, ORM/query layer and migration tooling.
- File/object storage and artifact handling.
- Authentication/session implementation.
- API style and event/job execution technology.
- Repository provider integration and branch automation.
- CI/CD runner, test frameworks and security scanners.
- Container/runtime and local deployment approach.
- Backup, monitoring and logging stack.

Every ADR records context, options, decision, rationale, cost, security implications, consequences and review trigger.

## 12. Architectural rules
- Template source, released versions and generated projects are distinct artifacts.
- Generated projects never silently track or overwrite template source.
- Start simple; complexity must be justified by a real requirement.
- Keep provider adapters replaceable and data exportable.
- All consequential actions are permission-checked and auditable.
- A successful build is not equivalent to test completion or production readiness.
