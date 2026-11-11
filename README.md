# ASAA Templates Platform

A private, organization-internal platform for ASAA employees and management to discover, review, customize and generate reusable digital-product templates and delivery assets.

> **Current status (2026-11-11):** The basic platform foundation is implemented on the `new` branch. The first template-library batch adds 25 industry-specific website demo packages across five business types. CI validation is running; these templates are not yet certified or production-ready.

## Product direction

Templates Studio is an internal organizational workspace, not a public marketplace. Access is restricted to authorized employees and management through the platform's identity and permission model.

**Non-negotiable constraint:** ₹0 operating spend until management explicitly authorizes spending. Prefer local-first and free/open-source tooling.

## Core documents

- [Proof of Concept](docs/POC.md)
- [User Stories and Acceptance Criteria](docs/USER_STORIES.md)
- [Product Vision](docs/PRODUCT_VISION.md)
- [Product Architecture](docs/PRODUCT_ARCHITECTURE.md)
- [Project Status](docs/PROJECT_STATUS.md)
- [Roadmap](docs/ROADMAP.md)
- [Governance and Safety](docs/GOVERNANCE.md)
- [Git Branching Strategy](docs/BRANCHING_STRATEGY.md)
- [Template Library — Batch 001](docs/TEMPLATE_LIBRARY_BATCH_001.md)
- [Template coverage registry](catalog/template-coverage.json)

## Platform capabilities

- Organization-internal workspace and owner-controlled administration.
- Projects, requirements and audit foundations.
- Private catalog with search, filters, lifecycle and trust review.
- Local versioned template library with manifest validation.
- Project initialization from an approved template or a starter.
- Generated project outputs are independent from their source templates.
- React/Vite frontend, Node.js/Express API, PostgreSQL/Prisma data foundation and shared TypeScript contracts.

## Template library

The first demo batch contains **25 templates**: five variants each for restaurants/cafes, clinics/healthcare providers, schools/education institutes, retail/ecommerce stores and professional services firms.

Each business type has:
1. Essential
2. Editorial
3. Catalog
4. Booking
5. Multi-location

Five is the initial demo target, not a fixed limit. The taxonomy and coverage registry are expandable across sectors, business types, technical divisions and organizational functions. The current batch is a starting set, not a claim that every industry has already been populated.

Templates appear in the Catalog page's **Local template library** panel. Each version must be reviewed and approved by an authorized owner before it becomes eligible for project generation. See [Batch 001 details](docs/TEMPLATE_LIBRARY_BATCH_001.md).

## Architecture principles

Start with a modular monolith, explicit domain boundaries, API-first contracts and selective event-driven workflows. Extract services only when justified. Keep providers replaceable, projects isolated, secrets out of Git and generated outputs independent of source templates.

## Repository layout

- `apps/web/`: React + Vite internal platform UI
- `apps/api/`: Express API, Prisma schema and local template packages
- `packages/contracts/`: shared TypeScript/Zod API and template contracts
- `catalog/`: machine-readable sector and template coverage registry
- `docs/`: product definition, architecture, governance, roadmap, status and template batch notes
- `sectors/`, `divisions/`: taxonomy documentation
- `standards/`, `integrations/`, `operations/`: quality, integration and operational guidance

## Branches

See [Branching Strategy](docs/BRANCHING_STRATEGY.md). `main` is the production baseline; `dev` is integration; `new`, `fix` and `test` serve feature, defect and testing work. The current work remains on `new` and has not been merged into `dev` or `main`.

## Important boundaries

- JARVIS and Templates remain separate products. Only explicitly approved JARVIS capabilities may be exposed through a permissioned adapter; personal memory and personal capabilities are excluded.
- Portfolio may showcase approved work but is not the platform itself.
- No public marketplace, external publishing, paid services, paid AI, client deployment or external data sharing without explicit authorization.
- Demo forms do not submit or store data; sample retail interactions do not process payments.
- A successful build is not proof of testing completion or production readiness.
