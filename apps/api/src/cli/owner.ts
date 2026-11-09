/**
 * Owner bootstrap and recovery (US-A01, US-A02). Runs only on the host with direct
 * database access — that host access is the verification factor for recovery.
 *
 *   npm run owner:init -w @asaa/api      create the single owner (interactive)
 *   npm run owner:recover -w @asaa/api   set a new password and revoke every session
 *
 * Non-interactive use (CI/tests): OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD env vars.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loginSchema, passwordSchema } from "@asaa/contracts";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password.js";

async function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (hidden) {
    // Mask typed characters for password prompts.
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    const original = output._writeToOutput.bind(rl);
    output._writeToOutput = (text: string) => original(text.includes(question) ? text : "*");
  }
  const answer = await rl.question(question);
  rl.close();
  if (hidden) stdout.write("\n");
  return answer;
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.OWNER_PASSWORD;
  const password = fromEnv ?? (await ask("New password (min 12 chars): ", true));
  const checked = passwordSchema.safeParse(password);
  if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? "Invalid password.");
  if (!fromEnv && (await ask("Repeat password: ", true)) !== password) throw new Error("Passwords do not match.");
  return password;
}

async function main() {
  const command = process.argv[2];
  const prisma = new PrismaClient();
  try {
    if (command === "init") {
      if (await prisma.owner.findFirst()) throw new Error("An owner already exists. Use `owner:recover` to reset the password.");
      const email = loginSchema.shape.email.parse(process.env.OWNER_EMAIL ?? (await ask("Owner email: ")));
      const displayName = (process.env.OWNER_NAME ?? (await ask("Display name: "))).trim().slice(0, 120) || "Owner";
      const passwordHash = await hashPassword(await readPassword());
      const owner = await prisma.owner.create({ data: { email, displayName, passwordHash } });
      await prisma.auditEvent.create({
        data: { actorType: "SYSTEM", action: "owner.init", outcome: "SUCCESS", targetType: "owner", targetId: owner.id },
      });
      console.log(`Owner ${email} created.`);
    } else if (command === "recover") {
      const owner = await prisma.owner.findFirst();
      if (!owner) throw new Error("No owner exists yet. Run `owner:init` first.");
      const passwordHash = await hashPassword(await readPassword());
      const now = new Date();
      const [, revoked] = await prisma.$transaction([
        prisma.owner.update({ where: { id: owner.id }, data: { passwordHash, passwordChangedAt: now } }),
        prisma.session.updateMany({ where: { ownerId: owner.id, revokedAt: null }, data: { revokedAt: now } }),
        prisma.auditEvent.create({
          data: { actorType: "SYSTEM", action: "owner.recover", outcome: "SUCCESS", targetType: "owner", targetId: owner.id, metadata: { via: "host-cli" } },
        }),
      ]);
      console.log(`Password reset for ${owner.email}; ${revoked.count} session(s) revoked.`);
    } else {
      throw new Error("Usage: owner.ts init | recover");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
