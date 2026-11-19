import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { configWarnings, loadConfig } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { recoverInterruptedJobs } from "./modules/execution/jobs.js";
import { createEventService } from "./modules/integration/events.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const prisma = new PrismaClient();
const now = () => new Date();
const events = createEventService({ prisma, config, logger, now });
const ctx = { config, prisma, logger, now, events };
const app = createApp(ctx);
void recoverInterruptedJobs(ctx).catch((error: unknown) =>
  logger.error("job recovery failed", { error: String(error) }),
);

for (const warning of configWarnings(config)) logger.warn(warning);
events.start();
if (events.isEnabled) logger.info("asaa event producer enabled");

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info("api listening", { port: config.PORT, env: config.NODE_ENV });
});

async function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  await events.stop();
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
