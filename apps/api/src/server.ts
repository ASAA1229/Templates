import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { recoverInterruptedJobs } from "./modules/execution/jobs.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const prisma = new PrismaClient();
const ctx = { config, prisma, logger, now: () => new Date() };
const app = createApp(ctx);
void recoverInterruptedJobs(ctx).catch((error: unknown) =>
  logger.error("job recovery failed", { error: String(error) }),
);

const server = app.listen(config.PORT, "127.0.0.1", () => {
  logger.info("api listening", { port: config.PORT, env: config.NODE_ENV });
});

async function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
