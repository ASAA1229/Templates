/**
 * RG-04 certification runner.
 *   npm run certify:templates -w @asaa/api                  check every package, write a report, exit 1 on failure
 *   npm run certify:templates -w @asaa/api -- --update-lock  record digests of passing packages (after human review)
 * Options: --library <dir>  --report <file>  --tools <dir>  (packaged tools are certified too; a failing tool exits 1)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLock, certifyLibrary, writeLock } from "../certification/certify.js";
import { certifyTools } from "../certification/certify-tool.js";

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
// Packaged tools (tools/<id>) are certified too; template `summary` and `packages` stay unchanged.
const toolsRoot = path.resolve(option("--tools") ?? path.join(here, "../../../../tools"));
const toolReport = await certifyTools(toolsRoot);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(
  reportPath,
  `${JSON.stringify({ ...report, toolSummary: toolReport.toolSummary, tools: toolReport.tools }, null, 2)}\n`,
  "utf8",
);
for (const pkg of report.packages) {
  const failed = pkg.checks.filter((check) => check.status === "fail");
  const lines = failed.map((check) => `\n        ${check.id}: ${check.detail}`).join("");
  console.log(`${pkg.status === "CERTIFIED" ? "PASS" : "FAIL"}  ${pkg.id}@${pkg.version}${lines}`);
}
for (const tool of toolReport.tools) {
  const failed = tool.checks.filter((check) => check.status === "fail");
  const skipped = tool.checks.filter((check) => check.status === "skipped");
  const lines = [...failed, ...skipped].map((check) => `\n        ${check.id}: ${check.detail}`).join("");
  console.log(`${tool.status === "CERTIFIED" ? "PASS" : "FAIL"}  tool ${tool.id}@${tool.version ?? "?"}${lines}`);
}
console.log(`\n${report.summary.certified}/${report.summary.total} certified. Report: ${reportPath}`);
console.log(`${toolReport.toolSummary.certified}/${toolReport.toolSummary.total} tools certified.`);
process.exit(report.summary.failed === 0 && toolReport.toolSummary.failed === 0 ? 0 : 1);
