import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config/env.js";
import type { Logger } from "./lib/logger.js";
import type { EventService } from "./modules/integration/events.js";

/** Explicit dependencies passed to every module (no hidden singletons; easy to test). */
export interface AppContext {
  config: AppConfig;
  prisma: PrismaClient;
  logger: Logger;
  now: () => Date;
  /** ASAA ecosystem event producer; absent or disabled unless configured. */
  events?: EventService;
}

export interface AuthenticatedOwner {
  id: string;
  email: string;
  displayName: string;
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "TESTER" | "EMPLOYEE";
  mfaEnabled?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      owner?: AuthenticatedOwner;
      sessionId?: string;
    }
  }
}
