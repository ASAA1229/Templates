/**
 * Development-only demo account (E3:D5.13). Creates or updates one local management account from
 * DEMO_USER_EMAIL / DEMO_USER_PASSWORD (environment or the git-ignored apps/api/.env). Never commit the password.
 *
 *   npm run demo:seed -w @asaa/api
 *
 * Refuses outside development/test. Idempotent. MFA is never bypassed: an existing enrolment is kept and, if none
 * exists, the owner enrols an authenticator at first sign-in. ssoSubject is left untouched (null on creation) so
 * the templates-web SSO user with the same verified email can link to this account.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password.js";
import { assertDevelopmentEnvironment, readDemoCredentials } from "./demo-user-guard.js";

async function main() {
  assertDevelopmentEnvironment(process.env);
  const { email, password } = readDemoCredentials(process.env);
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const existing = await prisma.owner.findUnique({ where: { email } });
    if (existing) {
      const role = existing.role === "OWNER" || existing.role === "ADMIN" ? existing.role : "ADMIN";
      await prisma.$transaction([
        prisma.owner.update({
          where: { id: existing.id },
          data: { passwordHash, passwordChangedAt: now, isActive: true, role },
        }),
        prisma.session.updateMany({ where: { ownerId: existing.id, revokedAt: null }, data: { revokedAt: now } }),
        prisma.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            action: "demo_user.update",
            outcome: "SUCCESS",
            targetType: "owner",
            targetId: existing.id,
            metadata: { role },
          },
        }),
      ]);
      console.log(`Demo account ${email} updated (role ${role}). MFA and SSO link unchanged.`);
    } else {
      const hasOwner = Boolean(await prisma.owner.findFirst({ where: { role: "OWNER" } }));
      const role = hasOwner ? "ADMIN" : "OWNER";
      const created = await prisma.owner.create({
        data: { email, displayName: "Demo Owner", role, passwordHash, passwordChangedAt: now },
      });
      await prisma.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          action: "demo_user.create",
          outcome: "SUCCESS",
          targetType: "owner",
          targetId: created.id,
          metadata: { role },
        },
      });
      console.log(
        `Demo account ${email} created (role ${role}). Enrol an authenticator under Security at first sign-in.`,
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
