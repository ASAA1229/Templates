-- CreateEnum
CREATE TYPE "RepositoryProviderKind" AS ENUM ('LOCAL_GIT', 'GITHUB', 'GITLAB', 'BITBUCKET');

-- CreateTable
CREATE TABLE "ProjectRepository" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "provider" "RepositoryProviderKind" NOT NULL DEFAULT 'LOCAL_GIT',
    "defaultBranch" VARCHAR(100) NOT NULL,
    "policy" JSONB NOT NULL,
    "identityName" VARCHAR(100) NOT NULL,
    "identityEmail" VARCHAR(254) NOT NULL,
    "remoteName" VARCHAR(40),
    "remoteUrl" VARCHAR(500),
    "adoptedExisting" BOOLEAN NOT NULL DEFAULT false,
    "initializedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEnvironment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProjectEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepository_projectId_key" ON "ProjectRepository"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEnvironment_projectId_key" ON "ProjectEnvironment"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEnvironment" ADD CONSTRAINT "ProjectEnvironment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only the local Git provider is implemented; other providers are reserved for later phases.
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_provider_supported" CHECK ("provider" = 'LOCAL_GIT');
-- Remote URLs must never carry credentials (user:password@ or token@ forms).
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_remote_no_credentials"
  CHECK ("remoteUrl" IS NULL OR "remoteUrl" !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*@');
