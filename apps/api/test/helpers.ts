import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import supertest from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import type { AppContext } from "../src/context.js";
import { createLogger } from "../src/lib/logger.js";
import { createEventService } from "../src/modules/integration/events.js";
import { hashPassword } from "../src/lib/password.js";
import { CSRF_HEADER, CSRF_VALUE } from "../src/middleware/security.js";

/** Resolve the dedicated test database: env first, then apps/api/.env (never the dev DB). */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^TEST_DATABASE_URL="?([^"\n]+)"?/m);
    if (match?.[1]) return match[1];
  }
  throw new Error("TEST_DATABASE_URL is not configured. Run `npm run db:local -- init`.");
}

export const OWNER_EMAIL = "owner@asaa.test";
export const OWNER_PASSWORD = "correct horse battery staple";

export interface TestHarness {
  ctx: AppContext;
  clock: { now: Date };
  app: ReturnType<typeof createApp>;
  reset(): Promise<void>;
  createOwner(): Promise<{ id: string }>;
  /** Supertest agent that keeps cookies and sends the CSRF header on writes. */
  agent(): ReturnType<typeof agentFor>;
  signedIn(): Promise<ReturnType<typeof agentFor>>;
  close(): Promise<void>;
}

function agentFor(app: ReturnType<typeof createApp>) {
  const agent = supertest.agent(app);
  const withCsrf = <T extends { set: (name: string, value: string) => T }>(request: T) =>
    request.set(CSRF_HEADER, CSRF_VALUE);
  return {
    raw: agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => withCsrf(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => withCsrf(agent.patch(url)).send(body ?? {}),
    put: (url: string, body?: object) => withCsrf(agent.put(url)).send(body ?? {}),
    delete: (url: string) => withCsrf(agent.delete(url)),
  };
}

export function createHarness(overrides: Record<string, string> = {}): TestHarness {
  const url = testDatabaseUrl();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: url,
    WEB_ORIGIN: "http://localhost:5000",
    LOG_LEVEL: "silent",
    ...overrides,
  });
  const prisma = new PrismaClient({ datasourceUrl: url });
  const clock = { now: new Date() };
  const ctx: AppContext = { config, prisma, logger: createLogger("silent"), now: () => clock.now };
  // Disabled unless the test supplies ASAA_EVENTS_* settings; tests call deliverDue() instead of starting the timer.
  ctx.events = createEventService({ prisma, config, logger: ctx.logger, now: ctx.now });
  const app = createApp(ctx);
  let ownerHash: string | undefined;

  return {
    ctx,
    clock,
    app,
    async reset() {
      clock.now = new Date();
      // Replica mode skips the append-only audit trigger for test cleanup only.
      await prisma.$transaction([
        prisma.$executeRawUnsafe("SET LOCAL session_replication_role = replica"),
        prisma.$executeRawUnsafe(
          'TRUNCATE "AuditEvent", "PasswordResetToken", "AccessRequest", "ProjectMember", "ProjectRepository", "ProjectEnvironment", "ProjectGeneration", "TraceLink", "RequirementVersion", "RequirementDependency", "Requirement", "Project", "Session", "Owner", "CatalogItem", "TemplateRelease", "RateLimitBucket", "AsaaEventOutbox" RESTART IDENTITY CASCADE',
        ),
      ]);
    },
    async createOwner() {
      ownerHash ??= await hashPassword(OWNER_PASSWORD);
      // Use the test clock so sessions created "now" postdate the password timestamp.
      return prisma.owner.create({
        data: {
          email: OWNER_EMAIL,
          displayName: "Owner",
          role: "OWNER",
          passwordHash: ownerHash,
          passwordChangedAt: new Date(clock.now.getTime() - 1000),
          createdAt: new Date(clock.now.getTime() - 1000),
        },
      });
    },
    agent: () => agentFor(app),
    async signedIn() {
      const agent = agentFor(app);
      const response = await agent.post("/api/auth/login", { email: OWNER_EMAIL, password: OWNER_PASSWORD });
      if (response.status !== 200) throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`);
      return agent;
    },
    close: () => prisma.$disconnect(),
  };
}
