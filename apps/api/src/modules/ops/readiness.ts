import { access, constants, readdir } from "node:fs/promises";
import path from "node:path";
import type { AppContext } from "../../context.js";

export type CheckResult = "ok" | "fail";
export interface ReadinessChecks {
  database: CheckResult;
  migrations: CheckResult;
  templateLibrary: CheckResult;
  generationOutput: CheckResult;
}

async function probe(fn: () => Promise<void>): Promise<CheckResult> {
  try {
    await fn();
    return "ok";
  } catch {
    return "fail";
  }
}

/** A directory is usable when it is writable, or missing but its nearest existing ancestor is writable. */
async function writableOrCreatable(dir: string): Promise<void> {
  let current = dir;
  for (;;) {
    try {
      await access(current, constants.W_OK);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

/** Dependencies needed to serve real traffic. Results carry check names only (no paths/secrets). */
export async function readinessChecks(ctx: AppContext): Promise<ReadinessChecks> {
  return {
    database: await probe(async () => {
      await ctx.prisma.$queryRaw`SELECT 1`;
    }),
    migrations: await probe(async () => {
      const rows = await ctx.prisma.$queryRaw<{ pending: bigint }[]>`
        SELECT count(*) AS pending FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`;
      if (Number(rows[0]?.pending ?? 1) !== 0) throw new Error("unfinished migrations");
    }),
    templateLibrary: await probe(async () => {
      await readdir(ctx.config.TEMPLATE_LIBRARY_DIR);
    }),
    generationOutput: await probe(() => writableOrCreatable(ctx.config.GENERATION_OUTPUT_DIR)),
  };
}
