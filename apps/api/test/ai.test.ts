import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { CSRF_HEADER, CSRF_VALUE } from "../src/middleware/security.js";
import { createHarness } from "./helpers.js";

let fake: Server;
let fakeUrl: string;
let fakeMode: "ok" | "bad" = "ok";
let jarvisAuthorization: string | undefined;
let jarvisRequestId: string | string[] | undefined;
let jarvisMessages: unknown;

beforeAll(async () => {
  fake = createServer((req, res) => {
    if (req.url === "/api/tags") return void res.writeHead(200).end("{}");
    if (req.url === "/v1/health") {
      return void res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ modelConfigured: true }));
    }
    if (req.url === "/v1/chat/completions") {
      jarvisAuthorization = req.headers.authorization;
      jarvisRequestId = req.headers["x-request-id"];
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages?: unknown };
        jarvisMessages = body.messages;
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ choices: [{ message: { content: "  JARVIS suggestion.  " } }] }));
      });
      return;
    }
    if (fakeMode === "bad") return void res.writeHead(500).end("nope");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ response: "  Looks fine.  " }));
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => fake.close(resolve)));

describe("optional local AI assist", () => {
  it("is off by default and refuses requests", async () => {
    const h = createHarness();
    await h.reset();
    await h.createOwner();
    const agent = await h.signedIn();
    const status = await agent.get("/api/ai/status");
    expect(status.body).toMatchObject({ enabled: false, reachable: null, endpoint: null });
    const res = await agent.post("/api/ai/suggest", { task: "explain", content: "x" });
    expect(res.status).toBe(422);
    await h.close();
  });

  it("answers from a local Ollama server when enabled, and reports failures plainly", async () => {
    const h = createHarness({ AI_ENABLED: "true", OLLAMA_URL: fakeUrl });
    await h.reset();
    await h.createOwner();
    const agent = await h.signedIn();
    expect((await agent.get("/api/ai/status")).body).toMatchObject({ enabled: true, reachable: true });
    const ok = await agent.post("/api/ai/suggest", { task: "explain", content: "console.log(1)" });
    expect(ok.status).toBe(200);
    expect(ok.body.suggestion).toBe("Looks fine.");
    expect((await agent.post("/api/ai/suggest", { task: "explain", content: "" })).status).toBe(400);
    fakeMode = "bad";
    expect((await agent.post("/api/ai/suggest", { task: "explain", content: "x" })).status).toBe(422);
    fakeMode = "ok";
    await h.close();
  });

  it("uses the local JARVIS gateway with a server-side bearer key", async () => {
    jarvisAuthorization = undefined;
    jarvisMessages = undefined;
    const key = `jrv_0123456789ab_${"A".repeat(43)}`;
    const h = createHarness({
      AI_ENABLED: "true",
      AI_PROVIDER: "jarvis",
      JARVIS_AI_URL: fakeUrl,
      JARVIS_AI_KEY: key,
    });
    await h.reset();
    await h.createOwner();
    const agent = await h.signedIn();
    expect((await agent.get("/api/ai/status")).body).toMatchObject({
      enabled: true,
      provider: "jarvis-local",
      model: "jarvis",
      reachable: true,
    });
    const result = await agent.post("/api/ai/suggest", { task: "explain", content: "console.log(1)" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ model: "jarvis", suggestion: "JARVIS suggestion." });
    expect(jarvisAuthorization).toBe(`Bearer ${key}`);
    expect(jarvisMessages).toEqual([
      { role: "system", content: "You assist with software templates. Follow the user's task and be concise." },
      { role: "user", content: expect.stringContaining("Explain briefly") },
    ]);
    await h.close();
  });

  it("propagates X-Request-ID to the JARVIS gateway, reusing a valid incoming id or generating one", async () => {
    const key = `jrv_0123456789ab_${"A".repeat(43)}`;
    const h = createHarness({ AI_ENABLED: "true", AI_PROVIDER: "jarvis", JARVIS_AI_URL: fakeUrl, JARVIS_AI_KEY: key });
    await h.reset();
    await h.createOwner();
    const agent = await h.signedIn();
    const suggest = (id?: string) => {
      const request = agent.raw.post("/api/ai/suggest").set(CSRF_HEADER, CSRF_VALUE);
      return (id ? request.set("x-request-id", id) : request).send({ task: "explain", content: "x" });
    };
    jarvisRequestId = undefined;
    const reused = await suggest("trace-12345678");
    expect(reused.status).toBe(200);
    expect(jarvisRequestId).toBe("trace-12345678");
    expect(reused.headers["x-request-id"]).toBe("trace-12345678");
    jarvisRequestId = undefined;
    await suggest("bad id with spaces!");
    expect(jarvisRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    jarvisRequestId = undefined;
    await suggest();
    expect(jarvisRequestId).toMatch(/^[0-9a-f-]{36}$/);
    await h.close();
  });

  it("refuses a remote Ollama endpoint", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost/db",
        AI_ENABLED: "true",
        OLLAMA_URL: "https://api.example.com",
      }),
    ).toThrow(/this machine/);
  });

  it("accepts IPv6 and IPv4 loopback Ollama endpoints", () => {
    const base = { DATABASE_URL: "postgresql://u:p@localhost/db", AI_ENABLED: "true" };
    for (const url of ["http://[::1]:11434", "http://127.0.0.1:11434", "http://localhost:11434"]) {
      expect(loadConfig({ ...base, OLLAMA_URL: url }).OLLAMA_URL).toBe(url);
    }
    expect(() => loadConfig({ ...base, OLLAMA_URL: "http://[2001:db8::1]:11434" })).toThrow(/this machine/);
  });

  it("requires a local JARVIS endpoint and a key when JARVIS is enabled", () => {
    const base = {
      DATABASE_URL: "postgresql://u:p@localhost/db",
      AI_ENABLED: "true",
      AI_PROVIDER: "jarvis",
    };
    const key = `jrv_0123456789ab_${"A".repeat(43)}`;
    expect(() => loadConfig({ ...base, JARVIS_AI_URL: "https://api.example.com", JARVIS_AI_KEY: key })).toThrow(
      /local gateway origin/,
    );
    expect(() => loadConfig({ ...base, JARVIS_AI_URL: fakeUrl })).toThrow(/valid JARVIS site key is required/);
  });
});
