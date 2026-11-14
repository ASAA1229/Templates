import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const script = path.resolve(apiRoot, "..", "..", "scripts", "db-backup.mjs");
const hasPgDump = spawnSync("pg_dump", ["--version"]).status === 0;

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = path.join(apiRoot, ".env");
  const match = existsSync(envFile) ? readFileSync(envFile, "utf8").match(/^TEST_DATABASE_URL="?([^"\r\n]+)"?/m) : null;
  if (!match?.[1]) throw new Error("TEST_DATABASE_URL is not configured.");
  return match[1];
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  parsed.search = "";
  return parsed.toString();
}

if (!hasPgDump) {
  describe.skip("backup and restore round trip (skipped: pg_dump is not on PATH)", () => {
    it("requires PostgreSQL client tools", () => undefined);
  });
} else {
  describe("backup and restore round trip", () => {
    const suffix = randomBytes(4).toString("hex");
    const sourceName = `agent_b_src_${suffix}`;
    const baseUrl = testDatabaseUrl();
    const sourceUrl = withDatabase(baseUrl, sourceName);
    const admin = new PrismaClient({ datasourceUrl: withDatabase(baseUrl, "postgres") });
    const work = mkdtempSync(path.join(tmpdir(), "agent-b-backup-"));
    const backupDir = path.join(work, "backup");
    const generatedDir = path.join(work, "generated");
    let source: PrismaClient;

    const runScript = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], {
        env: { ...process.env, DATABASE_URL: sourceUrl, GENERATION_OUTPUT_DIR: generatedDir },
        encoding: "utf8",
      });

    beforeAll(async () => {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${sourceName}"`);
      const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: sourceUrl },
        encoding: "utf8",
        shell: true,
      });
      if (migrate.status !== 0) throw new Error(`migrate deploy failed: ${migrate.stderr}`);
      source = new PrismaClient({ datasourceUrl: sourceUrl });
      const owner = await source.owner.create({
        data: { email: "backup@asaa.test", displayName: "Backup", role: "OWNER", passwordHash: "x" },
      });
      const project = await source.project.create({ data: { key: "BKP", name: "Backup project", ownerId: owner.id } });
      await source.requirement.create({ data: { projectId: project.id, code: "REQ-1", title: "First" } });
      await source.requirement.create({ data: { projectId: project.id, code: "REQ-2", title: "Second" } });
      await source.auditEvent.create({ data: { actorType: "SYSTEM", action: "backup.test", outcome: "SUCCESS" } });
      mkdirSync(generatedDir, { recursive: true });
      writeFileSync(path.join(generatedDir, "sample.txt"), "generated output");
    }, 300_000);

    afterAll(async () => {
      await source?.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${sourceName}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    });

    it("backs up, verifies, detects tampering, and passes a restore check that leaves no scratch database", async () => {
      const before = await admin.$queryRaw<{ datname: string }[]>`
        SELECT datname FROM pg_database WHERE datname LIKE 'restore_check_%'`;

      const made = runScript("backup", "--out", backupDir);
      expect(made.status, made.stderr).toBe(0);
      const manifestText = readFileSync(path.join(backupDir, "backup-manifest.json"), "utf8");
      const manifest = JSON.parse(manifestText);
      expect(manifest.sourceCounts).toMatchObject({ Owner: 1, Project: 1, Requirement: 2, AuditEvent: 1 });
      expect(Object.keys(manifest.files)).toEqual(
        expect.arrayContaining(["database.dump", "files/generated/sample.txt"]),
      );
      expect(manifest.files["database.dump"].sha256).toMatch(/^[0-9a-f]{64}$/);
      // The password must never reach the manifest or the script output.
      const password = decodeURIComponent(new URL(sourceUrl).password);
      if (password) {
        expect(manifestText).not.toContain(password);
        expect(made.stdout + made.stderr).not.toContain(password);
      }

      const verified = runScript("verify", "--dir", backupDir);
      expect(verified.status, verified.stderr).toBe(0);

      const checked = runScript("restore-check", "--dir", backupDir);
      expect(checked.status, checked.stdout + checked.stderr).toBe(0);
      expect(checked.stdout).toContain("PASS");

      const after = await admin.$queryRaw<{ datname: string }[]>`
        SELECT datname FROM pg_database WHERE datname LIKE 'restore_check_%'`;
      expect(after.map((row) => row.datname).sort()).toEqual(before.map((row) => row.datname).sort());

      // Tamper with the dump: verify and restore-check must now fail non-zero.
      appendFileSync(path.join(backupDir, "database.dump"), "tampered");
      const tampered = runScript("verify", "--dir", backupDir);
      expect(tampered.status).not.toBe(0);
      expect(tampered.stderr).toContain("checksum mismatch");
      const refused = runScript("restore-check", "--dir", backupDir);
      expect(refused.status).not.toBe(0);
    }, 300_000);
  });
}
