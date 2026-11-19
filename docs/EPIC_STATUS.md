# Templates Epic Status Register

**As of:** 2026-11-14 | **Evidence basis:** current main tree and user-reported platform status; implementation maturity remains to be reconciled

| Epic | Workstream | Development | Testing | Integration | Acceptance / release | Current note |
|---|---|---|---|---|---|---|
| TMP-E01 | Platform foundation and modular architecture | Implemented locally (RG-01 to RG-15) | Agent-reported validate/smoke/E2E 27/27 green; coordinator rerun of validate failed at api typecheck with Windows EPERM on Prisma engine DLL (inconclusive) | Local only | Not accepted | Not CI VERIFIED |
| TMP-E02 | Internal access, roles and governance | Implemented locally (roles, MFA, isolation) | Authorization matrix and MFA suites pass locally (agent-reported) | Local only | Not accepted | RG-01/02 |
| TMP-E03 | Taxonomy, sectors and divisions | Docs present; 25 demo packages across sectors | Certification 29/29 (agent-reported) | Not assessed | Not accepted | Docs foundation |
| TMP-E04 | Template catalog, demos and lifecycle | Implemented locally | Lifecycle/certification tests pass locally (agent-reported) | Local only | Not accepted | RG-04/05/06 |
| TMP-E05 | Visual builder and source configuration | Partial (workspace file editor, diff, history) | workspace-files tests pass locally | Local only | Not accepted | Visual builder not evidenced separately |
| TMP-E06 | Workspaces, versioning and collaboration | Implemented locally (files, history, release pinning) | Local tests; two-person release lifecycle E2E | Local only | Not accepted | RG-06/11 |
| TMP-E07 | AI-assisted creation and JARVIS mini-features | Target scope | Not assessed | Not assessed | Not accepted | JARVIS mini-features |
| TMP-E08 | ZIP, GitHub and deployment pathways | ZIP export implemented locally; Git hand-off/deploy not authorized | export tests pass locally | No deployment | Not authorized | RG-08 |
| TMP-E09 | QA, security, testing and documentation | Implemented locally | axe sweep, reflow, certification pass locally; manual screen-reader review not done | Local only | Not accepted | RG-09 |
| TMP-E10 | Offline Linux/AIX environment snapshot | IN DEVELOPMENT (Environment Snapshot, uncommitted; not done) | Not assessed | Not assessed | Not accepted | Python; TXT/JSON; CMM ICG/ACQ/ISS |
| TMP-E11 | Operations, monitoring, assets and connectors | Partial (backup, readiness, resolver, connector contracts) | Fake-server connector tests pass locally | Live Jenkins/Nexus pending | Not accepted | RG-10/12/13/14 |

**Reconciled 2026-11-14 (documentation owner):** development, testing, integration and acceptance columns updated to the verified evidence in PROJECT_STATUS.md. Local evidence is not CI evidence (no GitHub Actions run observed; `gh` unauthenticated) and nothing here is CI VERIFIED.

**Reconciled 2026-11-15 (documentation owner):** development, testing, integration and acceptance columns updated to the verified evidence in PROJECT_STATUS.md. Local evidence is not CI evidence (no GitHub Actions run observed; `gh` unauthenticated) and nothing here is CI VERIFIED.


---

## 2026-11-19 discovery reconciliation

Sets 1–12 are closed. New selections are candidate requirements only; existing development, testing, integration and acceptance statuses remain unchanged until verified evidence is recorded. Pending mapping includes template taxonomy/catalogue, authoring/generation, customization/export, lifecycle/versioning, collaboration, AI/JARVIS mini-features, security/isolation, deployment/connectors, offline Linux/AIX snapshot, and cross-project data/security/DevOps/quality requirements. See [PENDING_WORK_REGISTER.md](PENDING_WORK_REGISTER.md). Current release remains NO-GO.
