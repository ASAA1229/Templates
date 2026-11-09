# ASAA Templates Platform

A private-first, owner-controlled internal software-development and future business-operations platform for ASAA. It helps create, develop, test, integrate, deploy, monitor and maintain products using reusable templates, components, workflows, automation and optional AI assistance.

> **Current status:** Planning and repository foundation only. No production application, template engine, project generator, CI/CD pipeline or runtime has been implemented or tested.

## Product direction

The initial product is an internal company workspace, not a public template marketplace. The owner is the only assumed initial user. Future capabilities include employees, teams, isolated organizations and offering the platform to other companies.

**Non-negotiable constraint:** ₹0 operating spend until the owner explicitly authorizes spending. Prefer local-first and free/open-source tooling.

## Core documents

- [Proof of Concept](docs/POC.md)
- [User Stories and Acceptance Criteria](docs/USER_STORIES.md)
- [Product Vision](docs/PRODUCT_VISION.md)
- [Product Architecture](docs/PRODUCT_ARCHITECTURE.md)
- [Project Status](docs/PROJECT_STATUS.md)
- [Roadmap](docs/ROADMAP.md)
- [Governance and Safety](docs/GOVERNANCE.md)
- [Git Branching Strategy](docs/BRANCHING_STRATEGY.md)

## Planned capability areas

- Owner workspace, identity, projects and requirements.
- Reusable template/catalog and asset management.
- Project initialization from templates, imports, compositions or scratch.
- Universal technology adapters and source-control integration.
- Development, testing, quality engineering and documentation.
- DevOps, CI/CD, deployment, observability and recovery.
- Optional JARVIS chatbot, agents, monitoring bot and model orchestration through a separate permissioned integration.
- Future CRM, sales, finance, HR, support, procurement, analytics and other business modules.

## Architecture principles

Start with a modular monolith, explicit domain boundaries, API-first contracts and selective event-driven workflows. Extract services only when justified. Keep providers replaceable, projects isolated, secrets out of Git and generated outputs independent of source templates.

## Repository layout

- `docs/`: product definition, POC, user stories, architecture, governance, roadmap and status
- `catalog/`: future catalog metadata
- `sectors/`, `divisions/`: taxonomy
- `templates/`: future reusable template assets
- `standards/`: quality, security and contribution standards
- `integrations/`: future integration contracts
- `operations/`: release and support procedures

## Branches

See [Branching Strategy](docs/BRANCHING_STRATEGY.md). `main` is the production baseline; `dev` is integration; `new`, `fix` and `test` serve feature/specification, defect and testing work.

## Important boundaries

- JARVIS and Templates remain separate products. Only approved JARVIS capabilities are exposed through an adapter; personal memory and personal capabilities are excluded.
- Portfolio may showcase approved work but is not the platform itself.
- No public marketplace, paid services, paid AI, client deployment or external publication without explicit approval.
- A successful build is not proof of testing completion or production readiness.
