-- Durable outbox for ASAA ecosystem events (asaa.event.v1); disabled by default at runtime.
CREATE TYPE "AsaaEventStatus" AS ENUM ('PENDING', 'DELIVERED', 'DEAD');

CREATE TABLE "AsaaEventOutbox" (
  "id" UUID NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "envelope" JSONB NOT NULL,
  "status" "AsaaEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMPTZ(3),
  "lastError" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AsaaEventOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AsaaEventOutbox_status_nextAttemptAt_idx" ON "AsaaEventOutbox"("status", "nextAttemptAt");
