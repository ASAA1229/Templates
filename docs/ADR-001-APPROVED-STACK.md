# ADR-001: Approved Initial Technology Stack

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision owner:** Platform owner
- **Scope:** Initial ASAA Templates Platform implementation

## Context
The platform needs a maintainable, zero-cost-first foundation for a private owner-controlled engineering workspace. The initial architecture is a modular monolith. The selected technologies must support a responsive web UI, typed application code, a maintainable API and relational persistence without requiring paid hosted services.

## Decision
Adopt the following initial stack:

| Concern | Decision |
|---|---|
| Frontend framework/build | React + Vite |
| Application languages | TypeScript by default; JavaScript supported |
| Backend runtime/framework | Node.js + Express |
| Relational database | PostgreSQL |
| ORM and migrations | Prisma |
| Styling | Tailwind CSS |
| Component foundation | shadcn/ui |

## Architectural constraints
- Begin as a modular monolith with explicit frontend feature modules and backend domain modules.
- Keep frontend and backend contracts explicit and validated.
- Use PostgreSQL as the initial relational persistence layer; Prisma owns schema/migration workflows.
- Keep secrets out of source control. Provide local environment examples containing placeholders only.
- Prefer local development and free/open-source dependencies. No paid service, hosted database, API, runner or subscription is permitted without explicit owner approval.
- TypeScript is the default for new code; JavaScript is permitted for interoperability or justified tooling.
- Keep external integrations behind adapters so providers can be replaced.

## Not decided by this ADR
This decision does not select exact version numbers, authentication libraries, testing frameworks, CI/CD provider, deployment target, container strategy, background queue, object storage, monitoring stack or AI provider. Each requires compatibility/security/cost review and a separate decision where material.

## Consequences
**Benefits:** coherent full-stack TypeScript path, fast frontend tooling, established API framework, relational data integrity, schema migrations and reusable UI foundations.

**Trade-offs:** Node/Express API conventions and modular boundaries must be enforced by the project; PostgreSQL requires a local service or approved local container; shadcn/ui components must be maintained within the repository and accessibility-tested.

## Acceptance / follow-up
- Pin compatible runtime and dependency versions during scaffolding.
- Add reproducible setup instructions and lockfiles.
- Add Prisma schema and migration workflow before feature persistence is implemented.
- Record test, CI and deployment tool choices separately; do not imply they are approved by ADR-001.
