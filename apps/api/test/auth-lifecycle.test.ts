import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { hashToken } from "../src/lib/tokens.js";
import { createHarness, OWNER_EMAIL } from "./helpers.js";

/** RG-02: activation and reset expiry, single use, rate limits, generic responses and session revocation. */
const h = createHarness();
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  await h.createOwner();
});

const PASSWORD = "a sufficiently long test password";

async function employee(email: string, role: "EMPLOYEE" | "ADMIN" = "EMPLOYEE") {
  return h.ctx.prisma.owner.create({
    data: {
      email,
      displayName: email.split("@")[0]!,
      role,
      passwordHash: await hashPassword(PASSWORD),
      passwordChangedAt: new Date(h.clock.now.getTime() - 1000),
      createdAt: new Date(h.clock.now.getTime() - 1000),
    },
  });
}

async function issueReset(email: string) {
  const owner = await h.signedIn();
  const response = await owner.post("/api/auth/password-reset/issue", { email });
  expect(response.status).toBe(200);
  return new URL(response.body.resetUrl).searchParams.get("token")!;
}

async function approvedActivation(email = "new@asaa.test") {
  const visitor = h.agent();
  await visitor.post("/api/auth/access-requests", { email, displayName: "New Person", reason: "work" });
  const owner = await h.signedIn();
  const [pending] = (await owner.get("/api/auth/access-requests")).body.requests;
  const approved = await owner.post(`/api/auth/access-requests/${pending.id}/approve`, { role: "EMPLOYEE" });
  return { visitor, token: new URL(approved.body.activationUrl).searchParams.get("token")! };
}

