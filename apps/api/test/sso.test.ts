import { createSign, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { base32Decode, encryptSecret, encryptionKey, generateSecret, hotp, timeStep } from "../src/lib/totp.js";
import { createHarness, OWNER_EMAIL } from "./helpers.js";

const ISSUER = "http://127.0.0.1:8180/realms/asaa";
const CLIENT = "templates-web";
const MFA_KEY = "unit-test-mfa-encryption-key-123456";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const b64 = (value: object | Buffer) =>
  Buffer.from(value instanceof Buffer ? value : JSON.stringify(value)).toString("base64url");

/** Claims the fake provider will put in the next ID token. */
let nextClaims: Record<string, unknown> = {};
let lastNonce = "";

function idToken(claims: Record<string, unknown>) {
  const head = `${b64({ alg: "RS256", kid: "k1" })}.${b64(claims)}`;
  return `${head}.${b64(createSign("RSA-SHA256").update(head).sign(privateKey))}`;
}

// Stubbed at module load: the harness builds the app (and captures global fetch) before any beforeAll hook runs.
{
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const target = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (target.endsWith("/.well-known/openid-configuration")) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
      });
    }
    if (target.endsWith("/certs")) return json({ keys: [jwk] });
    if (target.endsWith("/token")) {
      return json({
        id_token: idToken({
          iss: ISSUER,
          aud: CLIENT,
          azp: CLIENT,
          nonce: lastNonce,
          exp: Math.floor(Date.now() / 1000) + 300,
          iat: Math.floor(Date.now() / 1000) - 5,
          ...nextClaims,
        }),
      });
    }
    return new Response("not found", { status: 404 });
  });
}

const harness = createHarness({
  TEMPLATES_OIDC_ISSUER: ISSUER,
  TEMPLATES_OIDC_CLIENT_ID: CLIENT,
  TEMPLATES_OIDC_CLIENT_SECRET: "test-secret",
  MFA_ENCRYPTION_KEY: MFA_KEY,
  WEB_ORIGIN: "http://127.0.0.1:5000",
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await harness.close();
});
beforeEach(async () => {
  await harness.reset();
  nextClaims = {};
});

/** Runs login + callback; returns the callback response. */
async function ssoRoundTrip(agent: ReturnType<typeof harness.agent>) {
  const begin = await agent.get("/api/auth/sso/login");
  expect(begin.status).toBe(302);
  const url = new URL(begin.headers.location!);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  lastNonce = url.searchParams.get("nonce")!;
  return agent.get(`/api/auth/sso/callback?code=abc&state=${url.searchParams.get("state")}`);
}

