# Templates Epic Register — 2026-11-14

| ID | Epic | Development | Testing | Integration | Acceptance/release |
|---|---|---|---|---|---|
| TMP-E01 | Platform foundation/modular architecture | Implemented locally (RG-01 to RG-15) | Agent-reported validate/smoke/E2E 27/27 green; coordinator rerun of validate failed at api typecheck with Windows EPERM on Prisma engine DLL (inconclusive) | Local only | Not accepted |
| TMP-E02 | Internal access/roles/governance | Implemented locally (roles, MFA, isolation) | Authorization matrix and MFA suites pass locally (agent-reported) | Local only | Not accepted |
| TMP-E03 | Taxonomy/sectors/divisions | Docs present; 25 demo packages across sectors | Certification 29/29 (agent-reported) | Not assessed | Not accepted |
| TMP-E04 | Catalog/demo templates/lifecycle | Implemented locally | Lifecycle/certification tests pass locally (agent-reported) | Local only | Not accepted |
| TMP-E05 | Visual builder/source configuration | Partial (workspace file editor, diff, history) | workspace-files tests pass locally | Local only | Not accepted |
| TMP-E06 | Workspaces/versioning/collaboration | Implemented locally (files, history, release pinning) | Local tests; two-person release lifecycle E2E | Local only | Not accepted |
| TMP-E07 | AI-assisted creation | Target scope | Not assessed | Not assessed | Not accepted |
| TMP-E08 | ZIP/GitHub/deployment pathways | ZIP export implemented locally; Git hand-off/deploy not authorized | export tests pass locally | No deployment | Not authorized |
| TMP-E09 | QA/security/documentation | Implemented locally | axe sweep, reflow, certification pass locally; manual screen-reader review not done | Local only | Not accepted |
| TMP-E10 | Offline Linux/AIX environment snapshot | IN DEVELOPMENT (Environment Snapshot, uncommitted; not done) | Not assessed | Not assessed | Not accepted |
| TMP-E11 | Operations/monitoring/assets/connectors | Partial (backup, readiness, resolver, connector contracts) | Fake-server connector tests pass locally | Live Jenkins/Nexus pending | Not accepted |

User-reported basic platform completion is retained as a report, not upgraded to verified completion without branch/runtime evidence.

**Reconciled 2026-11-14 (documentation owner):** development, testing, integration and acceptance columns updated to the verified evidence in PROJECT_STATUS.md. Local evidence is not CI evidence (no GitHub Actions run observed; `gh` unauthenticated) and nothing here is CI VERIFIED.

**Reconciled 2026-11-15 (documentation owner):** development, testing, integration and acceptance columns updated to the verified evidence in PROJECT_STATUS.md. Local evidence is not CI evidence (no GitHub Actions run observed; `gh` unauthenticated) and nothing here is CI VERIFIED.


---

## Discovery expansion — Sets 1–12 (2026-11-19)

All questions in Sets 1–12 were answered “all of the above”. Treat these as candidate requirements for reconciliation, not implementation evidence or a delivery commitment. Preserve TMP-E01–TMP-E11 and their existing evidence/status values. Map applicable additions as sub-epics/features: expanded template categories and industry taxonomy; scratch/import/GitHub/AI/visual authoring; customization and generated outputs; lifecycle/versioning/compatibility; collaboration; AI/JARVIS mini-features; validation and quality; deployment; assets/connectors; and offline Linux/AIX Environment Snapshot. Also map cross-cutting shared architecture, APIs/events, data governance, security/privacy, CI/CD/infrastructure, and quality engineering/testing. No status promotion from questionnaire answers.