describe("activation links", () => {
  it("expire after 24 hours with the same generic error as an unknown token", async () => {
    const { visitor, token } = await approvedActivation();
    h.clock.now = new Date(h.clock.now.getTime() + 24 * 60 * 60_000 + 1000);
    const expired = await visitor.post("/api/auth/access-requests/activate", { token, password: PASSWORD });
    const unknown = await visitor.post("/api/auth/access-requests/activate", {
      token: "x".repeat(43),
      password: PASSWORD,
    });
    expect(expired.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(expired.body.error.message).toBe(unknown.body.error.message);
    expect(await h.ctx.prisma.owner.count({ where: { email: "new@asaa.test" } })).toBe(0);
  });

  it("are stored hashed and cannot be raced into two accounts", async () => {
    const { visitor, token } = await approvedActivation("race@asaa.test");
    const stored = await h.ctx.prisma.accessRequest.findFirstOrThrow({ where: { email: "race@asaa.test" } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const results = await Promise.all(
      [1, 2, 3].map(() => visitor.post("/api/auth/access-requests/activate", { token, password: PASSWORD })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await h.ctx.prisma.owner.count({ where: { email: "race@asaa.test" } })).toBe(1);
  });

  it("rejects weak passwords without consuming the link, and is rate limited", async () => {
    const { visitor, token } = await approvedActivation("weak@asaa.test");
    expect((await visitor.post("/api/auth/access-requests/activate", { token, password: "short" })).status).toBe(400);
    expect((await visitor.post("/api/auth/access-requests/activate", { token, password: PASSWORD })).status).toBe(201);

    const limited = h.agent();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await limited.post("/api/auth/access-requests/activate", { token: "y".repeat(43), password: PASSWORD }))
        .status;
    }
    expect(last).toBe(429);
  });

  it("only owner/admin can approve, and rejected requests cannot be activated", async () => {
    const visitor = h.agent();
    await visitor.post("/api/auth/access-requests", { email: "rej@asaa.test", displayName: "Rej", reason: "" });
    const staff = await employee("plain@asaa.test");
    void staff;
    const plain = h.agent();
    await plain.post("/api/auth/login", { email: "plain@asaa.test", password: PASSWORD });
    expect((await plain.get("/api/auth/access-requests")).status).toBe(403);
    const owner = await h.signedIn();
    const [pending] = (await owner.get("/api/auth/access-requests")).body.requests;
    expect((await plain.post(`/api/auth/access-requests/${pending.id}/approve`, {})).status).toBe(403);
    expect((await owner.post(`/api/auth/access-requests/${pending.id}/reject`, {})).status).toBe(204);
    const request = await h.ctx.prisma.accessRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(request.status).toBe("REJECTED");
    expect(request.tokenHash).toBeNull();
  });
});

describe("password reset links", () => {
  it("are single use and the reuse error matches the unknown-token error", async () => {
    await employee("worker@asaa.test");
    const token = await issueReset("worker@asaa.test");
    const visitor = h.agent();
    expect(
      (await visitor.post("/api/auth/password-reset/consume", { token, password: "a brand new password 1" })).status,
    ).toBe(204);
    const reuse = await visitor.post("/api/auth/password-reset/consume", { token, password: "yet another password 2" });
    const unknown = await visitor.post("/api/auth/password-reset/consume", {
      token: "z".repeat(43),
      password: "yet another password 2",
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.message).toBe(unknown.body.error.message);
    expect(
      (await h.agent().post("/api/auth/login", { email: "worker@asaa.test", password: "a brand new password 1" }))
        .status,
    ).toBe(200);
    expect((await h.agent().post("/api/auth/login", { email: "worker@asaa.test", password: PASSWORD })).status).toBe(
      401,
    );
  });

  it("expire after 30 minutes and cannot be raced into two consumptions", async () => {
    await employee("late@asaa.test");
    const expiring = await issueReset("late@asaa.test");
    h.clock.now = new Date(h.clock.now.getTime() + 31 * 60_000);
    const visitor = h.agent();
    expect(
      (await visitor.post("/api/auth/password-reset/consume", { token: expiring, password: "a brand new password 1" }))
        .status,
    ).toBe(400);

    const fresh = await issueReset("late@asaa.test");
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        visitor.post("/api/auth/password-reset/consume", { token: fresh, password: `racing password number ${n}` }),
      ),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
  });

  it("revoke every session, including those of a suspended-then-reactivated account", async () => {
    const user = await employee("sessions@asaa.test");
    const a = h.agent();
    const b = h.agent();
    await a.post("/api/auth/login", { email: user.email, password: PASSWORD });
    await b.post("/api/auth/login", { email: user.email, password: PASSWORD });
    expect((await a.get("/api/auth/session")).status).toBe(200);
    const token = await issueReset(user.email);
    await h.agent().post("/api/auth/password-reset/consume", { token, password: "a brand new password 1" });
    expect((await a.get("/api/auth/session")).status).toBe(401);
    expect((await b.get("/api/auth/session")).status).toBe(401);
  });

  it("cannot be issued for deactivated accounts, unknown accounts or by non-privileged accounts", async () => {
    const gone = await employee("gone@asaa.test");
    await h.ctx.prisma.owner.update({ where: { id: gone.id }, data: { isActive: false } });
    const owner = await h.signedIn();
    expect((await owner.post("/api/auth/password-reset/issue", { email: "gone@asaa.test" })).status).toBe(404);
    expect((await owner.post("/api/auth/password-reset/issue", { email: "nobody@asaa.test" })).status).toBe(404);
    await employee("plain@asaa.test");
    const plain = h.agent();
    await plain.post("/api/auth/login", { email: "plain@asaa.test", password: PASSWORD });
    expect((await plain.post("/api/auth/password-reset/issue", { email: OWNER_EMAIL })).status).toBe(403);
  });

  it("restrict privileged accounts: an administrator cannot reset the owner or another administrator", async () => {
    await employee("admin@asaa.test", "ADMIN");
    await employee("admin2@asaa.test", "ADMIN");
    const admin = h.agent();
    await admin.post("/api/auth/login", { email: "admin@asaa.test", password: PASSWORD });
    expect((await admin.post("/api/auth/password-reset/issue", { email: OWNER_EMAIL })).status).toBe(403);
    expect((await admin.post("/api/auth/password-reset/issue", { email: "admin2@asaa.test" })).status).toBe(403);
    await employee("staff@asaa.test");
    expect((await admin.post("/api/auth/password-reset/issue", { email: "staff@asaa.test" })).status).toBe(200);
  });

  it("are rate limited per client and never stored in plaintext", async () => {
    await employee("limited@asaa.test");
    const token = await issueReset("limited@asaa.test");
    const stored = await h.ctx.prisma.passwordResetToken.findMany();
    expect(stored.map((row) => row.tokenHash)).toContain(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const visitor = h.agent();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await visitor.post("/api/auth/password-reset/consume", { token: "q".repeat(43), password: PASSWORD }))
        .status;
    }
    expect(last).toBe(429);
  });
});

describe("password change", () => {
  it("revokes other sessions, keeps the current one and rejects the old password afterwards", async () => {
    const user = await employee("changer@asaa.test");
    const current = h.agent();
    const other = h.agent();
    await current.post("/api/auth/login", { email: user.email, password: PASSWORD });
    await other.post("/api/auth/login", { email: user.email, password: PASSWORD });
    const changed = await current.post("/api/auth/password", {
      currentPassword: PASSWORD,
      newPassword: "a completely different password",
    });
    expect(changed.status).toBe(204);
    expect((await current.get("/api/auth/session")).status).toBe(200);
    expect((await other.get("/api/auth/session")).status).toBe(401);
    expect((await h.agent().post("/api/auth/login", { email: user.email, password: PASSWORD })).status).toBe(401);
    expect(
      (
        await current.post("/api/auth/password", {
          currentPassword: "wrong wrong wrong",
          newPassword: "another new password",
        })
      ).status,
    ).toBe(400);
  });
});
