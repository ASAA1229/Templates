-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('OWNER', 'SYSTEM', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('REQUIREMENT', 'USER_STORY');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P0', 'P1', 'P2');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('DRAFT', 'READY', 'IN_DEVELOPMENT', 'DEVELOPED', 'BUILT', 'TESTED', 'RELEASED');

-- CreateEnum
CREATE TYPE "TraceKind" AS ENUM ('TASK', 'CODE_CHANGE', 'TEST', 'DEFECT', 'DOCUMENTATION', 'RELEASE');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('PLANNED', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "CatalogKind" AS ENUM ('TEMPLATE', 'COMPONENT', 'DESIGN_ASSET', 'WORKFLOW', 'IMPORTED_PROJECT');

-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "TrustStatus" AS ENUM ('UNTRUSTED', 'UNDER_REVIEW', 'TRUSTED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('AUTHORED', 'IMPORTED');

-- CreateTable
CREATE TABLE "Owner" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "email" VARCHAR(254) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(512) NOT NULL,
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "userAgent" VARCHAR(200),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(40),
    "targetId" VARCHAR(80),
    "outcome" "AuditOutcome" NOT NULL,
    "requestId" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "key" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "purpose" VARCHAR(2000) NOT NULL DEFAULT '',
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "ownerId" UUID NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requirementSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "kind" "RequirementKind" NOT NULL DEFAULT 'USER_STORY',
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL DEFAULT '',
    "priority" "Priority" NOT NULL DEFAULT 'P1',
    "status" "RequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementDependency" (
    "requirementId" UUID NOT NULL,
    "dependsOnId" UUID NOT NULL,

    CONSTRAINT "RequirementDependency_pkey" PRIMARY KEY ("requirementId","dependsOnId")
);

-- CreateTable
CREATE TABLE "RequirementVersion" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeNote" VARCHAR(300),
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceLink" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "kind" "TraceKind" NOT NULL,
    "reference" VARCHAR(300) NOT NULL,
    "title" VARCHAR(200),
    "evidenceStatus" "EvidenceStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(4000) NOT NULL DEFAULT '',
    "kind" "CatalogKind" NOT NULL DEFAULT 'TEMPLATE',
    "category" VARCHAR(80) NOT NULL,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" VARCHAR(40) NOT NULL,
    "lifecycle" "Lifecycle" NOT NULL DEFAULT 'DRAFT',
    "trustStatus" "TrustStatus" NOT NULL DEFAULT 'TRUSTED',
    "sourceType" "SourceType" NOT NULL DEFAULT 'AUTHORED',
    "sourceReference" VARCHAR(500),
    "license" VARCHAR(80) NOT NULL,
    "ownership" VARCHAR(120) NOT NULL,
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "metadataSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_singleton_key" ON "Owner"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_ownerId_revokedAt_idx" ON "Session"("ownerId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");

-- CreateIndex
CREATE INDEX "Project_ownerId_archivedAt_idx" ON "Project"("ownerId", "archivedAt");

-- CreateIndex
CREATE INDEX "Requirement_projectId_status_idx" ON "Requirement"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_code_key" ON "Requirement"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementVersion_requirementId_version_key" ON "RequirementVersion"("requirementId", "version");

-- CreateIndex
CREATE INDEX "TraceLink_requirementId_kind_idx" ON "TraceLink"("requirementId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_slug_key" ON "CatalogItem"("slug");

-- CreateIndex
CREATE INDEX "CatalogItem_category_idx" ON "CatalogItem"("category");

-- CreateIndex
CREATE INDEX "CatalogItem_lifecycle_idx" ON "CatalogItem"("lifecycle");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDependency" ADD CONSTRAINT "RequirementDependency_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDependency" ADD CONSTRAINT "RequirementDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceLink" ADD CONSTRAINT "TraceLink_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only audit trail (US-I02): ordinary UPDATE/DELETE/TRUNCATE are rejected.
CREATE FUNCTION audit_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only';
END;
$$;

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();

-- Single-owner and data-shape guards enforced by the database as well as the API.
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_singleton_true" CHECK ("singleton" = true);
ALTER TABLE "Project" ADD CONSTRAINT "Project_key_format" CHECK ("key" ~ '^[A-Z][A-Z0-9-]{1,19}$');
ALTER TABLE "RequirementDependency" ADD CONSTRAINT "RequirementDependency_not_self" CHECK ("requirementId" <> "dependsOnId");
