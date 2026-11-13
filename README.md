# ASAA Templates Platform

ASAA Templates is a private internal platform for ASAA management and employees to discover, review, configure and generate reusable software-project templates and engineering assets. It is intended to reduce repeated engineering work and provide a governed path from requirements and project setup through development, verification, release and operations.

It is an internal engineering workspace—not a public marketplace. External organizations, public publishing, client deployment and paid services are outside the current authorization.

## Current platform foundation

The repository contains a modular-monolith application with:

- React + Vite web application.
- Node.js + Express API.
- PostgreSQL persistence through Prisma.
- Shared TypeScript/Zod contracts.
- Authentication, account roles, session controls and audit foundations.
- Project and requirements management, dashboard and permission-aware search.
- Private catalog and local manifest-driven template library.
- Project blueprints, preview and generation with provenance/integrity foundations.
- Local Git/environment workspace foundations.
- Project-to-template submission and maintainer review workflow.
- 25 initial website demo packages across five business types.

These are implementation foundations, not a claim that every product requirement is complete. Template certification, broader multi-stack generation, end-to-end authentication verification/MFA policy, complete endpoint-level authorization verification, isolated build/test execution, complete export/repository provisioning and production operations remain subject to the requirements and verification gates.

## Quick start

### Prerequisites

- Node.js **24.16.0** (see .nvmrc; supported major range is Node 24).
- npm 11 or newer.
- PostgreSQL command-line/server tools available on PATH: initdb, pg_ctl and psql.
- Git.

### Install and initialize local development

From the repository root:

- npm ci
- npm run db:local -- init
- npm run dev

The local database helper creates a private PostgreSQL cluster under .local/pgdata, creates templates_dev and templates_test, and writes apps/api/.env with generated local credentials. The helper binds PostgreSQL to loopback only. Keep .local/ and apps/api/.env private; they are Git-ignored.

The web application is served at **http://127.0.0.1:5000** and proxies /api to the API at **http://127.0.0.1:4000**.

If PostgreSQL is already managed separately, create apps/api/.env from apps/api/.env.example and set valid DATABASE_URL and TEST_DATABASE_URL values instead of running the local-cluster initializer.

### First-time owner setup

After the API environment and database are ready:

- npm run db:deploy
- npm run owner:init -w @asaa/api

Follow the CLI prompts to initialize the owner account. Do not put passwords or secrets in shell history, source files or commits. Use the owner recovery command only through the documented, authorized recovery process.

### Verify the application

- npm run validate
- npm run smoke

Run browser end-to-end tests when required:

- cd apps/web
- npx playwright install chromium
- cd ../..
- npm run test:e2e

See [Development](docs/DEVELOPMENT.md) for commands, environment variables, database lifecycle, troubleshooting and branch workflow. See [Operations](docs/OPERATIONS.md) for backup, recovery and operational checks.

## Documentation

- [Project status](docs/PROJECT_STATUS.md) — authoritative maturity scores, evidence, gap register and release decision.
- [Proof of concept](docs/POC.md) — approved product boundary, critical proof scenarios and POC acceptance.
- [Roadmap](docs/ROADMAP.md) — prioritized milestones, dependencies and exit criteria.
- [Testing and QA](docs/TESTING.md) — test strategy and observed CI evidence.
- [Architecture](docs/ARCHITECTURE.md) — system boundaries, approved technology baseline and core design decisions.
- [Requirements](docs/REQUIREMENTS.md) — consolidated product scope, requirements, acceptance gates and remaining gaps.
- [User stories](docs/USER_STORIES.md) — prioritized story backlog with acceptance criteria.
- [Development](docs/DEVELOPMENT.md) — setup, commands, contribution and branch workflow.
- [Operations](docs/OPERATIONS.md) — runtime checks, release discipline, backup and recovery guidance.
- [Security](docs/SECURITY.md) — access, data, application and operational security requirements.

## Repository structure

- apps/web/ — React/Vite application and UI features.
- apps/api/ — Express API, Prisma schema/migrations and local template packages.
- packages/contracts/ — shared TypeScript and Zod contracts.
- catalog/ — machine-readable template/sector coverage registry.
- docs/ — canonical product and engineering documentation.

## Non-negotiable operating boundaries

- Operating spend remains **₹0** until the platform owner explicitly authorizes a change.
- Keep the repository and application private; first internal rollout is restricted to explicitly authorized ASAA management and employees after access/security gates pass.
- The owner retains ultimate platform authority. Admin/member permissions do not imply ownership.
- JARVIS is a separate product. Only explicitly approved company-safe capabilities may cross a dedicated adapter; personal memory, personal permissions and private device capabilities are excluded.
- Generated projects are independent from source templates. Template updates never silently overwrite generated work.
- Demo forms are non-submitting; sample commerce interactions do not process payments. Healthcare examples are fictional and are not clinical workflows or medical advice.
- A commit, build or UI demo is not evidence of test completion, certification or production readiness.

## Branches and delivery

Standard branches are main, dev, new, fix and test. main is the production/release baseline, dev is integration, and the others support feature, defect and testing work. This assessment and documentation consolidation are limited to new; they do not merge or modify dev or main. See [Development](docs/DEVELOPMENT.md).
