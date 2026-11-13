CREATE TYPE "ProjectAccessRole" AS ENUM ('VIEWER', 'EDITOR');

CREATE TABLE "ProjectMember" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "role" "ProjectAccessRole" NOT NULL DEFAULT 'VIEWER',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectMember_projectId_memberId_key" ON "ProjectMember"("projectId", "memberId");
CREATE INDEX "ProjectMember_memberId_projectId_idx" ON "ProjectMember"("memberId", "projectId");
