CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "AccessRequest" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "displayName" VARCHAR(120) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
  "approvedRole" "OwnerRole" NOT NULL DEFAULT 'EMPLOYEE',
  "tokenHash" CHAR(64),
  "tokenExpiresAt" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "reviewerId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccessRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AccessRequest_tokenHash_key" ON "AccessRequest"("tokenHash");
CREATE INDEX "AccessRequest_status_createdAt_idx" ON "AccessRequest"("status", "createdAt");
CREATE INDEX "AccessRequest_email_status_idx" ON "AccessRequest"("email", "status");
