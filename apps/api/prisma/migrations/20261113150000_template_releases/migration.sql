-- RG-06: template release ledger with database-enforced immutability of released versions.
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'RELEASED', 'DEPRECATED');

CREATE TABLE "TemplateRelease" (
  "id" UUID NOT NULL,
  "templateId" VARCHAR(80) NOT NULL,
  "version" VARCHAR(40) NOT NULL,
  "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "contentDigest" CHAR(64) NOT NULL,
  "manifest" JSONB NOT NULL,
  "notes" VARCHAR(500) NOT NULL DEFAULT '',
  "reviewNote" VARCHAR(500) NOT NULL DEFAULT '',
  "createdById" UUID NOT NULL,
  "submittedById" UUID,
  "approvedById" UUID,
  "releasedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMPTZ(3),
  "approvedAt" TIMESTAMPTZ(3),
  "releasedAt" TIMESTAMPTZ(3),
  "deprecatedAt" TIMESTAMPTZ(3),
  "deprecationReason" VARCHAR(500),
  "replacedByVersion" VARCHAR(40),
  "rowVersion" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "TemplateRelease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TemplateRelease_templateId_version_key" ON "TemplateRelease"("templateId", "version");
CREATE INDEX "TemplateRelease_status_idx" ON "TemplateRelease"("status");

CREATE FUNCTION template_release_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('RELEASED', 'DEPRECATED') THEN
      RAISE EXCEPTION 'Released template versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('RELEASED', 'DEPRECATED') THEN
    IF NEW."templateId" <> OLD."templateId" OR NEW."version" <> OLD."version"
       OR NEW."contentDigest" <> OLD."contentDigest" OR NEW."manifest" <> OLD."manifest"
       OR NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt" OR NEW."releasedById" IS DISTINCT FROM OLD."releasedById" THEN
      RAISE EXCEPTION 'Released template versions are immutable';
    END IF;
    IF OLD."status" = 'DEPRECATED' AND NEW."status" <> 'DEPRECATED' THEN
      RAISE EXCEPTION 'A deprecated template version cannot be restored';
    END IF;
    IF NEW."status" NOT IN ('RELEASED', 'DEPRECATED') THEN
      RAISE EXCEPTION 'A released template version cannot return to review';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER template_release_immutable_update
  BEFORE UPDATE OR DELETE ON "TemplateRelease"
  FOR EACH ROW EXECUTE FUNCTION template_release_immutable();
