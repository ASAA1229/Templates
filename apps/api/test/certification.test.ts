import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLock, certifyLibrary, readLock } from "../src/certification/certify.js";
import { scanForSecrets } from "../src/certification/secret-scan.js";

const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../template-library");
let base: string;
let copy: string;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "asaa-certify-"));
  copy = path.join(base, "library");
});
afterAll(() => rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

async function freshCopy() {
  await rm(copy, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await cp(BUNDLED, copy, { recursive: true });
}

const failedChecks = (report: Awaited<ReturnType<typeof certifyLibrary>>, id: string) =>
  report.packages.find((pkg) => pkg.id === id)!.checks.filter((check) => check.status === "fail");

describe("RG-04 template certification", () => {
  it("certifies every bundled package against the committed lock", async () => {
    const report = await certifyLibrary(BUNDLED);
    expect(report.summary.total).toBe(29);
    const failures = report.packages.filter((pkg) => pkg.status !== "CERTIFIED");
    expect(
      failures.map((pkg) => `${pkg.id}: ${JSON.stringify(pkg.checks.filter((c) => c.status === "fail"))}`),
    ).toEqual([]);
    expect(report.packages.every((pkg) => pkg.contentDigest && pkg.outputDigest)).toBe(true);
    // Every package has all of the required check categories.
    for (const pkg of report.packages) {
      expect(pkg.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "manifest-schema",
          "license",
          "provenance",
          "dependencies",
          "secret-scan",
          "generation-dry-run",
          "integrity",
        ]),
      );
    }
  });

  it("keeps the lock in sync: rebuilding it from the library changes nothing", async () => {
    const { lock, rejected } = await buildLock(BUNDLED);
    expect(rejected).toEqual([]);
    expect(lock).toEqual(await readLock(BUNDLED));
  });

  it("fails a package whose content changed after certification (immutability)", async () => {
    await freshCopy();
    const file = path.join(copy, "restaurant-essential/1.0.0/files/README.md");
    await writeFile(file, `${await readFile(file, "utf8")}\nTampered after certification.\n`);
    const report = await certifyLibrary(copy);
    expect(failedChecks(report, "restaurant-essential").map((c) => c.id)).toEqual(["integrity"]);
    expect(report.summary.failed).toBe(1);
  });

  it("fails packages with committed credentials, unpinned dependencies or missing provenance", async () => {
    await freshCopy();
    const html = path.join(copy, "retail-catalog/1.0.0/files/index.html");
    await writeFile(html, `${await readFile(html, "utf8")}\n<!-- ghp_${"a".repeat(36)} -->\n`);
    const manifestPath = path.join(copy, "starter-api-service/1.0.0/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies[0].version = "^5.3.0";
    delete manifest.provenance.repository;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const report = await certifyLibrary(copy);
    expect(failedChecks(report, "retail-catalog").map((c) => c.id)).toContain("secret-scan");
    const starter = failedChecks(report, "starter-api-service").map((c) => c.id);
    expect(starter).toEqual(expect.arrayContaining(["dependencies", "provenance"]));
    // The detail never echoes the secret itself.
    expect(JSON.stringify(report)).not.toContain("ghp_aaaa");
  });

  it("fails a package that does not generate deterministically valid output", async () => {
    await freshCopy();
    const manifestPath = path.join(copy, "starter-blank/1.0.0/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.validation.requiredOutputs.push("missing-file.txt");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const report = await certifyLibrary(copy);
    expect(failedChecks(report, "starter-blank").map((c) => c.id)).toContain("generation-dry-run");
  });

  it("detects secrets without reporting them", () => {
    const files = new Map<string, Buffer>([
      ["a.txt", Buffer.from("-----BEGIN RSA PRIVATE KEY-----\nabc")],
      ["b.json", Buffer.from('{"apiKey": "abcdefghijklmnop1234"}')],
      ["env", Buffer.from("PORT=3000")],
      [".env", Buffer.from("X=1")],
      ["c.txt", Buffer.from("https://user:hunter22@example.com/repo.git")],
      ["env.example", Buffer.from("PORT=3000")],
    ]);
    const rules = scanForSecrets(files).map((finding) => `${finding.file}:${finding.rule}`);
    expect(rules).toEqual(
      expect.arrayContaining([
        "a.txt:private-key",
        "b.json:assigned-secret",
        ".env:forbidden-file-name",
        "c.txt:credentialed-url",
      ]),
    );
    expect(rules.some((rule) => rule.startsWith("env"))).toBe(false);
  });
});
