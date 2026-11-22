-- Delivery ledger (exports, repository handoff, deployment) and managed taxonomy with sector assignment.
CREATE TYPE "DeliveryKind" AS ENUM ('ZIP_EXPORT', 'WORKSPACE_EXPORT', 'REPOSITORY_HANDOFF', 'DEPLOYMENT');
CREATE TYPE "DeliveryStatus" AS ENUM ('REQUESTED', 'EXECUTED', 'REJECTED', 'FAILED', 'CANCELLED');
CREATE TYPE "TaxonomyKind" AS ENUM ('CATEGORY', 'SECTOR');

ALTER TABLE "CatalogItem" ADD COLUMN "sector" VARCHAR(80);
CREATE INDEX "CatalogItem_sector_idx" ON "CatalogItem"("sector");

CREATE TABLE "DeliveryRequest" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "kind" "DeliveryKind" NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'REQUESTED',
  "provider" VARCHAR(40) NOT NULL,
  "target" VARCHAR(120) NOT NULL DEFAULT '',
  "note" VARCHAR(500) NOT NULL DEFAULT '',
  "requestedById" UUID NOT NULL,
  "decidedById" UUID,
  "decisionNote" VARCHAR(500) NOT NULL DEFAULT '',
  "result" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMPTZ(3),
  "executedAt" TIMESTAMPTZ(3),
  CONSTRAINT "DeliveryRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeliveryRequest_projectId_createdAt_idx" ON "DeliveryRequest"("projectId", "createdAt");
CREATE INDEX "DeliveryRequest_status_kind_idx" ON "DeliveryRequest"("status", "kind");
ALTER TABLE "DeliveryRequest" ADD CONSTRAINT "DeliveryRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaxonomyTerm" (
  "id" UUID NOT NULL,
  "kind" "TaxonomyKind" NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500) NOT NULL DEFAULT '',
  "parentKey" VARCHAR(80),
  "stewardId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "rowVersion" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "TaxonomyTerm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxonomyTerm_kind_key_key" ON "TaxonomyTerm"("kind", "key");
