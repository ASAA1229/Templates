import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { base32Decode, decryptSecret, encryptSecret, encryptionKey, hotp, timeStep } from "../src/lib/totp.js";
import { createHarness, OWNER_EMAIL, OWNER_PASSWORD } from "./helpers.js";

/** US-A04 / RG-02: TOTP MFA enrolment, login challenge, replay protection, recovery codes, reset, policy. */
const KEY = "a-test-mfa-encryption-passphrase";
const h = createHarness({ MFA_ENCRYPTION_KEY: KEY });
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  await h.createOwner();
});

const codeAt = (secret: string, atMs: number) => hotp(base32Decode(secret), timeStep(atMs));

async function enable() {
  const agent = await h.signedIn();
  const enrol = await agent.post("/api/auth/mfa/enroll", { password: OWNER_PASSWORD });
  expect(enrol.status).toBe(200);
  const secret = enrol.body.secret as string;
  const activate = await agent.post("/api/auth/mfa/activate", { code: codeAt(secret, h.clock.now.getTime()) });
  expect(activate.status).toBe(200);
  return { agent, secret, recovery: activate.body.recoveryCodes as string[] };
}

describe("TOTP primitives", () => {
  it("matches the RFC 6238 SHA-1 test vector and round-trips encrypted secrets", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    const key = encryptionKey(KEY);
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(stored, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptSecret(stored, encryptionKey("another-key-another-key"))).toThrow();
  });
});

describe("MFA lifecycle", () => {
  it("enrols with the password, stores only encrypted secret and hashed recovery codes", async () => {
    const agent = await h.signedIn();
    expect((await agent.get("/api/auth/mfa")).body.mfa).toMatchObject({ available: true, enabled: false });
    expect((await agent.post("/api/auth/mfa/enroll", { password: "wrong wrong wrong" })).status).toBe(400);
    const { secret, recovery } = await enable();
    const row = await h.ctx.prisma.owner.findFirstOrThrow({ where: { email: OWNER_EMAIL } });
    expect(row.mfaEnabledAt).not.toBeNull();
    expect(row.mfaSecretEnc).not.toContain(secret);
    expect(JSON.stringify(row.mfaRecoveryHashes)).not.toContain(recovery[0]);
    expect(recovery).toHaveLength(10);
    expect((await agent.post("/api/auth/mfa/enroll", { password: OWNER_PASSWORD })).status).toBe(409);
    expect((await h.agent().post("/api/auth/mfa/enroll", { password: "x" })).status).toBe(401);
  });

  it("requires the second factor at sign-in, rejects wrong and replayed codes", async () => {
    const { secret } = await enable();
    const login = (code?: string) =>
      h.agent().post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD, code });
    const missing = await login();
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("MFA_REQUIRED");
    expect((await login("000000")).status).toBe(401);
    // Move to a later step so the activation step is not the replay-guard baseline.
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const good = codeAt(secret, h.clock.now.getTime());
    expect((await login(good)).status).toBe(200);
    expect((await login(good)).status).toBe(401);
    const wrongPassword = await h
      .agent()
      .post("/api/auth/login", { email: OWNER_EMAIL, password: "bad bad bad bad", code: good });
    expect(wrongPassword.body.error.message).toBe("Invalid email or password.");
  });

  it("accepts each recovery code exactly once", async () => {
    const { recovery } = await enable();
    const login = (code: string) =>
      h.agent().post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD, code });
    expect((await login(recovery[0]!)).status).toBe(200);
    expect((await login(recovery[0]!)).status).toBe(401);
    expect((await login(recovery[1]!)).status).toBe(200);
    expect(
      (await h.ctx.prisma.owner.findFirstOrThrow({ where: { email: OWNER_EMAIL } })).mfaRecoveryHashes,
    ).toHaveLength(8);
  });

  it("disables only with password and a valid code", async () => {
    const { agent, secret } = await enable();
    expect((await agent.post("/api/auth/mfa/disable", { password: OWNER_PASSWORD, code: "123456" })).status).toBe(400);
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const done = await agent.post("/api/auth/mfa/disable", {
      password: OWNER_PASSWORD,
      code: codeAt(secret, h.clock.now.getTime()),
    });
    expect(done.status).toBe(204);
    expect((await h.agent().post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD })).status).toBe(
      200,
    );
  });

  it("lets the owner reset a member's MFA (ending sessions) but not an admin's by another admin", async () => {
    const make = async (email: string, role: "ADMIN" | "EMPLOYEE") =>
      h.ctx.prisma.owner.create({
        data: {
          email,
          displayName: email,
          role,
          passwordHash: await hashPassword(OWNER_PASSWORD),
          passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
          createdAt: new Date(h.clock.now.getTime() - 1000),
          mfaSecretEnc: encryptSecret("JBSWY3DPEHPK3PXP", encryptionKey(KEY)),
          mfaEnabledAt: new Date(),
        },
      });
    const member = await make("member@asaa.test", "EMPLOYEE");
    const admin = await make("admin@asaa.test", "ADMIN");
    const other = await make("admin2@asaa.test", "ADMIN");
    void other;
    const owner = await h.signedIn();
    expect((await owner.post(`/api/auth/members/${member.id}/mfa-reset`)).status).toBe(204);
    expect((await h.ctx.prisma.owner.findUniqueOrThrow({ where: { id: member.id } })).mfaEnabledAt).toBeNull();
    expect((await owner.post(`/api/auth/members/${admin.id}/mfa-reset`)).status).toBe(204);
  });

  it("enforces MFA for privileged actions when the policy is on", async () => {
    const strict = createHarness({ MFA_ENCRYPTION_KEY: KEY, REQUIRE_MFA_PRIVILEGED: "true" });
    try {
      await strict.reset();
      await strict.createOwner();
      const agent = await strict.signedIn();
      const denied = await agent.get("/api/auth/members");
      expect(denied.status).toBe(403);
      expect(denied.body.error.message).toMatch(/Multi-factor/);
      expect((await agent.get("/api/projects")).status).toBe(200);
      const enrol = await agent.post("/api/auth/mfa/enroll", { password: OWNER_PASSWORD });
      await agent.post("/api/auth/mfa/activate", { code: codeAt(enrol.body.secret, strict.clock.now.getTime()) });
      const again = strict.agent();
      strict.clock.now = new Date(strict.clock.now.getTime() + 60_000);
      const login = await again.post("/api/auth/login", {
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        code: codeAt(enrol.body.secret, strict.clock.now.getTime()),
      });
      expect(login.status).toBe(200);
      expect((await again.get("/api/auth/members")).status).toBe(200);
    } finally {
      await strict.close();
    }
    // Without a key, MFA is unavailable and the policy cannot be enabled.
    const noKey = createHarness();
    try {
      const agent = await (async () => {
        await noKey.reset();
        await noKey.createOwner();
        return noKey.signedIn();
      })();
      expect((await agent.post("/api/auth/mfa/enroll", { password: OWNER_PASSWORD })).status).toBe(503);
    } finally {
      await noKey.close();
    }
    expect(() => createHarness({ REQUIRE_MFA_PRIVILEGED: "true" })).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});
