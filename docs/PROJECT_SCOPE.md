# Templates Project Scope

**Project:** Templates — internal ASAA development platform  
**Repository:** https://github.com/ASAA1229/Templates  
**Scope version:** 2026-11-14 | **Status:** preserve reported platform progress; validate branch/runtime before claiming completion

## Mission
Accelerate ASAA software delivery through reusable templates, development workspaces, builders, quality controls and repeatable delivery pathways.

## Users and access
Internal employees, developers and management only. External-company access is future/conditional and requires a separate approval.

## In scope
- Template catalog, taxonomy, lifecycle and versioning.
- Sectors, custom divisions and domain-specific template families.
- Website, web app, e-commerce, mobile, desktop, backend/API, enterprise, UI systems, DevOps, AI and data templates.
- Visual editing plus advanced source/configuration editing.
- Online workspaces, collaboration and project scaffolding.
- AI-assisted creation and JARVIS mini-capabilities (not the full personal JARVIS assistant).
- ZIP export, GitHub repositories, deployment workflows and reusable assets.
- QA, security, testing, documentation, monitoring and connectors.
- Offline Linux/AIX environment snapshot capability.

## Environment snapshot requirement
Standalone/offline Python capability; no network dependency; generate TXT and JSON reports; preserve the CMM ICG/ACQ/ISS context. Treat this as a Templates feature until separately re-scoped.

## Target architecture and constraints
React + Vite + TypeScript/JavaScript; Node.js + Express; PostgreSQL + Prisma; Tailwind + shadcn/ui; modular monolith. Adapt only with documented justification. Zero-cost/no-cost by default until the user explicitly approves paid services. Demo template count is flexible, not a fixed long-term limit.

## Current status summary
The current main-branch repository tree is documentation-led (product vision, architecture, governance, status, roadmap, taxonomy, sectors, divisions and lifecycle). The user has reported that the basic platform is done, but this statement is not equivalent to current main-branch source/runtime verification. Reconcile dev/local work before changing epic states.
