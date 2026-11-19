#!/usr/bin/env node
/**
 * Generates a CycloneDX 1.5 dependency SBOM directly from package-lock.json (no network, no node_modules needed).
 *
 * `npm sbom` refuses to run in this workspace because npm reports the tree as "invalid" (the pinned `overrides`
 * deliberately differ from the ranges declared by @prisma/config and c12), so the SBOM is derived from the lockfile
 * instead. scripts/sbom-verify.mjs then cross-checks the result against the same lockfile.
 *
 * Usage: node scripts/lockfile-sbom.mjs [package-lock.json] [output.cdx.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [lockPath = "package-lock.json", outputPath = "templates-dependencies.cdx.json"] = process.argv.slice(2);
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
if (lock.lockfileVersion < 2 || !lock.packages) throw new Error("A lockfileVersion 2+ package-lock.json is required.");

const purlFor = (name, version) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
const components = new Map();

for (const [location, info] of Object.entries(lock.packages)) {
  // Skip the root project and workspace link stubs; workspace sources (first-party packages) are listed like npm sbom does.
  if (location === "" || info.link || !info.version) continue;
  const marker = location.lastIndexOf("node_modules/");
  const name = info.name ?? (marker >= 0 ? location.slice(marker + "node_modules/".length) : location);
  const purl = purlFor(name, info.version);
  const existing = components.get(purl);
  const scope = info.optional || info.devOptional ? "optional" : "required";
  if (existing) {
    if (scope === "required") existing.scope = "required";
    continue;
  }
  const component = { type: "library", "bom-ref": purl, name, version: info.version, scope, purl };
  if (typeof info.integrity === "string" && info.integrity.includes("-")) {
    const [algorithm, base64] = info.integrity.split("-", 2);
    const alg = { sha512: "SHA-512", sha384: "SHA-384", sha256: "SHA-256", sha1: "SHA-1" }[algorithm];
    if (alg) component.hashes = [{ alg, content: Buffer.from(base64, "base64").toString("hex") }];
  }
  if (typeof info.license === "string") component.licenses = [{ expression: info.license }];
  if (typeof info.resolved === "string") component.externalReferences = [{ type: "distribution", url: info.resolved }];
  if (info.dev) component.properties = [{ name: "cdx:npm:package:development", value: "true" }];
  components.set(purl, component);
}

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: "application", name: "lockfile-sbom.mjs" }] },
    component: {
      type: "application",
      "bom-ref": "root",
      name: lock.name ?? "asaa-templates",
      version: lock.version ?? "0.0.0",
    },
  },
  components: [...components.values()].sort((a, b) => a.purl.localeCompare(b.purl)),
};
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`SBOM written: ${outputPath} (${sbom.components.length} components from ${lockPath}).`);
