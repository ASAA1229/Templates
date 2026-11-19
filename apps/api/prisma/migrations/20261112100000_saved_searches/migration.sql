-- Owner-scoped saved search definitions (US-O02).
CREATE TABLE "SavedSearch" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "query" VARCHAR(80) NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedSearch_ownerId_name_key" ON "SavedSearch"("ownerId", "name");
CREATE INDEX "SavedSearch_ownerId_updatedAt_idx" ON "SavedSearch"("ownerId", "updatedAt");

ALTER TABLE "SavedSearch"
  ADD CONSTRAINT "SavedSearch_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
