# Product Architecture (Target)

## Logical layers
1. **Experience layer** — catalog UI, template editor, preview, project wizard, administration.
2. **Catalog layer** — metadata, taxonomy, search, tags, ownership, lifecycle.
3. **Asset layer** — source packages, design assets, documentation, dependencies, previews.
4. **Customization layer** — brand tokens, content slots, feature flags, configuration profiles.
5. **Generation layer** — validate, scaffold, render/export, create independent output.
6. **Versioning layer** — immutable releases, compatibility, changelogs, update/migration plans.
7. **Integration layer** — Git hosting, storage, CI, optional JARVIS, future external services.
8. **Governance layer** — identity, authorization, audit, licensing, security, approvals.

## Architectural rules
- Begin with a modular monolith unless measured needs justify service separation.
- Keep domain boundaries explicit; do not prematurely create microservices.
- Template source, released versions, and generated client projects are distinct artifacts.
- Generated projects must not silently track or overwrite source templates.
- Secrets belong in environment/secret stores, never in Git.
- External integrations are optional adapters behind interfaces.
- Every generation/update operation should be reproducible and auditable.

## Technology posture
No final stack is mandated by this repository initialization. Prefer free/open tools and choose technology per product area. The web application may use the existing ASAA preference for React/TypeScript where appropriate, while generated templates may support multiple stacks.
