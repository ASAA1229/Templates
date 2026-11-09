# Template Lifecycle

## States
Idea → Proposed → Placeholder → Draft → In Review → Alpha → Beta → Stable → Deprecated → Archived.

Transitions require recorded evidence and an owner. A status must never be advanced solely because files exist.

## Required metadata (target schema)
- id, name, summary, family, subcategory
- sectors, division, tags
- currentVersion, lifecycleState, owner
- supportedFrameworks, runtimes, dependencies
- license, attribution, redistribution permissions
- requiredInputs, configurableOptions, featureFlags
- preview references, documentation path
- security/accessibility/test status
- createdAt, updatedAt, changelog, compatibility

## Versioning
Use semantic versioning where meaningful. Released versions should be immutable. Breaking changes require migration notes. Client-generated outputs are independent snapshots; upstream updates require an explicit reviewed migration.

## Quality gates (planned)
Documentation; install/build validation; functional checks; security/dependency review; accessibility; responsive behavior; license verification; reproducible generation; clean sample content; no secrets.
