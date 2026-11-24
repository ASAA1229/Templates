/**
 * Development-only demo account (E3:D5.13). Creates or updates one local management account from
 * DEMO_USER_EMAIL / DEMO_USER_PASSWORD (environment or the git-ignored apps/api/.env). Never commit the password.
 *
 *   npm run demo:seed -w @asaa/api
 *
 * Everything it creates is labelled TEMPORARY / TEST DATA (E3:D5.15). Requires an explicit NODE_ENV/APP_ENV of
 * development or test. Idempotent, and it only ever updates the account it created itself: an existing account
 * with that email that the seed did not create is refused (no password overwrite, reactivation or role change).
 * MFA is never bypassed. ssoSubject is left untouched (null on creation); OWNER/ADMIN accounts are never linked
 * by email, so link it explicitly with PUT /members/:id/sso-subject as the owner.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password.js";
import {
  SEED_DATA_CLASS,
  SEED_DISPLAY_NAME,
  TEST_DATA_LABEL,
  assertDevelopmentEnvironment,
  assertSeedOwnedAccount,
  readDemoCredentials,
} from "./demo-user-guard.js";

async function main() {
  assertDevelopmentEnvironment(process.env);
  const { email, password } = readDemoCredentials(process.env);
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const existing = await prisma.owner.findUnique({ where: { email } });
    if (existing) {
      // Never touch an account the seed did not create: no password overwrite, reactivation or role change.
      const createdBySeed = Boolean(
        await prisma.auditEvent.findFirst({
          where: { action: "demo_user.create", targetType: "owner", targetId: existing.id },
          select: { id: true },
        }),
      );
      assertSeedOwnedAccount(email, createdBySeed);
      await prisma.$transaction([
        prisma.owner.update({
          where: { id: existing.id },
          data: { passwordHash, passwordChangedAt: now, displayName: SEED_DISPLAY_NAME },
        }),
        prisma.session.updateMany({ where: { ownerId: existing.id, revokedAt: null }, data: { revokedAt: now } }),
        prisma.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            action: "demo_user.update",
            outcome: "SUCCESS",
            targetType: "owner",
            targetId: existing.id,
            metadata: { dataClass: SEED_DATA_CLASS },
          },
        }),
      ]);
      console.log(
        `Demo account ${email} (${TEST_DATA_LABEL}) updated; role, active state, MFA and SSO link unchanged${existing.isActive ? "" : " (account is inactive; the seed does not reactivate it)"}.`,
      );
    } else {
      const hasOwner = Boolean(await prisma.owner.findFirst({ where: { role: "OWNER" } }));
      const role = hasOwner ? "ADMIN" : "OWNER";
      const created = await prisma.owner.create({
        data: { email, displayName: SEED_DISPLAY_NAME, role, passwordHash, passwordChangedAt: now },
      });
      await prisma.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          action: "demo_user.create",
          outcome: "SUCCESS",
          targetType: "owner",
          targetId: created.id,
          metadata: { role, dataClass: SEED_DATA_CLASS },
        },
      });
      console.log(
        `Demo account ${email} (${TEST_DATA_LABEL}) created (role ${role}). Enrol an authenticator under Security at first sign-in.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo seed failed.");
  process.exitCode = 1;
});
