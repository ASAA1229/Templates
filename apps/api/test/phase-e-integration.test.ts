import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectorManager, type CredentialProvider, type RevocationStore } from "../src/integrations/connectors.js";
import { MockBuildConnector } from "../src/integrations/mock-connectors.js";
import { collectProjectFiles } from "../src/modules/export/archive.js";
import { isSecretFileName } from "../src/modules/export/file-policy.js";

/** Phase E source-level integration: durable connector revocation and the shared export file policy. */
const noCredentials: CredentialProvider = { get: () => undefined };

class SharedStore implements RevocationStore {
  revoked = new Set<string>();
  failReads = false;
  async isRevoked(id: string) {
    if (this.failReads) throw new Error("database unavailable");
    return this.revoked.has(id);
  }
  async revoke(id: string) {
    this.revoked.add(id);
  }
}

const build = () => {
  const store = new SharedStore();
  const make = () => {
    const manager = new ConnectorManager(noCredentials, undefined, store);
    manager.register("ci-main", new MockBuildConnector(), { jobs: ["job"] });
    return manager;
  };
  return { store, make };
};

describe("connector revocation durability", () => {
  const approved = { actor: "owner", approvedBy: "owner" };

  it("stays revoked after a restart (new manager over the same store)", async () => {
    const { make } = build();
    const first = make();
    await first.trigger("ci-main", { job: "job" }, approved);
    await first.revoke("ci-main", "owner");
    const restarted = make();
    await expect(restarted.trigger("ci-main", { job: "job" }, approved)).rejects.toThrow(/revoked/);
    expect((await restarted.describe("ci-main")).revoked).toBe(true);
    expect((await restarted.health("ci-main", "owner")).ok).toBe(false);
  });

  it("denies every use when revocation state cannot be read", async () => {
    const { store, make } = build();
    const manager = make();
    store.failReads = true;
    await expect(manager.trigger("ci-main", { job: "job" }, approved)).rejects.toThrow(/revoked|unavailable/);
    expect((await manager.describe("ci-main")).revoked).toBe(true);
  });
});

describe("shared export file policy", () => {
  it("recognises credential files but allows .example templates", () => {
    for (const name of [".env", ".env.local", "deploy/key.pem", "id_rsa", "cert.pfx"]) {
      expect(isSecretFileName(name), name).toBe(true);
    }
    for (const name of [".env.example", "src/app.ts", "README.md"]) expect(isSecretFileName(name), name).toBe(false);
  });

  it("leaves credential files out of collected files and refuses embedded credentials", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "policy-"));
    try {
      await mkdir(path.join(dir, "src"));
      await writeFile(path.join(dir, "src", "app.ts"), "export const ok = 1;\n");
      await writeFile(path.join(dir, ".env"), "TOKEN=abc\n");
      await writeFile(path.join(dir, ".env.example"), "TOKEN=\n");
      const report = { excludedSecrets: [] as string[] };
      const files = await collectProjectFiles(dir, report);
      expect(files.map((file) => file.path)).toEqual([".env.example", "src/app.ts"]);
      expect(report.excludedSecrets).toEqual([".env"]);
      await writeFile(path.join(dir, "src", "leak.ts"), "-----BEGIN PRIVATE KEY-----\n");
      await expect(collectProjectFiles(dir)).rejects.toThrow(/possible credentials/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
