import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OidcSso, SsoError, readOidcConfig } from "./oidc.js";

const ISSUER = "http://127.0.0.1:8180/realms/asaa";
const CLIENT = "templates-web";
const NOW = 1_800_000_000_000;
const b64 = (value: object | Buffer) => Buffer.from(value instanceof Buffer ? value : JSON.stringify(value)).toString("base64url");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };

function sign(claims: object, key = privateKey, header: object = { alg: "RS256", kid: "k1" }) {
  const head = `${b64(header)}.${b64(claims)}`;
  return `${head}.${b64(createSign("RSA-SHA256").update(head).sign(key))}`;
}

function harness(tokenFor: (nonce: string) => Record<string, unknown> | string, discoveryOverride: Record<string, unknown> = {}) {
  let nonce = "";
  let tokenRequest = "";
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (target.endsWith("/.well-known/openid-configuration")) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
        ...discoveryOverride,
      });
    }
    if (target.endsWith("/certs")) return json({ keys: [jwk] });
    if (target.endsWith("/token")) {
      tokenRequest = String(init?.body);
      const result = tokenFor(nonce);
      return json({ id_token: typeof result === "string" ? result : sign(result) });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  const sso = new OidcSso(
    { issuer: ISSUER, clientId: CLIENT, clientSecret: "s3cret", redirectUri: "http://127.0.0.1:5000/api/auth/sso/callback", scopes: "openid email profile" },
    { fetchImpl, now: () => NOW },
  );
  return {
    sso,
    tokenRequest: () => tokenRequest,
    async begin() {
      const begun = await sso.beginLogin();
      nonce = new URL(begun.url).searchParams.get("nonce")!;
      return begun;
    },
  };
}

const valid = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: CLIENT,
  azp: CLIENT,
  sub: "user-1",
  nonce,
  exp: NOW / 1000 + 300,
  iat: NOW / 1000 - 5,
  email: "Dev@Example.com",
  email_verified: true,
  realm_access: { roles: ["templates-admin"] },
  ...extra,
});

describe("readOidcConfig", () => {
  const full = { TEMPLATES_OIDC_ISSUER: "https://idp.example/realms/asaa", TEMPLATES_OIDC_CLIENT_ID: CLIENT, TEMPLATES_OIDC_CLIENT_SECRET: "x" };
  it("is disabled unless issuer, client id and secret are all set", () => {
    expect(readOidcConfig({}, "http://127.0.0.1:5000")).toBeUndefined();
    expect(readOidcConfig({ ...full, TEMPLATES_OIDC_CLIENT_SECRET: "" }, "http://127.0.0.1:5000")).toBeUndefined();
    expect(readOidcConfig({ ...full, TEMPLATES_OIDC_ISSUER: "" }, "http://127.0.0.1:5000")).toBeUndefined();
  });
  it("derives the redirect URI from the web origin", () => {
    expect(readOidcConfig(full, "http://127.0.0.1:5000")?.redirectUri).toBe("http://127.0.0.1:5000/api/auth/sso/callback");
  });
  it("requires https except for loopback", () => {
    expect(() => readOidcConfig({ ...full, TEMPLATES_OIDC_ISSUER: "http://idp.example/realms/asaa" }, "http://127.0.0.1:5000")).toThrow(/HTTPS/);
    expect(readOidcConfig({ ...full, TEMPLATES_OIDC_ISSUER: "http://127.0.0.1:8180/realms/asaa" }, "http://127.0.0.1:5000")).toBeDefined();
    expect(() => readOidcConfig({ ...full, TEMPLATES_OIDC_ISSUER: "https://u:p@idp.example/r" }, "http://127.0.0.1:5000")).toThrow();
  });
});

describe("OidcSso", () => {
  it("starts with PKCE S256, state and nonce", async () => {
    const h = harness(() => ({}));
    const url = new URL((await h.begin()).url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("client_id")).toBe(CLIENT);
  });

  it("returns only the subject and a verified lower-cased email, and sends the secret and verifier", async () => {
    const h = harness((nonce) => valid(nonce));
    const { state } = await h.begin();
    const identity = await h.sso.completeLogin("code-1", state);
    expect(identity).toEqual({ sub: "user-1", verifiedEmail: "dev@example.com" });
    expect(h.tokenRequest()).toContain("code_verifier=");
    expect(h.tokenRequest()).toContain("client_secret=s3cret");
  });

  it("drops an unverified email", async () => {
    const h = harness((nonce) => valid(nonce, { email_verified: false }));
    const { state } = await h.begin();
    expect(await h.sso.completeLogin("c", state)).toEqual({ sub: "user-1" });
  });

  it("consumes state once and rejects unknown state", async () => {
    const h = harness((nonce) => valid(nonce));
    const { state } = await h.begin();
    await h.sso.completeLogin("c", state);
    await expect(h.sso.completeLogin("c", state)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(h.sso.completeLogin("c", "unknown")).rejects.toBeInstanceOf(SsoError);
  });

  it.each([
    ["wrong issuer", { iss: "http://127.0.0.1:8180/realms/evil" }],
    ["wrong audience", { aud: "someone-else", azp: undefined }],
    ["wrong azp", { azp: "other" }],
    ["expired", { exp: NOW / 1000 - 3600 }],
    ["wrong nonce", { nonce: "replayed" }],
    ["future iat", { iat: NOW / 1000 + 3600 }],
  ])("rejects %s", async (_name, patch) => {
    const h = harness((nonce) => valid(nonce, patch));
    const { state } = await h.begin();
    await expect(h.sso.completeLogin("c", state)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("rejects a bad signature, alg none and HS256", async () => {
    for (const make of [
      (nonce: string) => sign(valid(nonce), other.privateKey),
      (nonce: string) => `${b64({ alg: "none" })}.${b64(valid(nonce))}.`,
      (nonce: string) => `${b64({ alg: "HS256", kid: "k1" })}.${b64(valid(nonce))}.${b64(Buffer.from("x"))}`,
    ]) {
      const h = harness(make);
      const { state } = await h.begin();
      await expect(h.sso.completeLogin("c", state)).rejects.toMatchObject({ code: "invalid_token" });
    }
  });

  it("ignores roles in the token", async () => {
    const h = harness((nonce) => valid(nonce, { realm_access: { roles: ["owner"] }, role: "OWNER" }));
    const { state } = await h.begin();
    expect(Object.keys(await h.sso.completeLogin("c", state)).sort()).toEqual(["sub", "verifiedEmail"]);
  });

  it("rejects discovery endpoints on another origin", async () => {
    const h = harness(() => ({}), { token_endpoint: "http://127.0.0.1:9999/token" });
    await expect(h.sso.beginLogin()).rejects.toMatchObject({ code: "unavailable" });
  });
});
