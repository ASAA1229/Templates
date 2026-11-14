# Security Requirements and Controls

## 1. Security objectives

Protect the private ASAA engineering workspace, identities, source code, template intellectual property, generated projects, credentials, audit evidence and internal business data. Apply least privilege, secure defaults, defense in depth, explicit approvals and verifiable recovery.

The repository remains private. No public marketplace or external-organization access is authorized for the initial release.

## 2. Identity and access control

- Preserve a unique OWNER account as the ultimate platform authority.
- Current account roles: OWNER, ADMIN, DEVELOPER, TESTER and EMPLOYEE.
- Enforce authorization on the server for every protected route, action and resource. Hiding a button or route is not authorization.
- Scope project, requirement, template, file, generated output, integration and audit access to the actor's permitted resources.
- ADMIN must not be able to grant OWNER authority; only OWNER may appoint another administrator/owner-level authority according to the account lifecycle rules.
- Deactivation must revoke active sessions. Session creation, expiry, rotation, revocation and recovery must be controlled.
- Secure invitation/activation and verified password reset are required before general employee rollout. Current `new` branch includes Owner/Admin-issued one-time reset links (30-minute expiry), hashed token storage, atomic consumption, rate limiting, audit events and revocation of all active sessions. The link is manually delivered through a separately verified secure channel; email delivery is not configured.
- Add specialist design, DevOps, security and project-management roles only with explicit permission definitions and tests.
- Test horizontal and vertical privilege escalation, cross-project access, direct API calls, search result leakage, export leakage and stale-session access.

The current branch contains multi-role and member-management foundations. Employee access-request/activation and Owner/Admin-issued password reset implementations exist; reset tokens are hashed, expiring and single-use, with rate limiting, audit and session revocation. These flows remain NEEDS TESTING, and exhaustive resource isolation is not yet proven. Keep general employee rollout blocked until the relevant gates pass.

## 3. Authentication and session protections

- Never store or log plaintext passwords, tokens, session identifiers or recovery secrets.
- Use approved password hashing and constant-time/standard credential verification mechanisms.
- Use secure, HttpOnly, appropriately SameSite cookies and CSRF protection for state-changing requests.
- Validate allowed request origins; reject untrusted cross-origin mutation attempts.
- Apply absolute and idle session expiry. Current API defaults are 720 minutes absolute and 30 minutes idle.
- Require `COOKIE_SECURE=true` behind HTTPS; the API refuses staging/production configuration when secure cookies are disabled.
- Rate-limit and monitor authentication and recovery endpoints before exposing beyond a trusted local environment.
- Revoke sessions on account deactivation, credential compromise, password reset and authorized security response.
- MFA/passkeys are future hardening options; their absence must be reflected in the deployment risk assessment.

## 4. Application and API security

- Validate all external input at API boundaries using shared schemas.
- Apply server-side authorization before reading or mutating protected resources.
- Use safe path resolution and reject traversal, symlinks and writes outside project roots.
- Apply request body and upload limits; reject unexpected file types and oversized content.
- Use security headers/CSP, disable unnecessary server-identifying headers and avoid caching sensitive API responses.
- Return generic authentication errors and avoid leaking account existence or internal stack traces.
- Use parameterized database access through Prisma; review raw queries.
- Keep CORS/origin rules explicit. Development proxy and production origin must be configured intentionally.
- Do not expose unrestricted shell, arbitrary code execution or untrusted build steps inside the API process.

## 5. Template and supply-chain security

- Verify ownership, license, provenance and redistribution rights before reuse.
- Treat imported packages and project contributions as untrusted until reviewed.
- Require contributor attestations for customer permission, rights and secret checks when contributing project-derived templates.
- Exclude repository metadata, environment files, credentials, private keys, dependency/build/cache folders and platform provenance from submissions.
- Reject unsafe paths, symlinks, excessive file counts/sizes and detected high-confidence credentials.
- Validate manifests, declared inputs, placeholders, dependencies, compatibility and checksums.
- Verify pending-submission integrity again at approval; never trust a previously validated mutable package.
- Released template versions are immutable. Updates create a new version with review and compatibility evidence.
- Run dependency/license/security scans and isolated functional validation before certification.
- Keep generated projects independent; never silently overwrite project files during template updates.

## 6. Secrets and sensitive data

- Never commit `.env` files with real credentials, tokens, private keys, certificates, client records or production exports.
- Store local credentials only in ignored local files with restrictive OS permissions; use an approved secret manager for any deployed environment.
- Scope integration credentials to minimum required repositories/actions; rotate and revoke them.
- Mask secrets in logs, CI output, error reports and generated artifacts.
- Use synthetic/demo data in tests and sample templates. Do not use real customer, patient, financial or employee data without a lawful, approved control framework.
- Encrypt sensitive data and backups in transit and at rest according to the approved deployment design.

## 7. Safe execution and generated projects