describe("single sign-on", () => {
  it("reports itself enabled and keeps local login working", async () => {
    await harness.createOwner();
    expect((await harness.agent().get("/api/auth/sso/status")).body).toEqual({ enabled: true });
    await harness.signedIn();
  });

  it("signs in an existing account by verified email and takes no role from the token", async () => {
    await harness.createOwner();
    const member = await harness.ctx.prisma.owner.create({
      data: {
        email: "dev@asaa.test",
        displayName: "Dev",
        role: "DEVELOPER",
        passwordHash: await hashPassword("x".repeat(16)),
      },
    });
    nextClaims = {
      sub: "kc-1",
      email: "dev@asaa.test",
      email_verified: true,
      realm_access: { roles: ["owner", "admin"] },
    };
    const agent = harness.agent();
    const result = await ssoRoundTrip(agent);
    expect(result.status).toBe(302);
    expect(result.headers.location).toBe("/");
    const session = await agent.get("/api/auth/session");
    expect(session.body.owner).toMatchObject({ id: member.id, role: "DEVELOPER" });
    const events = await harness.ctx.prisma.auditEvent.findMany({
      where: { action: "auth.sso.login", outcome: "SUCCESS" },
    });
    expect(events).toHaveLength(1);
  });

  it("never provisions an account and does not trust an unverified email", async () => {
    await harness.createOwner();
    nextClaims = { sub: "kc-2", email: "nobody@asaa.test", email_verified: true };
    expect((await ssoRoundTrip(harness.agent())).headers.location).toBe("/login?sso=failed");
    expect(await harness.ctx.prisma.owner.count()).toBe(1);
    nextClaims = { sub: "kc-3", email: OWNER_EMAIL, email_verified: false };
    const agent = harness.agent();
    expect((await ssoRoundTrip(agent)).headers.location).toBe("/login?sso=failed");
    expect((await agent.get("/api/auth/session")).status).toBe(401);
  });

  it("rejects a callback whose state was not started by this browser", async () => {
    await harness.createOwner();
    const begin = await harness.agent().get("/api/auth/sso/login");
    const state = new URL(begin.headers.location!).searchParams.get("state");
    const other = await harness.agent().get(`/api/auth/sso/callback?code=abc&state=${state}`);
    expect(other.headers.location).toBe("/login?sso=failed");
  });

  it("matches an explicit subject link and refuses an email match linked to a different subject", async () => {
    const owner = await harness.createOwner();
    const agent = await harness.signedIn();
    expect((await agent.put("/api/auth/members/" + owner.id + "/sso-subject", { subject: "kc-owner" })).status).toBe(
      204,
    );
    nextClaims = { sub: "kc-owner" };
    const viaLink = harness.agent();
    expect((await ssoRoundTrip(viaLink)).headers.location).toBe("/");
    nextClaims = { sub: "kc-other", email: OWNER_EMAIL, email_verified: true };
    expect((await ssoRoundTrip(harness.agent())).headers.location).toBe("/login?sso=failed");
  });

  it("never auto-links OWNER or ADMIN accounts by verified email and audits the refusal (E3:D5.16)", async () => {
    const owner = await harness.createOwner();
    const admin = await harness.ctx.prisma.owner.create({
      data: {
        email: "admin@asaa.test",
        displayName: "Admin",
        role: "ADMIN",
        passwordHash: await hashPassword("x".repeat(16)),
      },
    });
    for (const [sub, email] of [
      ["kc-o", OWNER_EMAIL],
      ["kc-a", "admin@asaa.test"],
    ]) {
      nextClaims = { sub, email, email_verified: true };
      const agent = harness.agent();
      expect((await ssoRoundTrip(agent)).headers.location).toBe("/login?sso=failed");
      expect((await agent.get("/api/auth/session")).status).toBe(401);
    }
    expect((await harness.ctx.prisma.owner.findUnique({ where: { id: owner.id } }))?.ssoSubject).toBeNull();
    expect((await harness.ctx.prisma.owner.findUnique({ where: { id: admin.id } }))?.ssoSubject).toBeNull();
    const refusals = await harness.ctx.prisma.auditEvent.findMany({
      where: { action: "auth.sso.login", outcome: "FAILURE" },
    });
    expect(
      refusals.filter((e) => (e.metadata as { reason?: string })?.reason === "privileged_email_link_refused"),
    ).toHaveLength(2);
  });

  it("still requires the MFA step", async () => {
    const owner = await harness.createOwner();
    const signedIn = await harness.signedIn();
    expect((await signedIn.put("/api/auth/members/" + owner.id + "/sso-subject", { subject: "kc-9" })).status).toBe(
      204,
    );
    const secret = generateSecret();
    await harness.ctx.prisma.owner.update({
      where: { id: owner.id },
      data: { mfaSecretEnc: encryptSecret(secret, encryptionKey(MFA_KEY)), mfaEnabledAt: new Date() },
    });
    nextClaims = { sub: "kc-9" };
    const agent = harness.agent();
    const result = await ssoRoundTrip(agent);
    expect(result.headers.location).toBe("/login?sso=mfa");
    expect((await agent.get("/api/auth/session")).status).toBe(401);
    expect((await agent.post("/api/auth/sso/mfa", { code: "000000" })).status).toBe(401);
    const code = hotp(base32Decode(secret), timeStep(harness.clock.now.getTime()));
    expect((await agent.post("/api/auth/sso/mfa", { code })).status).toBe(200);
    expect((await agent.get("/api/auth/session")).status).toBe(200);
  });
});
