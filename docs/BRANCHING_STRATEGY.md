# Git Branching and Delivery Strategy

**Repository:** ASAA1229/Templates  
**Status:** Active branch convention for planned development  
**Date:** 2026-11-09

## Branch roles

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Production/release baseline | Protected; changes only through an approved pull request from `dev`; no direct feature work |
| `dev` | Integration branch | Receives reviewed feature/fix work; continuous integration and integration validation |
| `new` | New feature/specification work | Short-lived work branch; branch from `dev`; PR to `dev` after checks |
| `fix` | Debugging and defect correction | Isolate fixes; document reproduction and regression test; PR to `dev` |
| `test` | Testing and verification work | Test automation, test cases and validation changes; report evidence; do not treat test-branch success as production release |

## Standard flow

1. Start new work from the latest `dev`.
2. Use `new` for planned feature/specification work or `fix` for defect correction. For parallel work, use descriptive child branches (for example `new/<topic>` or `fix/<topic>`) rather than sharing one mutable branch.
3. Use `test` for test-focused work and validation integration. Test changes should be reviewed and merged into `dev` through a PR.
4. Run formatting, lint, type checks, build, automated tests and relevant security/quality checks.
5. Open a PR to `dev` with scope, evidence, risks and documentation changes.
6. After integration and release validation, open a separate approved PR from `dev` to `main`.
7. Tag releases and preserve rollback/recovery instructions.

## Safety rules

- Do not force-push shared branches.
- Do not merge unverified work directly into `main`.
- Do not claim tests passed unless they were actually run and evidence is available.
- Keep secrets, tokens and private client data out of Git.
- Keep generated client projects independent from template source.
- Branch names describe workflow purpose; they do not replace code review, CI or release approval.

## Current branch baseline

The initial repository inspection found only `main`. The `dev`, `new`, `fix` and `test` branches were then created from the initial baseline. The current documentation update is committed to `new`; it is not yet merged into `dev` or `main`.
