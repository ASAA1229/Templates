-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('SCRATCH', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "contentDigest" CHAR(64),
ADD COLUMN     "contentRef" VARCHAR(80);

-- CreateTable
CREATE TABLE "ProjectGeneration" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "mode" "GenerationMode" NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "templateId" VARCHAR(80) NOT NULL,
    "templateVersion" VARCHAR(40) NOT NULL,
    "templateDigest" CHAR(64) NOT NULL,
    "catalogItemId" UUID,
    "generatorVersion" VARCHAR(20) NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputsHash" CHAR(64) NOT NULL,
    "outputDir" VARCHAR(80) NOT NULL,
    "outputDigest" CHAR(64),
    "files" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" VARCHAR(500),
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProjectGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGeneration_projectId_key" ON "ProjectGeneration"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGeneration_outputDir_key" ON "ProjectGeneration"("outputDir");

-- CreateIndex
CREATE INDEX "ProjectGeneration_status_idx" ON "ProjectGeneration"("status");

-- CreateIndex
CREATE INDEX "ProjectGeneration_catalogItemId_idx" ON "ProjectGeneration"("catalogItemId");

-- AddForeignKey
ALTER TABLE "ProjectGeneration" ADD CONSTRAINT "ProjectGeneration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGeneration" ADD CONSTRAINT "ProjectGeneration_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A generation is only successful with a recorded output digest and completion time,
-- so a partially written output can never be reported as complete.
ALTER TABLE "ProjectGeneration" ADD CONSTRAINT "ProjectGeneration_success_complete"
  CHECK ("status" <> 'SUCCEEDED' OR ("outputDigest" IS NOT NULL AND "completedAt" IS NOT NULL));
ALTER TABLE "ProjectGeneration" ADD CONSTRAINT "ProjectGeneration_attempts_positive" CHECK ("attempts" >= 1);
ALTER TABLE "ProjectGeneration" ADD CONSTRAINT "ProjectGeneration_template_mode_source"
  CHECK ("mode" = 'SCRATCH' OR "templateId" <> '');
