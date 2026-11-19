-- Threaded comments and heartbeat presence for project collaboration.
CREATE TYPE "CommentTarget" AS ENUM ('PROJECT', 'TEMPLATE', 'FILE');
CREATE TYPE "PresenceMode" AS ENUM ('VIEWING', 'EDITING');

CREATE TABLE "ProjectComment" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "targetType" "CommentTarget" NOT NULL,
  "targetRef" VARCHAR(300) NOT NULL DEFAULT '',
  "parentId" UUID,
  "authorId" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedAt" TIMESTAMPTZ(3),
  "deletedAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedById" UUID,
  CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectComment_projectId_targetType_targetRef_createdAt_idx" ON "ProjectComment"("projectId", "targetType", "targetRef", "createdAt");
CREATE INDEX "ProjectComment_parentId_idx" ON "ProjectComment"("parentId");
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectPresence" (
  "projectId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "filePath" VARCHAR(400) NOT NULL DEFAULT '',
  "mode" "PresenceMode" NOT NULL DEFAULT 'VIEWING',
  "seenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectPresence_pkey" PRIMARY KEY ("projectId", "memberId")
);
CREATE INDEX "ProjectPresence_projectId_seenAt_idx" ON "ProjectPresence"("projectId", "seenAt");
ALTER TABLE "ProjectPresence" ADD CONSTRAINT "ProjectPresence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPresence" ADD CONSTRAINT "ProjectPresence_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
