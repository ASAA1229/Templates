# Governance and Safety

## Ownership and access
- Keep the repository private unless public release is explicitly approved.
- The owner is the initial and ultimate platform authority.
- Delegated admins, employees, teams and external organizations are future capabilities with explicit least-privilege permissions.
- Require approval for high-impact administration, publishing, licensing, external communication, production deployment and paid commitments.

## Cost governance
- Hard limit: ₹0 operating spend until the owner explicitly authorizes spending.
- Prefer local-first and free/open-source tools.
- Do not enable paid APIs, AI models, hosting, runners, registries, domains, storage or subscriptions without approval.
- Evaluate license obligations and total operating cost before adoption.

## Data and security
- Never commit credentials, tokens, private client data, personal records or production exports.
- Use secure secret storage, scoped access, rotation and revocation.
- Separate project/client data and validate tenant isolation before external onboarding.
- Protect audit records and redact secrets from logs.
- Back up important source, metadata, configuration and operational records; test restoration.

## Intellectual property and templates
- Record ownership and licensing for every imported asset and template.
- Do not redistribute third-party assets without clear rights.
- Separate internal experiments, approved reusable assets and client-specific deliverables.
- Generated client projects are independent and must not be silently overwritten by template updates.
- Require compatibility analysis, explicit approval and recovery plans for updates.

## AI and JARVIS
- JARVIS remains a separate product.
- Only approved chatbot, agent, monitoring and model-orchestration capabilities may be exposed through a dedicated adapter.
- Never expose personal JARVIS memory, private device access or personal permissions to company users.
- Company agents require separate identity, memory, tools, scoped permissions, audit and risk controls.
- AI integrations are optional; external processing must be disclosed and authorized.
- No paid AI use without explicit owner approval; consequential actions require human approval.

## Branch and release governance
- `main` is the production baseline; changes arrive only through an approved PR from `dev`.
- `dev` is the integration branch.
- `new`, `fix` and `test` support feature/specification, defect and testing work.
- Require reviews and relevant CI checks; do not force-push shared branches.
- Do not claim tests passed unless they were executed and evidence exists.

## Regulated and sensitive domains
Healthcare, finance, legal and other regulated-sector capabilities require domain-expert and jurisdiction-specific review before use or release. Do not represent planned compliance readiness as certification.

## Human approval
Require explicit owner approval before publishing, selling, licensing, creating client repositories, deploying to client environments, sending consequential external communications, modifying production data, enabling paid services or applying high-risk AI remediation.
