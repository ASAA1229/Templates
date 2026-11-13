# Operations Guide

## 1. Operational status and boundaries

The repository provides local development, database migration, build, smoke-test and CI foundations. No production deployment topology, hosting provider, public endpoint, production SLA or production recovery objective is approved or evidenced by this repository. Do not treat this document as authorization to deploy.

The operating-cost ceiling is ₹0 until the platform owner explicitly authorizes spending. Production/staging infrastructure, paid runners, hosted databases, storage, registries, monitoring, domains and subscriptions remain disabled absent approval.

## 2. Local service lifecycle

Initialize the local PostgreSQL cluster once:

```bash
npm run db:local -- init
```

Start/stop/check the local database:

```bash
npm run db:local -- start
npm run db:local -- status
npm run db:local -- stop
```

Start the application with `npm run dev`. Default local endpoints:
- Web: `http://127.0.0.1:5000`
- API: `http://127.0.0.1:4000`
- Health: `http://127.0.0.1:4000/api/health`

The health endpoint checks PostgreSQL connectivity and returns degraded/unavailable when the database check fails. It is a basic liveness/dependency check, not comprehensive monitoring.

## 3. Build and release verification

Before accepting a candidate commit:
1. Confirm branch and commit identity.
2. Install from lockfile using `npm ci`.
3. Apply committed migrations to an isolated target database.
4. Run `npm run validate`.
5. Run `npm run smoke`.
6. Run Playwright E2E and accessibility checks.
7. Review template-specific loader, approval, preview, generation, integrity and responsive evidence.
8. Review security/dependency/license findings and known risks.
9. Record failures and evidence; do not promote while mandatory gates fail.

The CI workflow currently validates pushes to `new`, `dev`, `fix`, `test`, and pull requests targeting `dev` or `main`. It uses an ephemeral PostgreSQL service and a GitHub-hosted runner. The workflow previously included a temporary formatting-repair-and-push step on eligible pushes to `new`; this was removed in the 2026-11-13 hardening increment. The validation workflow now uses contents: read and does not commit or push source changes. Check the actual workflow result for the exact commit—do not infer success from a started run.

A release must distinguish code committed, build verified, tests passed, template certified, approved, deployed and post-deployment verified. Production deployment requires explicit owner authorization and an approved deployment/recovery plan.

## 4. Database migrations and data protection

- Commit Prisma migrations with the matching schema changes.
- Review migration SQL for destructive or irreversible changes.
- Back up before applying schema changes to any environment with valuable data.
- Use `npm run db:status -w @asaa/api` to inspect migration state.
- Apply committed migrations with `npm run db:deploy`.
- Never use test databases for durable data or production credentials in local development.
- Restrict database listener/network access; local helper binds to loopback.

## 5. Backup and recovery baseline

Back up all state required to reconstruct the platform, not only PostgreSQL:
- PostgreSQL database (identity, projects, requirements, catalog metadata, audit and related records).
- Template library and approved package versions.
- Generated project outputs and their provenance.
- Required environment/configuration references and deployment manifests, excluding plaintext secrets from the backup destination.
- Any separately configured file/artifact storage.

For PostgreSQL logical backup, use the target environment's approved connection string and a protected destination:

```bash
pg_dump --format=custom --no-owner --file=templates-db.dump "$DATABASE_URL"
```

Restore into a newly provisioned, isolated database first:

```bash
createdb templates_restore_check
pg_restore --no-owner --dbname=templates_restore_check templates-db.dump
```

These are PostgreSQL operator commands, not an automated backup product supplied by this repository. Secure the backup destination, restrict access, encrypt backups at rest and in transit, and keep credentials out of command logs/history. Back up the template library and generated-output directories separately using an approved file-backup method.

Do not overwrite a live database during a restore drill. Validate schema/migration compatibility, record checksums, verify representative records and files, then obtain approval before any production recovery.

## 6. Incident and recovery procedure

1. Detect and record the incident, affected service/data, start time and reporter.
2. Contain exposure: restrict access, revoke affected sessions/credentials or isolate the affected service.
3. Preserve relevant logs and audit evidence; do not copy secrets into incident notes.
4. Classify impact, data loss window and integrity status.
5. Restore from a verified backup into an isolated environment.
6. Validate database, template packages, generated outputs, authentication, authorization and critical workflows.
7. Obtain owner approval before restoring production traffic or performing destructive remediation.
8. Record root cause, actions, residual risks and preventive tests.

Recovery objectives (RPO/RTO), backup frequency, retention, encryption key custody and escalation contacts must be explicitly set before production operation. Do not invent or assume them.

## 7. Monitoring and maintenance

Current foundations: structured API logging, request IDs, API/database health endpoint and CI validation. They do not constitute production observability or alerting.

Before production, define:
- Service and dependency health, latency, error rates and resource saturation.
- Database capacity, migration state, connection health and backup status.
- Generation/build job state, queue age, failure rate, resource consumption and cleanup.
- Security events, authentication failures, permission denials and privileged actions.
- Template integrity, approval state and generated-artifact checksums.
- Alert thresholds, ownership, escalation and incident records.
- Log retention, redaction, access and correlation.

Perform dependency updates, security review, backup restore drills and recovery exercises on a documented cadence. Keep monitoring and backup tools local/free unless spending is approved.


## 8. Authoritative status and current CI limitation — 2026-11-13

Current maturity scores, gap status, CI evidence and release decision are maintained in [PROJECT_STATUS.md](PROJECT_STATUS.md); do not maintain a competing status table here. The latest observed CI run #705 failed in Playwright (19 passed, 3 failed) after dependency audit, migrations, format/lint/typecheck/unit+integration/build and smoke passed. The workflow currently has a temporary formatting repair/push step and contents: write; remove that behavior and use least-privilege read-only validation. No production deployment, Jenkins agent execution, Nexus publishing/retrieval or restore drill is evidenced. Configuration or written procedures alone do not establish these operations.
