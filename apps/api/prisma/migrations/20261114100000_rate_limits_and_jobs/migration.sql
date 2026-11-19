-- Shared rate-limit buckets and isolated execution jobs.
CREATE TABLE "RateLimitBucket" (
  "key" VARCHAR(240) NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

CREATE TYPE "ExecutionJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'LIMIT_EXCEEDED');

CREATE TABLE "ExecutionJob" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "task" VARCHAR(40) NOT NULL,
  "target" VARCHAR(240) NOT NULL DEFAULT '',
  "isolation" VARCHAR(20) NOT NULL,
  "status" "ExecutionJobStatus" NOT NULL DEFAULT 'QUEUED',
  "exitCode" INTEGER,
  "stdout" TEXT NOT NULL DEFAULT '',
  "stderr" TEXT NOT NULL DEFAULT '',
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "reason" VARCHAR(300),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ExecutionJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExecutionJob_projectId_createdAt_idx" ON "ExecutionJob"("projectId", "createdAt");
CREATE INDEX "ExecutionJob_status_idx" ON "ExecutionJob"("status");
ALTER TABLE "ExecutionJob" ADD CONSTRAINT "ExecutionJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
