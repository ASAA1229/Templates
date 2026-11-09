# ASAA Templates Studio

A standalone, private-first product within the ASAA1229 ecosystem for organizing, designing, customizing, versioning, and generating reusable digital-product templates.

> **Initialization status:** Repository structure and product taxonomy only. No production application, template engine, marketplace, or generation pipeline is implemented by this initialization.

## Product purpose
Templates Studio is the reusable asset and product-foundation layer for ASAA. It is independent of the Portfolio and JARVIS repositories. It may integrate with JARVIS through explicit, permissioned interfaces in a later phase.

## Product areas
- Websites and web experiences
- Applications and SaaS starter kits
- E-commerce and commerce operations
- UI kits, design systems, and component libraries
- Resumes, CVs, portfolios, and professional documents
- Business operations, automation, and workflow blueprints
- Industry/sector-specific solution packs
- Other reusable digital products

## Repository guide
- `docs/`: product definition, architecture, taxonomy, roadmap, governance, and status
- `catalog/`: future template catalog and metadata schemas
- `sectors/`: industry/sector taxonomy and future sector packs
- `divisions/`: product divisions and ownership boundaries
- `templates/`: future reusable template source assets
- `standards/`: quality, security, accessibility, and contribution standards
- `integrations/`: future integration contracts (including optional JARVIS integration)
- `operations/`: release, maintenance, and support procedures

## Current state
See [Project Status](docs/PROJECT_STATUS.md), [Product Vision](docs/PRODUCT_VISION.md), and [Roadmap](docs/ROADMAP.md).

## Guiding principles
Private-first; free/open tooling where practical; modular architecture; independent client outputs; versioned templates; secure defaults; accessible and responsive experiences; no secrets in source control; human approval for external actions.

## Important boundaries
- Portfolio showcases selected work; it is not the template repository or template-management application.
- JARVIS may assist with authoring or customization but is not required for Templates Studio to function.
- Generated client projects must be independent of the source template and must not receive upstream changes without an explicit update operation.
- Do not publish, license, sell, or expose private assets without explicit authorization.
