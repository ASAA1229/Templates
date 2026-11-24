import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

/**
 * Read-only preflight: fail fast, with one clear message, when the test database is missing committed
 * migrations. It never applies a migration or changes a schema; apply them with `prisma migrate deploy`
 * (documented in docs/TESTING.md) before running the suite.
 */
function testDatabaseUrl(apiDir: string): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = path.join(apiDir, ".env");
  if (!existsSync(envFile)) return undefined;
  return readFileSync(envFile, "utf8").match(/^TEST_DATABASE_URL="?([^"\n]+)"?/m)?.[1];
}

export default async function setup(): Promise<void> {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const url = testDatabaseUrl(apiDir);
  if (!url) return; // helpers.ts reports the missing configuration itself
  const committed = readdirSync(path.join(apiDir, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    const applied = new Set(rows.map((row) => row.migration_name));
    const missing = committed.filter((name) => !applied.has(name)).sort();
    if (missing.length > 0) {
      throw new Error(
        `The test database is missing ${missing.length} committed migration(s): ${missing.join(", ")}. ` +
          "Run `npm run db:deploy -w @asaa/api` with DATABASE_URL pointing at the test database, then retry.",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The test database is missing")) throw error;
    // Database unreachable or unmigrated entirely: let the suites report their own connection errors.
  } finally {
    await prisma.$disconnect();
  }
}