- Arbitrary project code, package scripts, builds and tests must run in isolated disposable runners—not inside the trusted API process or application host.
- Enforce CPU, memory, disk, time, network and output limits; deny privileged host mounts and unrestricted credentials by default.
- Use pinned toolchains and approved adapters. Capture logs, exit status, reports and artifact provenance.
- Ensure one project/job cannot read or modify another project's files.
- Cancellation, timeout, cleanup, retry and idempotency behavior must be tested.
- Remote repository creation, pushes, publishing, deployment and destructive operations require explicit user/owner approval and a preview of the destination and contents.

## 8. AI and JARVIS security

- JARVIS is a separate product with separate identity, memory, devices and permissions.
- Only approved capabilities cross a dedicated adapter; personal memory and private device control never cross the boundary.
- Company agents have separate identities, scoped tools, authorized context, audit and approval policies.
- Search/indexing and retrieval do not grant authorization; source access is rechecked before data is returned or actions are taken.
- Classify AI action risk. Require human approval for publishing, external communication, payments, production changes, credential access, destructive actions and other consequential operations.
- External AI processing must be disclosed and approved; paid AI remains disabled until explicitly authorized.

## 9. Audit, privacy and compliance

- Audit privileged actions, account lifecycle changes, permission denials, approvals, template releases, exports, integration changes, AI actions and deployment operations.
- Record actor, action, target, timestamp, outcome and correlation context without recording secrets.
- Protect audit logs against unauthorized modification and define retention/export controls.
- Apply data minimization, purpose limitation, retention/deletion rules and access-controlled exports.
- Healthcare, finance, legal and other regulated-domain templates require jurisdiction-specific expert review. Do not claim compliance certification without independent evidence.

## 10. Security release gates

Before enabling employee access or deploying beyond local development:
1. Complete invitation, activation, password reset and session lifecycle security.
2. Verify every role/action/resource permission server-side.
3. Pass cross-user/project isolation and direct-API authorization tests.
4. Complete security review of authentication, CSRF/origin, cookies, secrets and audit.
5. Certify template ingestion, secret scanning, path safety and package integrity.
6. Implement isolated build/test execution before running untrusted project code.
7. Review dependency/license vulnerabilities and CI permissions.
8. Verify backup confidentiality, integrity and restore controls.
9. Obtain explicit owner approval for the target environment and any non-zero cost.

A green build alone is not a security sign-off.

## Implemented controls and verification — 2026-11-14

Authoritative status and evidence: [PROJECT_STATUS.md](PROJECT_STATUS.md).

- **CI least privilege:** the validation workflow uses `contents: read` and contains no commit or push step; template certification output is uploaded as an artifact only.
- **Authorization isolation (RG-01):** project access is resolved before any request body is parsed. `apps/api/test/authorization-matrix.test.ts` proves the project owner, EDITOR, VIEWER, unrelated employee, unrelated administrator, platform OWNER, suspended and revoked actors across every project-scoped endpoint, plus list, search, dashboard and saved-search leakage. Platform roles never grant access to another user's project. The global audit log is intentionally readable by OWNER and ADMIN.
- **Identity lifecycle (RG-02):** activation links (24 h) and reset links (30 min) are hashed, single use, race-safe and rate limited; unknown, expired and reused tokens return the same generic error; password change and reset revoke sessions; privileged accounts can only be reset by the owner.
- **MFA decision (US-A04):** TOTP (RFC 6238) is implemented with AES-256-GCM encrypted secrets (`MFA_ENCRYPTION_KEY`), replay-protected time steps and ten single-use hashed recovery codes. `REQUIRE_MFA_PRIVILEGED=true` blocks OWNER/ADMIN privileged actions until MFA is enabled. Decision: MFA is optional on a trusted local installation and **must be enabled (policy flag true) before any exposure beyond localhost or a trusted network**. Passkeys remain a future option.
- **Template supply chain (RG-04/06):** per-package certification (manifest, license, provenance, pinned dependencies, secret scan, deterministic dry run, content-digest lock); released versions are immutable in the API and by database trigger; released catalog metadata cannot be edited.
- **Safe export (RG-08):** ZIP entries are validated on write and on read (no absolute paths, `..`, backslashes, drive letters, duplicates, decompression bombs); symbolic links, `.git` and `node_modules` are never exported; export requires project read access and is audited.
- **Workspace files (RG-11):** every path is resolved segment by segment inside the project folder, symbolic links and VCS folders are refused, writes need EDITOR access and detect concurrent edits by content hash, commits are refused on the protected production branch.
- **Isolated execution (RG-07):** `apps/api/src/execution/worker.ts` runs allow-listed executables in a disposable directory with a scrubbed environment and time, memory, output and disk limits, tree kill, cancellation and guaranteed cleanup. **Limit:** no network or syscall sandbox is provided. Do not route untrusted builds through it without a container or virtual-machine boundary.
- **Connectors (RG-12):** every call is scoped to an explicit allow-list, requires a named approver for consequential actions, honours revocation, times out, redacts credentials and is audited. Credentials are resolved from the environment at call time and never stored.

Open: independent security review, OS-level execution isolation, persistent/shared rate-limit storage for multi-instance deployments.
