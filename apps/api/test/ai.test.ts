import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createHarness } from "./helpers.js";

let fake: Server;
let fakeUrl: string;
let fakeMode: "ok" | "bad" = "ok";

beforeAll(async () => {
  fake = createServer((req, res) => {
    if (req.url === "/api/tags") return void res.writeHead(200).end("{}");
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

  it("refuses a remote Ollama endpoint", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost/db",
        AI_ENABLED: "true",
        OLLAMA_URL: "https://api.example.com",
      }),
    ).toThrow(/this machine/);
  });
});
