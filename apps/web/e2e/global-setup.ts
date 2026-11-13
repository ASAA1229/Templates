import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

export const E2E_OWNER = { email: "owner@asaa.test", password: "e2e owner password 2026", name: "E2E Owner" };

/**
 * Reset the test database and create the owner through the real bootstrap CLI,
 * so owner initialisation is exercised end to end as well.
 */
export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL!;
  rmSync(process.env.E2E_GENERATION_DIR!, { recursive: true, force: true });
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await prisma.$transaction([
      prisma.$executeRawUnsafe("SET LOCAL session_replication_role = replica"),
      prisma.$executeRawUnsafe(
        'TRUNCATE "AuditEvent", "ProjectRepository", "ProjectEnvironment", "ProjectGeneration", "TraceLink", "RequirementVersion", "RequirementDependency", "Requirement", "Project", "Session", "Owner", "CatalogItem", "TemplateRelease" RESTART IDENTITY CASCADE',
      ),
    ]);
  } finally {
    await prisma.$disconnect();
  }
  const apiDir = path.resolve(import.meta.dirname, "../../api");
  const tsxCli = createRequire(path.join(apiDir, "package.json")).resolve("tsx/cli");
  execFileSync(process.execPath, [tsxCli, "src/cli/owner.ts", "init"], {
    cwd: apiDir,
    stdio: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      OWNER_EMAIL: E2E_OWNER.email,
      OWNER_NAME: E2E_OWNER.name,
      OWNER_PASSWORD: E2E_OWNER.password,
    },
  });
}
