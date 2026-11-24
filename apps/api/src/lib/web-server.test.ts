import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../deploy/local-prod/web-server.mjs",
);

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function get(port: number, rawPath: string): Promise<number> {
  // fetch() would normalise the path; a raw socket sends it exactly as an attacker would.
  const { connect } = await import("node:net");
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () =>
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
    );
    let data = "";
    socket.on("data", (chunk) => (data += chunk));
    socket.on("close", () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1] ?? 0)));
    socket.on("error", reject);
  });
}

describe("production web server", () => {
  it("answers a malformed percent escape with 400 and keeps serving", async () => {
    const dist = mkdtempSync(path.join(tmpdir(), "web-dist-"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>t</title>");
    const port = await freePort();
    const child = spawn(process.execPath, [SERVER], {
      env: { PORT: String(port), WEB_DIST_DIR: dist, API_URL: "http://127.0.0.1:9", PATH: process.env.PATH ?? "" },
      stdio: "ignore",
    });
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await get(port, "/").catch(() => 0)) === 200) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(await get(port, "/%")).toBe(400);
      expect(await get(port, "/%E0%A4%A")).toBe(400);
      expect(await get(port, "/%2e%2e/%2e%2e/etc/passwd")).toBeGreaterThanOrEqual(200);
      expect(child.exitCode).toBeNull();
      expect(await get(port, "/")).toBe(200);
    } finally {
      child.kill();
    }
  });
});
