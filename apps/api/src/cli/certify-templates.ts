/**
 * RG-04 certification runner.
 *   npm run certify:templates -w @asaa/api                  check every package, write a report, exit 1 on failure
 *   npm run certify:templates -w @asaa/api -- --update-lock  record digests of passing packages (after human review)
 * Options: --library <dir>  --report <file>
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLock, certifyLibrary, writeLock } from "../certification/certify.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(option("--library") ?? path.join(here, "../../template-library"));
const reportPath = path.resolve(option("--report") ?? path.join(here, "../../../../.local/certification/report.json"));

if (args.includes("--update-lock")) {
  const { lock, rejected } = await buildLock(root);
  await writeLock(root, lock);
  console.log(`Lock updated: ${Object.keys(lock.packages).length} packages recorded.`);
  if (rejected.length) console.log(`Not recorded (failing checks): ${rejected.join(", ")}`);
}

const report = await certifyLibrary(root);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
for (const pkg of report.packages) {
  const failed = pkg.checks.filter((check) => check.status === "fail");
  const lines = failed.map((check) => `\n        ${check.id}: ${check.detail}`).join("");
  console.log(`${pkg.status === "CERTIFIED" ? "PASS" : "FAIL"}  ${pkg.id}@${pkg.version}${lines}`);
}
console.log(`\n${report.summary.certified}/${report.summary.total} certified. Report: ${reportPath}`);
process.exit(report.summary.failed === 0 ? 0 : 1);
